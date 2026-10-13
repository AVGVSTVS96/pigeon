import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { telegram } from "../examples/telegram.ts";
import { pigeon } from "../src/pigeon.ts";
import { redact } from "../src/redact.ts";

test("the Telegram example plugs into pigeon like any source", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "pigeon-tg-")), "result.json");
  const at = (h: number) => String(new Date(2026, 9, 6, h).getTime() / 1000);
  writeFileSync(
    path,
    JSON.stringify({
      personal_information: { user_id: 1 },
      chats: {
        list: [
          {
            id: 42,
            name: "Riley",
            type: "personal_chat",
            messages: [
              { id: 1, type: "message", date_unixtime: at(9), from: "Riley", from_id: "user2", text: ["see ", { type: "bold", text: "you" }] },
              { id: 2, type: "service", date_unixtime: at(10), text: "" },
              { id: 3, type: "message", date_unixtime: at(11), from: "Me", from_id: "user1", text: "code 4321", reply_to_message_id: 1 },
            ],
          },
        ],
      },
    }),
  );

  const p = pigeon({ sources: [telegram(path)], filters: [redact({ match: /\d{4}/ })] });
  expect(await p.chat("riley")).toMatchObject({ id: "42", source: "telegram", people: [{ id: "user2", name: "Riley" }], group: false });
  const messages = [];
  for await (const m of p.messages({ chat: "Riley" })) messages.push(m);
  expect(messages.map((m) => [m.from.name, m.text, m.replyTo])).toEqual([
    ["me", "code [redacted]", "42/1"],
    ["Riley", "see you", undefined],
  ]);
});
