import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import archives from "./fixtures/attributed-body.json";

export { default as archives } from "./fixtures/attributed-body.json";

const APPLE_EPOCH_MS = 978_307_200_000;
const appleTime = (date: Date) => (date.getTime() - APPLE_EPOCH_MS) * 1e6;

export const hex = (h: string) =>
  Uint8Array.from(h.match(/../gu) ?? [], (b) => Number.parseInt(b, 16));

const ONE_BYTE_MAX = 0x80;
const TWO_BYTE_LENGTH = 0x81;

const lengthPrefix = (length: number) =>
  length < ONE_BYTE_MAX
    ? [length]
    : [TWO_BYTE_LENGTH, length % 256, Math.floor(length / 256) % 256];

export const encodeBody = (text: string): Uint8Array => {
  const hello = hex(archives[0]?.hex ?? "");
  const at = hello.findIndex((b, i) => b === 0x01 && hello[i + 1] === 0x2b) + 2;
  const bytes = new TextEncoder().encode(text);

  return new Uint8Array([
    ...hello.subarray(0, at),
    ...lengthPrefix(bytes.length),
    ...bytes,
    ...hello.subarray(at + 1 + 5),
  ]);
};

const SCHEMA = `
  CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, service TEXT NOT NULL);
  CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER,
    chat_identifier TEXT, service_name TEXT, display_name TEXT);
  CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
  CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT,
    handle_id INTEGER DEFAULT 0, attributedBody BLOB, service TEXT, date INTEGER, is_from_me INTEGER DEFAULT 0,
    item_type INTEGER DEFAULT 0, associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0,
    cache_has_attachments INTEGER DEFAULT 0, thread_originator_guid TEXT);
  CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER DEFAULT 0,
    PRIMARY KEY (chat_id, message_id));
  CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, mime_type TEXT, transfer_name TEXT);
  CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);`;

export interface FakeMessage {
  chat: number;
  from: string;
  text?: string;
  bodyOnly?: boolean;
  date: Date;
  service?: string;
  attachments?: { name: string; mime?: string; path?: string }[];
  reactionTo?: string;
  itemType?: number;
  replyTo?: string;
  unlinked?: boolean;
}

export const fakeChatDb = (dir = mkdtempSync(path.join(tmpdir(), "pigeon-"))) => {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "chat.db");
  const db = new Database(file, { create: true });

  db.run("PRAGMA journal_mode = WAL");
  db.run(SCHEMA);
  let guid = 0;

  const handle = (id: string, service = "iMessage") =>
    db
      .query<{ ROWID: number }, [string, string]>(
        "SELECT ROWID FROM handle WHERE id = ? AND service = ?",
      )
      .get(id, service)?.ROWID ??
    Number(
      db.query("INSERT INTO handle (id, service) VALUES (?, ?)").run(id, service).lastInsertRowid,
    );

  return {
    dir,
    path: file,
    db,
    chat({
      id,
      handles = [id],
      name,
      group = false,
      service = "iMessage",
    }: {
      id: string;
      handles?: string[];
      name?: string;
      group?: boolean;
      service?: string;
    }): number {
      const rowid = Number(
        db
          .query(
            "INSERT INTO chat (guid, style, chat_identifier, service_name, display_name) VALUES (?, ?, ?, ?, ?)",
          )
          .run(`${service};${group ? "+" : "-"};${id}`, group ? 43 : 45, id, service, name ?? null)
          .lastInsertRowid,
      );

      for (const h of handles) {
        db.query("INSERT INTO chat_handle_join VALUES (?, ?)").run(rowid, handle(h, service));
      }

      return rowid;
    },
    link(message: number, chat: number) {
      const row = db
        .query<{ date: number }, [number]>("SELECT date FROM message WHERE ROWID = ?")
        .get(message);

      db.query("INSERT INTO chat_message_join VALUES (?, ?, ?)").run(chat, message, row?.date ?? 0);
    },
    message(m: FakeMessage) {
      guid += 1;
      const id = `GUID-${guid}`;
      const fromMe = m.from === "me";

      const rowid = Number(
        db
          .query(
            `INSERT INTO message (guid, text, handle_id, attributedBody, service, date, is_from_me, item_type,
              associated_message_guid, associated_message_type, cache_has_attachments, thread_originator_guid)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            m.bodyOnly === true ? null : (m.text ?? null),
            fromMe ? 0 : handle(m.from, m.service ?? "iMessage"),
            m.text === undefined ? null : encodeBody(m.text),
            m.service ?? "iMessage",
            appleTime(m.date),
            fromMe ? 1 : 0,
            m.itemType ?? 0,
            m.reactionTo === undefined ? null : `p:0/${m.reactionTo}`,
            m.reactionTo === undefined ? 0 : 2000,
            (m.attachments?.length ?? 0) > 0 ? 1 : 0,
            m.replyTo ?? null,
          ).lastInsertRowid,
      );

      if (m.unlinked !== true) {
        this.link(rowid, m.chat);
      }

      for (const a of m.attachments ?? []) {
        const attachment = db
          .query("INSERT INTO attachment (filename, mime_type, transfer_name) VALUES (?, ?, ?)")
          .run(
            a.path ?? `~/Library/Messages/Attachments/00/${a.name}`,
            a.mime ?? null,
            a.name,
          ).lastInsertRowid;

        db.query("INSERT INTO message_attachment_join VALUES (?, ?)").run(rowid, attachment);
      }

      return { rowid, guid: id };
    },
  };
};

export const fakeContacts = (
  people: { first: string; last?: string; phones?: string[]; emails?: string[] }[],
) => {
  const root = mkdtempSync(path.join(tmpdir(), "pigeon-ab-"));

  mkdirSync(path.join(root, "Sources", "A"), { recursive: true });

  const db = new Database(path.join(root, "Sources", "A", "AddressBook-v22.abcddb"), {
    create: true,
  });

  db.run(`
    CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZNICKNAME TEXT, ZORGANIZATION TEXT);
    CREATE TABLE ZABCDPHONENUMBER (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZFULLNUMBER TEXT);
    CREATE TABLE ZABCDEMAILADDRESS (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZADDRESS TEXT);`);

  for (const p of people) {
    const id = db
      .query("INSERT INTO ZABCDRECORD (ZFIRSTNAME, ZLASTNAME) VALUES (?, ?)")
      .run(p.first, p.last ?? null).lastInsertRowid;

    for (const phone of p.phones ?? []) {
      db.query("INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) VALUES (?, ?)").run(id, phone);
    }

    for (const email of p.emails ?? []) {
      db.query("INSERT INTO ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) VALUES (?, ?)").run(id, email);
    }
  }

  db.close();

  return root;
};
