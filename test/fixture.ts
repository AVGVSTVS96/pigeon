import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import archives from "./fixtures/attributed-body.json";

const APPLE_EPOCH_MS = 978_307_200_000;
const appleTime = (date: Date) => (date.getTime() - APPLE_EPOCH_MS) * 1e6;

const hex = (h: string) => Uint8Array.from(h.match(/../g)!, (b) => parseInt(b, 16));

/** A real NSArchiver blob for "hello", re-framed around any text. */
export function encodeBody(text: string): Uint8Array {
  const hello = hex(archives[0]!.hex);
  const at = hello.findIndex((b, i) => b === 0x01 && hello[i + 1] === 0x2b) + 2;
  const bytes = new TextEncoder().encode(text);
  const length =
    bytes.length < 0x80 ? [bytes.length] : [0x81, bytes.length & 0xff, (bytes.length >> 8) & 0xff];
  return new Uint8Array([...hello.subarray(0, at), ...length, ...bytes, ...hello.subarray(at + 1 + 5)]);
}

export { archives, hex };

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
  /** A handle, or "me". */
  from: string;
  text?: string;
  /** Store the text only in attributedBody, like newer macOS does. */
  bodyOnly?: boolean;
  date: Date;
  service?: string;
  attachments?: { name: string; mime?: string }[];
  reactionTo?: string;
  itemType?: number;
  replyTo?: string;
  /** Write the message without linking it to its chat yet. */
  unlinked?: boolean;
}

/** A chat.db with the tables pigeon reads, filled with made-up people. */
export function fakeChatDb(dir = mkdtempSync(join(tmpdir(), "pigeon-"))) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "chat.db");
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  let guid = 0;

  const handle = (id: string, service = "iMessage") =>
    db.query<{ ROWID: number }, [string, string]>("SELECT ROWID FROM handle WHERE id = ? AND service = ?").get(id, service)
      ?.ROWID ?? Number(db.query("INSERT INTO handle (id, service) VALUES (?, ?)").run(id, service).lastInsertRowid);

  return {
    dir,
    path,
    db,
    chat({ id, handles = [id], name, group = false, service = "iMessage" }: {
      id: string;
      handles?: string[];
      name?: string;
      group?: boolean;
      service?: string;
    }): number {
      const rowid = Number(
        db
          .query("INSERT INTO chat (guid, style, chat_identifier, service_name, display_name) VALUES (?, ?, ?, ?, ?)")
          .run(`${service};${group ? "+" : "-"};${id}`, group ? 43 : 45, id, service, name ?? null).lastInsertRowid,
      );
      for (const h of handles) db.query("INSERT INTO chat_handle_join VALUES (?, ?)").run(rowid, handle(h, service));
      return rowid;
    },
    link(message: number, chat: number) {
      const date = db.query<{ date: number }, [number]>("SELECT date FROM message WHERE ROWID = ?").get(message)!.date;
      db.query("INSERT INTO chat_message_join VALUES (?, ?, ?)").run(chat, message, date);
    },
    message(m: FakeMessage): { rowid: number; guid: string } {
      const id = `GUID-${++guid}`;
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
            m.bodyOnly ? null : (m.text ?? null),
            fromMe ? 0 : handle(m.from, m.service ?? "iMessage"),
            m.text === undefined ? null : encodeBody(m.text),
            m.service ?? "iMessage",
            appleTime(m.date),
            fromMe ? 1 : 0,
            m.itemType ?? 0,
            m.reactionTo ? `p:0/${m.reactionTo}` : null,
            m.reactionTo ? 2000 : 0,
            m.attachments?.length ? 1 : 0,
            m.replyTo ?? null,
          ).lastInsertRowid,
      );
      if (!m.unlinked) this.link(rowid, m.chat);
      for (const a of m.attachments ?? []) {
        const attachment = db
          .query("INSERT INTO attachment (filename, mime_type, transfer_name) VALUES (?, ?, ?)")
          .run(`~/Library/Messages/Attachments/00/${a.name}`, a.mime ?? null, a.name).lastInsertRowid;
        db.query("INSERT INTO message_attachment_join VALUES (?, ?)").run(rowid, attachment);
      }
      return { rowid, guid: id };
    },
  };
}

/** A Contacts database in the layout macOS keeps under ~/Library/Application Support/AddressBook. */
export function fakeContacts(people: { first: string; last?: string; phones?: string[]; emails?: string[] }[]) {
  const root = mkdtempSync(join(tmpdir(), "pigeon-ab-"));
  mkdirSync(join(root, "Sources", "A"), { recursive: true });
  const db = new Database(join(root, "Sources", "A", "AddressBook-v22.abcddb"), { create: true });
  db.exec(`
    CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZNICKNAME TEXT, ZORGANIZATION TEXT);
    CREATE TABLE ZABCDPHONENUMBER (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZFULLNUMBER TEXT);
    CREATE TABLE ZABCDEMAILADDRESS (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZADDRESS TEXT);`);
  for (const p of people) {
    const id = db.query("INSERT INTO ZABCDRECORD (ZFIRSTNAME, ZLASTNAME) VALUES (?, ?)").run(p.first, p.last ?? null)
      .lastInsertRowid;
    for (const phone of p.phones ?? []) db.query("INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) VALUES (?, ?)").run(id, phone);
    for (const email of p.emails ?? []) db.query("INSERT INTO ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) VALUES (?, ?)").run(id, email);
  }
  db.close();
  return root;
}
