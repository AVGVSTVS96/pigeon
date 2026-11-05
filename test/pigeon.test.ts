import { describe, expect, mock, test } from "bun:test";

import { defineSource } from "../src/define.ts";
import { pigeon } from "../src/pigeon.ts";
import { REDACTED, redact } from "../src/redact.ts";
import type { Chat, Filter, Message, Source } from "../src/types.ts";

const at = (hour: number) => new Date(2026, 9, 6, hour);

const msg = (source: string, chat: string, hour: number, text: string): Message => ({
  id: `${source}-${chat}-${hour}`,
  source,
  chat: { id: chat, name: chat },
  from: { id: chat, name: chat },
  text,
  date: at(hour),
  attachments: [],
});

const sourceIgnoringItsQuery = (id: string, messages: Message[], extra: Partial<Source> = {}) => {
  const chats: Chat[] = [...new Set(messages.map((m) => m.chat.id))].map((c) => {
    const date = messages.find((m) => m.chat.id === c)?.date;

    return { id: c, source: id, name: c, people: [], group: false, ...(date && { date }) };
  });

  return defineSource({
    id,
    chats: () => chats,
    messages: () => messages.toSorted((a, b) => b.date.getTime() - a.date.getTime()),
    ...extra,
  });
};

const failure = async <T>(promise: Promise<T>) => {
  try {
    await promise;

    return "resolved";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const all = async (stream: AsyncIterable<Message>): Promise<Message[]> => {
  const out: Message[] = [];

  for await (const m of stream) {
    out.push(m);
  }

  return out;
};

type UntypedFilter = (
  message: Message,
) => boolean | Message | undefined | Promise<Message> | Pick<Message, "text">;

// SAFETY: a JavaScript config can hand pigeon any function as a filter; these stand in for one
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tests feed pigeon what untyped config code could
const fromJavaScript = (filter: UntypedFilter) => filter as Filter;

const texts = (messages: Message[]) => messages.map((m) => m.text);

const imsg = sourceIgnoringItsQuery("imessage", [
  msg("imessage", "riley", 9, "morning"),
  msg("imessage", "riley", 11, "the gate code is 4321"),
  msg("imessage", "family", 13, "dinner at 7"),
]);

const tg = sourceIgnoringItsQuery("telegram", [
  msg("telegram", "work", 10, "standup moved"),
  msg("telegram", "work", 12, "ship it"),
]);

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
    expect(texts(await all(p.messages({ chat: "riley" })))).toEqual([
      "the gate code is 4321",
      "morning",
    ]);
    expect(texts(await all(p.messages({ since: at(11), until: at(13) })))).toEqual([
      "ship it",
      "the gate code is 4321",
    ]);
    expect(texts(await all(p.messages({ limit: 2 })))).toEqual(["dinner at 7", "ship it"]);
  });

  test("searches after filters run, so hidden text can't be found", async () => {
    const p = pigeon({ sources: [imsg], filters: [redact({ chat: "riley", match: /\d{4}/u })] });
    expect(texts(await all(p.messages({ text: "4321" })))).toEqual([]);
    expect(texts(await all(p.messages({ text: "GATE code" })))).toEqual([
      `the gate code is ${REDACTED}`,
    ]);
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
      const throws = pigeon({
        sources: [imsg],
        filters: [
          (m) => {
            if (m.text === "morning") {
              return true;
            }

            throw new Error("a filter with a bug");
          },
        ],
      });

      expect(texts(await all(throws.messages()))).toEqual(["morning"]);
      expect(error).toHaveBeenCalledTimes(1);
      const junk = pigeon({ sources: [imsg], filters: [fromJavaScript(() => {})] });
      expect(await all(junk.messages())).toEqual([]);

      const async = pigeon({
        sources: [imsg],
        filters: [
          fromJavaScript(async (m: Message) => {
            await Bun.sleep(0);

            return m;
          }),
        ],
      });

      expect(await all(async.messages())).toEqual([]);

      const partial = pigeon({
        sources: [imsg],
        filters: [fromJavaScript((m) => ({ text: m.text }))],
      });

      expect(await all(partial.messages())).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});

describe("pigeon chats", () => {
  const p = pigeon({ sources: [imsg, tg] });

  test("lists every source's chats, most recent first", async () => {
    const chats = await p.chats();

    expect(chats.map((c) => c.id)).toEqual(["family", "work", "riley"]);
  });

  test("resolves a chat by id, name, or part of a name", async () => {
    expect(await p.chat("work")).toMatchObject({ source: "telegram" });
    expect(await p.chat("fam")).toMatchObject({ id: "family" });
    expect(await failure(p.chat("nobody"))).toContain('no chat matches "nobody"');
    expect(await failure(p.chat("r"))).toMatch(/matches 2 chats/u);
  });
});

const live = (id: string, messages: Message[]) =>
  sourceIgnoringItsQuery(id, [], {
    watch: async function* watch() {
      for (const m of messages) {
        await Bun.sleep(5);
        yield m;
      }
    },
  });

describe("pigeon watch", () => {
  test("merges live sources and filters what they yield", async () => {
    const p = pigeon({
      sources: [
        live("imessage", [
          msg("imessage", "riley", 9, "a"),
          msg("imessage", "riley", 10, "secret"),
        ]),
        live("telegram", [msg("telegram", "work", 9, "b")]),
      ],
      filters: [redact({ match: "secret" })],
    });

    expect(texts(await all(p.watch())).toSorted()).toEqual(["[redacted]", "a", "b"]);
  });

  test("refuses when no source can watch", async () => {
    expect(await failure(all(pigeon({ sources: [imsg] }).watch()))).toMatch(/can watch/u);
  });
});

describe("pigeon send", () => {
  test("sends through the chat's source, or to a new handle via the first source that can send", async () => {
    const sent: [string, string][] = [];

    const sender = sourceIgnoringItsQuery("imessage", [msg("imessage", "riley", 9, "hi")], {
      send: async (chat, message) => {
        sent.push([chat, message.text ?? ""]);
        await Promise.resolve();
      },
    });

    const p = pigeon({ sources: [tg, sender] });
    await p.send("riley", { text: "hello" });
    await p.send("+12125550100", { text: "new number" });
    expect(sent).toEqual([
      ["riley", "hello"],
      ["+12125550100", "new number"],
    ]);
    expect(await failure(p.send("work", { text: "x" }))).toContain("telegram can't send messages");
    expect(await failure(p.send("rile", { text: "x" }))).toContain('no chat matches "rile"');
  });
});
