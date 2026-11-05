import { Database } from "bun:sqlite";
import type { Statement } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { defineSource } from "../../define.ts";
import { handleKey, isPhone } from "../../handles.ts";
import type { Attachment, Chat, Message, Person, Query } from "../../types.ts";
import { changes } from "./changes.ts";
import {
  filled,
  fromAppleTime,
  GROUP_CHAT_STYLE,
  IS_CONTENT_NOT_TAPBACK,
  MESSAGE_COLUMNS,
  toAppleTime,
} from "./chat-db.ts";
import type { AttachmentRow, ChatRow, MessageRow } from "./chat-db.ts";
import { loadContacts } from "./contacts.ts";
import { send } from "./send.ts";
import { decodeAttributedBody } from "./typedstream.ts";

export interface IMessageOptions {
  id?: string;
  label?: string;
  db?: string;
  contacts?: string | false;
}

const OBJECT_REPLACEMENT = /￼/gu;
const PLUGIN_PAYLOAD = ".pluginPayloadAttachment";
const MAX_CHAT_LINK_RETRIES = 20;

const expandHome = (file: string) =>
  file.startsWith("~/") ? path.join(homedir(), file.slice(2)) : file;

const downloadedPath = (filename: string | null): string | undefined => {
  const file = filename === null ? undefined : expandHome(filename);

  return file !== undefined && existsSync(file) ? file : undefined;
};

interface ChatIndex {
  chats: Map<string, Chat>;
  guids: Map<string, string>;
}

type SqlParams = Record<string, string | number>;

