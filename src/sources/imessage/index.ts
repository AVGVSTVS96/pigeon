import { Database, type Statement } from "bun:sqlite";
import { existsSync, watch as watchDir } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { handleKey, isPhone } from "../../handles.ts";
import { defineSource } from "../../define.ts";
import type { Attachment, Chat, Message, Person, Query } from "../../types.ts";
import { loadContacts } from "./contacts.ts";
import { send } from "./send.ts";
import { decodeAttributedBody } from "./typedstream.ts";

export interface IMessageOptions {
  /** Defaults to "imessage". Give a second source (an archive, say) its own id. */
  id?: string;
  label?: string;
  /** Path to a chat.db. Defaults to the live one in ~/Library/Messages. */
  db?: string;
  /** The Contacts folder names are read from, or `false` to show raw handles. */
  contacts?: string | false;
}

/** chat.db stores dates as nanoseconds since 2001-01-01 (seconds in very old databases). */
const APPLE_EPOCH_MS = 978_307_200_000;
const toAppleTime = (date: Date) => (date.getTime() - APPLE_EPOCH_MS) * 1e6;
const fromAppleTime = (value: number) => new Date((value > 1e12 ? value / 1e6 : value * 1e3) + APPLE_EPOCH_MS);

/** Tapbacks are stored as messages quoting the text they react to; they never count as messages. */
const IS_CONTENT = "m.item_type = 0 AND m.associated_message_type NOT BETWEEN 2000 AND 3999";

const MESSAGE_COLUMNS = `
  m.ROWID AS rowid, m.guid, m.text, m.attributedBody AS body, m.date, m.is_from_me AS fromMe,
  m.service, m.thread_originator_guid AS replyTo, m.cache_has_attachments AS hasAttachments,
  h.id AS handle, c.chat_identifier AS chat`;

interface MessageRow {
  rowid: number;
  guid: string;
  text: string | null;
  body: Uint8Array | null;
  date: number;
  fromMe: number;
  service: string | null;
  replyTo: string | null;
  hasAttachments: number;
  handle: string | null;
  chat: string | null;
}

interface AttachmentRow {
  filename: string | null;
  name: string | null;
  mime: string | null;
}

interface ChatRow {
  rowid: number;
  guid: string;
  identifier: string;
  displayName: string | null;
  style: number;
  lastDate: number | null;
}

const expandHome = (path: string) => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

const OBJECT_REPLACEMENT = /￼/g;

