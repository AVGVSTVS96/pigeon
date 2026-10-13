import { describe, expect, mock, test } from "bun:test";
import { defineSource } from "../src/define.ts";
import { pigeon } from "../src/pigeon.ts";
import { REDACTED, redact } from "../src/redact.ts";
import type { Chat, Message } from "../src/types.ts";

const at = (hour: number) => new Date(2026, 9, 6, hour);

function msg(source: string, chat: string, hour: number, text: string): Message {
  return {
    id: `${source}-${chat}-${hour}`,
    source,
    chat: { id: chat, name: chat },
    from: { id: chat, name: chat },
    text,
    date: at(hour),
    attachments: [],
  };
}

/** A source that ignores its query, the laziest one allowed. */
function memory(id: string, messages: Message[], extra: Partial<Parameters<typeof defineSource>[0]> = {}) {
  const chats: Chat[] = [...new Set(messages.map((m) => m.chat.id))].map((c) => ({
    id: c,
    source: id,
    name: c,
    people: [],
    group: false,
    date: messages.find((m) => m.chat.id === c)?.date,
  }));
  return defineSource({
    id,
    chats: () => chats,
    messages: () => [...messages].sort((a, b) => b.date.getTime() - a.date.getTime()),
    ...extra,
  });
}

async function all(stream: AsyncIterable<Message>): Promise<Message[]> {
  const out: Message[] = [];
  for await (const m of stream) out.push(m);
  return out;
}

const texts = (messages: Message[]) => messages.map((m) => m.text);

const imsg = memory("imessage", [
  msg("imessage", "riley", 9, "morning"),
  msg("imessage", "riley", 11, "the gate code is 4321"),
  msg("imessage", "family", 13, "dinner at 7"),
]);
const tg = memory("telegram", [msg("telegram", "work", 10, "standup moved"), msg("telegram", "work", 12, "ship it")]);

describe("pigeon messages", () => {
  test("merges sources newest first", async () => {
    expect(texts(await all(pigeon({ sources: [imsg, tg] }).messages()))).toEqual([
      "dinner at 7",
      "ship it",
      "the gate code is 4321",
      "standup moved",
      "morning",
    ]);
  });

  test("enforces chat, since, until and limit even when a source ignores them", async () => {
    const p = pigeon({ sources: [imsg, tg] });
    expect(texts(await all(p.messages({ chat: "riley" })))).toEqual(["the gate code is 4321", "morning"]);
    expect(texts(await all(p.messages({ since: at(11), until: at(13) })))).toEqual(["ship it", "the gate code is 4321"]);
    expect(texts(await all(p.messages({ limit: 2 })))).toEqual(["dinner at 7", "ship it"]);
  });

  test("searches after filters run, so hidden text can't be found", async () => {
    const p = pigeon({ sources: [imsg], filters: [redact({ chat: "riley", match: /\d{4}/ })] });
    expect(texts(await all(p.messages({ text: "4321" })))).toEqual([]);
    expect(texts(await all(p.messages({ text: "GATE code" })))).toEqual([`the gate code is ${REDACTED}`]);
  });

  test("filters keep, drop, or replace", async () => {
    const p = pigeon({
      sources: [imsg],
      filters: [(m) => m.chat.id !== "family", (m) => ({ ...m, text: m.text.toUpperCase() })],
    });
    expect(texts(await all(p.messages()))).toEqual(["THE GATE CODE IS 4321", "MORNING"]);
  });

  test("fails closed: a filter that throws or returns junk drops the message", async () => {
    const error = mock(() => {});
    const original = console.error;
    console.error = error;
    try {
      const throws = pigeon({ sources: [imsg], filters: [(m) => (m.text === "morning" ? true : JSON.parse("{"))] });
      expect(texts(await all(throws.messages()))).toEqual(["morning"]);
      expect(error).toHaveBeenCalledTimes(1);
      const junk = pigeon({ sources: [imsg], filters: [() => undefined as unknown as boolean] });
      expect(await all(junk.messages())).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});

describe("pigeon chats", () => {
  const p = pigeon({ sources: [imsg, tg] });

  test("lists every source's chats, most recent first", async () => {
    expect((await p.chats()).map((c) => c.id)).toEqual(["family", "work", "riley"]);
  });

  test("resolves a chat by id, name, or part of a name", async () => {
    expect((await p.chat("work")).source).toBe("telegram");
    expect((await p.chat("fam")).id).toBe("family");
    await expect(p.chat("nobody")).rejects.toThrow('no chat matches "nobody"');
    await expect(p.chat("r")).rejects.toThrow(/matches 2 chats/);
  });
});

describe("pigeon watch", () => {
  test("merges live sources and filters what they yield", async () => {
    const live = (id: string, messages: Message[]) =>
      memory(id, [], {
        async *watch() {
          for (const m of messages) {
            await Bun.sleep(5);
            yield m;
          }
        },
      });
    const p = pigeon({
      sources: [live("imessage", [msg("imessage", "riley", 9, "a"), msg("imessage", "riley", 10, "secret")]), live("telegram", [msg("telegram", "work", 9, "b")])],
      filters: [redact({ match: "secret" })],
    });
    expect(texts(await all(p.watch())).sort()).toEqual(["[redacted]", "a", "b"]);
  });

  test("refuses when no source can watch", async () => {
    await expect(all(pigeon({ sources: [imsg] }).watch())).rejects.toThrow(/can watch/);
  });
});

describe("pigeon send", () => {
  test("sends through the chat's source, or to a new handle via the first source that can send", async () => {
    const sent: [string, string][] = [];
    const sender = memory("imessage", [msg("imessage", "riley", 9, "hi")], {
      async send(chat, message) {
        sent.push([chat, message.text ?? ""]);
      },
    });
    const p = pigeon({ sources: [tg, sender] });
    await p.send("riley", { text: "hello" });
    await p.send("+12125550100", { text: "new number" });
    expect(sent).toEqual([
      ["riley", "hello"],
      ["+12125550100", "new number"],
    ]);
    await expect(p.send("work", { text: "x" })).rejects.toThrow("telegram can't send messages");
  });
});
