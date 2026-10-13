import { beforeAll, describe, expect, test } from "bun:test";
import { imessage } from "../src/sources/imessage/index.ts";
import type { Message } from "../src/types.ts";
import { fakeChatDb, fakeContacts } from "./fixture.ts";

const RILEY = "+12125550100";
const SAM = "sam@example.com";
const day = (d: number, h = 12, m = 0) => new Date(2026, 9, d, h, m);

const fake = fakeChatDb();
const rileyIm = fake.chat({ id: RILEY });
const rileySms = fake.chat({ id: RILEY, service: "SMS" });
const group = fake.chat({ id: "chat900", handles: [RILEY, SAM], group: true });
const named = fake.chat({ id: "chat901", handles: [SAM], group: true, name: "Book club" });
fake.chat({ id: "+12125550111" });

const first = fake.message({ chat: rileyIm, from: RILEY, text: "hey", date: day(1) });
fake.message({ chat: rileySms, from: RILEY, text: "sent over sms", service: "SMS", date: day(2) });
fake.message({ chat: rileyIm, from: "me", text: "new macOS keeps text here", bodyOnly: true, date: day(3) });
fake.message({ chat: rileyIm, from: RILEY, text: "Loved “hey”", reactionTo: first.guid, date: day(3, 13) });
fake.message({ chat: rileyIm, from: RILEY, date: day(3, 14), itemType: 1 });
fake.message({ chat: group, from: SAM, text: "￼", attachments: [{ name: "IMG_0001.heic", mime: "image/heic" }], date: day(4) });
fake.message({ chat: group, from: RILEY, text: "nice", replyTo: first.guid, date: day(5) });
fake.message({ chat: named, from: SAM, text: "chapter 3 tonight", date: day(6) });

const contacts = fakeContacts([{ first: "Riley", last: "Quinn", phones: ["(212) 555-0100"] }]);
const source = imessage({ db: fake.path, contacts });

async function all(stream: AsyncIterable<Message> | Iterable<Message>): Promise<Message[]> {
  const out: Message[] = [];
  for await (const m of stream) out.push(m);
  return out;
}

describe("imessage chats", () => {
  let chats: Awaited<ReturnType<typeof source.chats>>;
  beforeAll(async () => {
    chats = await source.chats();
  });

  test("merges a person's iMessage and SMS threads into one chat, like Messages does", () => {
    expect(chats.filter((c) => c.id === RILEY)).toHaveLength(1);
  });

  test("names chats from Contacts, group names, or their members", () => {
    const byId = Object.fromEntries(chats.map((c) => [c.id, c]));
    expect(byId[RILEY]).toMatchObject({ name: "Riley Quinn", group: false, people: [{ id: RILEY, name: "Riley Quinn" }] });
    expect(byId.chat900).toMatchObject({ name: `Riley Quinn, ${SAM}`, group: true });
    expect(byId.chat901?.name).toBe("Book club");
  });

  test("skips chats with no messages", () => {
    expect(chats.map((c) => c.id)).not.toContain("+12125550111");
  });
});

describe("imessage messages", () => {
  test("streams newest first across every chat", async () => {
    const texts = (await all(source.messages({}))).map((m) => m.text);
    expect(texts).toEqual(["chapter 3 tonight", "nice", "", "new macOS keeps text here", "sent over sms", "hey"]);
  });

  test("reads one chat across services", async () => {
    const messages = await all(source.messages({ chat: RILEY }));
    expect(messages.map((m) => m.service)).toEqual(["iMessage", "SMS", "iMessage"]);
    expect(messages.every((m) => m.chat.id === RILEY && m.chat.name === "Riley Quinn")).toBe(true);
  });

  test("decodes text that only lives in attributedBody", async () => {
    const [mine] = await all(source.messages({ chat: RILEY, since: day(3), until: day(4) }));
    expect(mine).toMatchObject({ text: "new macOS keeps text here", from: { id: "me", name: "me" } });
  });

  test("never surfaces tapbacks, which quote the message they react to", async () => {
    const texts = (await all(source.messages({}))).map((m) => m.text);
    expect(texts.some((t) => t.includes("Loved"))).toBe(false);
  });

  test("lists attachments and drops the placeholder character", async () => {
    const [photo] = await all(source.messages({ chat: "chat900", until: day(5) }));
    expect(photo?.text).toBe("");
    expect(photo?.attachments).toEqual([
      { name: "IMG_0001.heic", path: expect.stringMatching(/\/Library\/Messages\/Attachments\/00\/IMG_0001\.heic$/), mime: "image/heic" },
    ]);
  });

  test("keeps the id of the message being replied to", async () => {
    const [reply] = await all(source.messages({ chat: "chat900", since: day(5) }));
    expect(reply?.replyTo).toBe(first.guid);
  });

  test("explains how to fix a database it can't open", () => {
    const missing = imessage({ db: "/nonexistent/chat.db", contacts: false });
    expect(() => missing.chats()).toThrow(/Full Disk Access/);
  });
});

describe("imessage watch", () => {
  test("yields messages written after it starts, once they're linked to a chat", async () => {
    const live = source.watch({})[Symbol.asyncIterator]();
    const next = live.next();
    await Bun.sleep(100);
    const late = fake.message({ chat: named, from: SAM, text: "running late", date: day(7), unlinked: true });
    await Bun.sleep(100);
    fake.link(late.rowid, named);
    fake.message({ chat: rileyIm, from: RILEY, text: "Liked “running late”", reactionTo: late.guid, date: day(7, 13) });
    fake.message({ chat: rileyIm, from: RILEY, text: "on my way", date: day(7, 14) });

    expect((await next).value).toMatchObject({ text: "running late", chat: { id: "chat901", name: "Book club" } });
    expect((await live.next()).value).toMatchObject({ text: "on my way", from: { name: "Riley Quinn" } });
    await live.return?.();
  });
});