export const imessage = (options: IMessageOptions = {}) => {
  const id = options.id ?? "imessage";
  const dbPath = expandHome(options.db ?? "~/Library/Messages/chat.db");
  const contactsDir = options.contacts ?? "~/Library/Application Support/AddressBook";

  let db: Database | undefined;

  const open = () => {
    if (db) {
      return db;
    }

    try {
      db = new Database(dbPath, { readonly: true });
      db.query("SELECT 1 FROM message LIMIT 1").get();

      return db;
    } catch (error) {
      db = undefined;
      throw new Error(
        `can't read ${dbPath} (${String(error)}). On macOS, give your terminal Full Disk Access in System Settings › Privacy & Security.`,
        { cause: error },
      );
    }
  };

  let contacts: Map<string, string> | undefined;

  const nameOf = (handle: string) => {
    contacts ??= contactsDir === false ? new Map() : loadContacts(expandHome(contactsDir));

    return contacts.get(handleKey(handle)) ?? handle;
  };

  const peopleByChat = () => {
    const people = new Map<number, string[]>();

    const rows = open()
      .query<{ chat: number; handle: string }, []>(
        "SELECT j.chat_id AS chat, h.id AS handle FROM chat_handle_join j JOIN handle h ON h.ROWID = j.handle_id",
      )
      .all();

    for (const row of rows) {
      people.set(row.chat, [...(people.get(row.chat) ?? []), row.handle]);
    }

    return people;
  };

  let chatIndex: ChatIndex | undefined;

  const loadChatsMergedByIdentifier = (): ChatIndex => {
    const rows = open()
      .query<ChatRow, []>(
        `SELECT c.ROWID AS rowid, c.guid, c.chat_identifier AS identifier, c.display_name AS displayName, c.style,
           (SELECT MAX(message_date) FROM chat_message_join WHERE chat_id = c.ROWID) AS lastDate
         FROM chat c ORDER BY lastDate`,
      )
      .all();

    const people = peopleByChat();
    const chats = new Map<string, Chat>();
    const guids = new Map<string, string>();

    for (const row of rows.filter((r) => filled(r.identifier) !== undefined)) {
      guids.set(row.identifier, row.guid);
      const previous = chats.get(row.identifier);

      const handles = new Set([
        ...(previous?.people.map((p) => p.id) ?? []),
        ...(people.get(row.rowid) ?? []),
      ]);

      const members: Person[] = [...handles].map((handle) => ({
        id: handle,
        name: nameOf(handle),
      }));

      const group = row.style === GROUP_CHAT_STYLE;

      const date =
        row.lastDate === null || row.lastDate === 0 ? previous?.date : fromAppleTime(row.lastDate);

      const memberNames = filled(members.map((p) => p.name).join(", ")) ?? row.identifier;

      const name =
        filled(row.displayName) ??
        filled(previous?.name) ??
        (group ? memberNames : nameOf(row.identifier));

      chats.set(row.identifier, {
        id: row.identifier,
        source: id,
        name,
        people: members,
        group,
        ...(date && { date }),
      });
    }

    chatIndex = { chats, guids };

    return chatIndex;
  };

  const chatNamed = (identifier: string) =>
    (chatIndex ?? loadChatsMergedByIdentifier()).chats.get(identifier)?.name ?? nameOf(identifier);

  let attachmentQuery: Statement<AttachmentRow, [number]> | undefined;

  const attachmentsOf = (rowid: number): Attachment[] => {
    attachmentQuery ??= open().query(
      `SELECT a.filename, a.transfer_name AS name, a.mime_type AS mime
       FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id
       WHERE j.message_id = ?`,
    );

    return attachmentQuery
      .all(rowid)
      .filter((a) => a.name?.endsWith(PLUGIN_PAYLOAD) !== true)
      .map((a) => {
        const file = downloadedPath(a.filename);

        return {
          name: a.name ?? a.filename?.split("/").pop() ?? "attachment",
          ...(file !== undefined && { path: file }),
          ...(a.mime !== null && a.mime !== "" && { mime: a.mime }),
        };
      });
  };

  const sender = (row: MessageRow): Person => {
    if (row.fromMe !== 0) {
      return { id: "me", name: "me" };
    }

    return row.handle === null
      ? { id: "unknown", name: "unknown" }
      : { id: row.handle, name: nameOf(row.handle) };
  };

  const toMessage = (row: MessageRow): Message | undefined => {
    const raw = filled(row.text) ?? (row.body ? decodeAttributedBody(row.body) : "");
    const text = raw.replaceAll(OBJECT_REPLACEMENT, "").trim();
    const attachments = row.hasAttachments === 0 ? [] : attachmentsOf(row.rowid);
    const chat = filled(row.chat);

    if (chat === undefined || (text === "" && attachments.length === 0)) {
      return undefined;
    }

    const replyTo = filled(row.replyTo);
    const service = filled(row.service);

    return {
      id: row.guid,
      source: id,
      chat: { id: chat, name: chatNamed(chat) },
      from: sender(row),
      text,
      date: fromAppleTime(row.date),
      attachments,
      ...(replyTo !== undefined && { replyTo }),
      ...(service !== undefined && { service }),
    };
  };

  const messages = function* messages({ chat, since, until }: Query) {
    const where = [IS_CONTENT_NOT_TAPBACK];
    const params: SqlParams = {};

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

    const statement = open().prepare<MessageRow, SqlParams>(
      `SELECT ${MESSAGE_COLUMNS}
       FROM chat_message_join cmj
       JOIN message m ON m.ROWID = cmj.message_id
       JOIN chat c ON c.ROWID = cmj.chat_id
       LEFT JOIN handle h ON h.ROWID = m.handle_id
       WHERE ${where.join(" AND ")}
       ORDER BY cmj.message_date DESC, cmj.message_id DESC`,
    );

    const seen = new Set<number>();

    try {
      for (const row of statement.iterate(params)) {
        const message = seen.has(row.rowid) ? undefined : toMessage(row);

        seen.add(row.rowid);

        if (message) {
          yield message;
        }
      }
    } finally {
      statement.finalize();
    }
  };

  const watch = async function* watch({ chat }: Query) {
    const after = open().query<MessageRow & { content: number }, [number]>(
      `SELECT ${MESSAGE_COLUMNS}, (${IS_CONTENT_NOT_TAPBACK}) AS content
       FROM message m
       LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       LEFT JOIN chat c ON c.ROWID = cmj.chat_id
       LEFT JOIN handle h ON h.ROWID = m.handle_id
       WHERE m.ROWID > ? ORDER BY m.ROWID`,
    );

    const latest = open()
      .query<{ max: number | null }, []>("SELECT MAX(ROWID) AS max FROM message")
      .get();

    let cursor = latest?.max ?? 0;
    const waitingForChatLink = new Map<number, number>();

    for await (const _ of changes(dbPath)) {
      for (const row of after.all(cursor)) {
        const tries = waitingForChatLink.get(row.rowid) ?? 0;

        if (row.content !== 0 && row.chat === null && tries < MAX_CHAT_LINK_RETRIES) {
          waitingForChatLink.set(row.rowid, tries + 1);
          break;
        }

        waitingForChatLink.delete(row.rowid);
        cursor = row.rowid;
        const wanted = row.content !== 0 && (chat === undefined || row.chat === chat);

        if (wanted && row.chat !== null && chatIndex?.chats.has(row.chat) !== true) {
          loadChatsMergedByIdentifier();
        }

        const message = wanted ? toMessage(row) : undefined;

        if (message) {
          yield message;
        }
      }
    }
  };

  return defineSource({
    id,
    label: options.label ?? "iMessage",
    chats: () => [...loadChatsMergedByIdentifier().chats.values()].filter((c) => c.date),
    messages,
    watch,
    send: async (chat, message) => {
      const guid = (chatIndex ?? loadChatsMergedByIdentifier()).guids.get(chat);

      if (guid !== undefined) {
        await send({ chat: guid }, message);
      } else if (isPhone(chat) || chat.includes("@")) {
        await send({ handle: chat }, message);
      } else {
        throw new Error(`no iMessage chat "${chat}"`);
      }
    },
  });
};