export function imessage(options: IMessageOptions = {}) {
  const id = options.id ?? "imessage";
  const path = expandHome(options.db ?? "~/Library/Messages/chat.db");
  const contactsDir = options.contacts ?? "~/Library/Application Support/AddressBook";

  let db: Database | undefined;
  const open = () => {
    if (db) return db;
    try {
      db = new Database(path, { readonly: true });
      db.query("SELECT 1 FROM message LIMIT 1").get();
      return db;
    } catch (err) {
      db = undefined;
      throw new Error(
        `can't read ${path} (${err}). On macOS, give your terminal Full Disk Access in System Settings › Privacy & Security.`,
      );
    }
  };

  let contacts: Map<string, string> | undefined;
  const nameOf = (handle: string) => {
    contacts ??= contactsDir === false ? new Map() : loadContacts(expandHome(contactsDir));
    return contacts.get(handleKey(handle)) ?? handle;
  };

  /** One chat per identifier: Messages keeps separate iMessage and SMS rows for the same person and shows them as one. */
  let chatCache: { chats: Map<string, Chat>; guids: Map<string, string> } | undefined;
  const loadChats = () => {
    const rows = open()
      .query<ChatRow, []>(
        `SELECT c.ROWID AS rowid, c.guid, c.chat_identifier AS identifier, c.display_name AS displayName, c.style,
           (SELECT MAX(message_date) FROM chat_message_join WHERE chat_id = c.ROWID) AS lastDate
         FROM chat c ORDER BY lastDate`,
      )
      .all();
    const people = new Map<number, string[]>();
    for (const row of open()
      .query<{ chat: number; handle: string }, []>(
        "SELECT j.chat_id AS chat, h.id AS handle FROM chat_handle_join j JOIN handle h ON h.ROWID = j.handle_id",
      )
      .all()) {
      people.set(row.chat, [...(people.get(row.chat) ?? []), row.handle]);
    }

    const chats = new Map<string, Chat>();
    const guids = new Map<string, string>();
    for (const row of rows) {
      if (!row.identifier) continue;
      guids.set(row.identifier, row.guid);
      const previous = chats.get(row.identifier);
      const handles = new Set([...(previous?.people.map((p) => p.id) ?? []), ...(people.get(row.rowid) ?? [])]);
      const members: Person[] = [...handles].map((handle) => ({ id: handle, name: nameOf(handle) }));
      const group = row.style === 43;
      const date = row.lastDate ? fromAppleTime(row.lastDate) : previous?.date;
      const name =
        row.displayName ||
        previous?.name ||
        (group ? members.map((p) => p.name).join(", ") || row.identifier : nameOf(row.identifier));
      chats.set(row.identifier, { id: row.identifier, source: id, name, people: members, group, date });
    }
    chatCache = { chats, guids };
    return chatCache;
  };
  const chatNamed = (identifier: string) => (chatCache ?? loadChats()).chats.get(identifier)?.name ?? nameOf(identifier);

  let attachmentQuery: Statement<AttachmentRow, [number]> | undefined;
  const attachmentsOf = (rowid: number): Attachment[] => {
    attachmentQuery ??= open().query(
      `SELECT a.filename, a.transfer_name AS name, a.mime_type AS mime
       FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id
       WHERE j.message_id = ?`,
    );
    return attachmentQuery
      .all(rowid)
      .filter((a) => !a.name?.endsWith(".pluginPayloadAttachment"))
      .map((a) => {
        // With Messages in iCloud, older files often live only in the cloud.
        const path = a.filename ? expandHome(a.filename) : undefined;
        return {
          name: a.name ?? path?.split("/").pop() ?? "attachment",
          ...(path && existsSync(path) && { path }),
          ...(a.mime && { mime: a.mime }),
        };
      });
  };

  const toMessage = (row: MessageRow): Message | undefined => {
    const raw = row.text || (row.body ? decodeAttributedBody(row.body) : "");
    const text = raw.replace(OBJECT_REPLACEMENT, "").trim();
    const attachments = row.hasAttachments ? attachmentsOf(row.rowid) : [];
    if (!row.chat || (!text && attachments.length === 0)) return undefined;
    return {
      id: row.guid,
      source: id,
      chat: { id: row.chat, name: chatNamed(row.chat) },
      from: row.fromMe ? { id: "me", name: "me" } : { id: row.handle ?? "unknown", name: row.handle ? nameOf(row.handle) : "unknown" },
      text,
      date: fromAppleTime(row.date),
      attachments,
      ...(row.replyTo && { replyTo: row.replyTo }),
      ...(row.service && { service: row.service }),
    };
  };

  return defineSource({
    id,
    label: options.label ?? "iMessage",

    chats() {
      return [...loadChats().chats.values()].filter((c) => c.date);
    },

    *messages({ chat, since, until }: Query) {
      const where = [IS_CONTENT];
      const params: Record<string, string | number> = {};
      if (chat !== undefined) {
        where.push("cmj.chat_id IN (SELECT ROWID FROM chat WHERE chat_identifier = $chat)");
        params.$chat = chat;
      }
      if (since) {
        where.push("cmj.message_date >= $since");
        params.$since = toAppleTime(since);
      }
      if (until) {
        where.push("cmj.message_date < $until");
        params.$until = toAppleTime(until);
      }
      const rows = open()
        .query<MessageRow, Record<string, string | number>>(
          `SELECT ${MESSAGE_COLUMNS}
           FROM chat_message_join cmj
           JOIN message m ON m.ROWID = cmj.message_id
           JOIN chat c ON c.ROWID = cmj.chat_id
           LEFT JOIN handle h ON h.ROWID = m.handle_id
           WHERE ${where.join(" AND ")}
           ORDER BY cmj.message_date DESC, cmj.message_id DESC`,
        )
        .iterate(params);
      const seen = new Set<number>();
      for (const row of rows) {
        if (seen.has(row.rowid)) continue;
        seen.add(row.rowid);
        const message = toMessage(row);
        if (message) yield message;
      }
    },

    async *watch({ chat }: Query) {
      const after = open().query<MessageRow & { content: number }, [number]>(
        `SELECT ${MESSAGE_COLUMNS}, (${IS_CONTENT}) AS content
         FROM message m
         LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
         LEFT JOIN chat c ON c.ROWID = cmj.chat_id
         LEFT JOIN handle h ON h.ROWID = m.handle_id
         WHERE m.ROWID > ? ORDER BY m.ROWID`,
      );
      let cursor = open().query<{ max: number | null }, []>("SELECT MAX(ROWID) AS max FROM message").get()?.max ?? 0;
      const waiting = new Map<number, number>();
      for await (const _ of changes(path)) {
        for (const row of after.all(cursor)) {
          // Messages writes the row before linking it to its chat; retry a few times before giving up on it.
          if (row.content && !row.chat && (waiting.get(row.rowid) ?? 0) < 20) {
            waiting.set(row.rowid, (waiting.get(row.rowid) ?? 0) + 1);
            break;
          }
          waiting.delete(row.rowid);
          cursor = row.rowid;
          if (!row.content || (chat !== undefined && row.chat !== chat)) continue;
          if (row.chat && !chatCache?.chats.has(row.chat)) loadChats();
          const message = toMessage(row);
          if (message) yield message;
        }
      }
    },

    async send(chat, message) {
      const guid = (chatCache ?? loadChats()).guids.get(chat);
      if (guid) return send({ chat: guid }, message);
      if (isPhone(chat) || chat.includes("@")) return send({ handle: chat }, message);
      throw new Error(`no iMessage chat "${chat}"`);
    },
  });
}

/** Wakes on every write to the database folder (chat.db-wal, mostly), and every few seconds in case an event is missed. */
async function* changes(dbPath: string, fallbackMs = 3000): AsyncGenerator<void> {
  let wake: (() => void) | undefined;
  let dirty = false;
  const watcher = watchDir(dirname(dbPath), () => {
    dirty = true;
    wake?.();
  });
  try {
    while (true) {
      if (!dirty) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, fallbackMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        await Bun.sleep(50);
      }
      dirty = false;
      wake = undefined;
      yield;
    }
  } finally {
    watcher.close();
  }
}
