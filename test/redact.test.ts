import { describe, expect, test } from "bun:test";
import { REDACTED, redact } from "../src/redact.ts";
import type { Message } from "../src/types.ts";

const message = (over: Partial<Message> = {}): Message => ({
  id: "1",
  source: "imessage",
  chat: { id: "+12125550100", name: "Riley" },
  from: { id: "+12125550100", name: "Riley" },
  text: "the gate code is 4321",
  date: new Date(2026, 9, 6, 21, 14),
  attachments: [{ name: "IMG_0001.heic" }],
  ...over,
});

describe("redact", () => {
  test("hides a whole chat for one local day, text and attachments", () => {
    const rule = redact({ chat: "+12125550100", on: "2026-10-06" });
    expect(rule(message())).toEqual({ ...message(), text: REDACTED, attachments: [], redacted: true });
    expect(rule(message({ from: { id: "me", name: "me" } }))).toMatchObject({ text: REDACTED });
    expect(rule(message({ date: new Date(2026, 9, 6, 0, 0) }))).toMatchObject({ text: REDACTED });
    expect(rule(message({ date: new Date(2026, 9, 5, 23, 59) }))).toBe(true);
    expect(rule(message({ date: new Date(2026, 9, 7, 0, 0) }))).toBe(true);
  });

  test("leaves other chats alone, including groups the same person is in", () => {
    const rule = redact({ chat: "+12125550100", on: "2026-10-06" });
    expect(rule(message({ chat: { id: "chat123", name: "Family" } }))).toBe(true);
  });

  test("matches a number however it's written", () => {
    for (const chat of ["+1 (212) 555-0100", "2125550100", "212.555.0100"]) {
      expect(redact({ chat })(message())).toMatchObject({ redacted: true });
    }
    expect(redact({ chat: "+12125550199" })(message())).toBe(true);
  });

  test("matches chats by id only, since names can change under a rule", () => {
    expect(redact({ chat: "Riley" })(message())).toBe(true);
  });

  test("narrows by sender, including me", () => {
    expect(redact({ from: "me" })(message())).toBe(true);
    expect(redact({ from: "me" })(message({ from: { id: "me", name: "me" } }))).toMatchObject({ redacted: true });
  });

  test("hides only matching strings, case-insensitively for plain strings", () => {
    const rule = redact({ match: ["GATE CODE", /\d{5}/] });
    expect(rule(message())).toEqual({ ...message(), text: `the ${REDACTED} is 4321`, redacted: true });
    expect(rule(message({ text: "nothing here" }))).toBe(true);
  });

  test("hides attachments whose names match", () => {
    expect(redact({ match: "img_0001" })(message({ text: "here" }))).toEqual({
      ...message({ text: "here" }),
      attachments: [{ name: REDACTED }],
      redacted: true,
    });
  });

  test("ignores a regex's sticky flag and leftover lastIndex", () => {
    const sticky = /\d{4}/y;
    expect(redact({ match: sticky })(message())).toMatchObject({ text: `the gate code is ${REDACTED}` });
    const reused = /\d{4}/g;
    reused.test("9999 4321");
    expect(redact({ match: reused })(message())).toMatchObject({ text: `the gate code is ${REDACTED}` });
  });

  test("merges overlapping matches into one marker", () => {
    const rule = redact({ match: ["gate code", "code is"] });
    expect(rule(message())).toMatchObject({ text: `the ${REDACTED} 4321` });
  });

  test("leaves a Date passed to it untouched", () => {
    const on = new Date(2026, 9, 6, 21, 14);
    redact({ on });
    expect(on).toEqual(new Date(2026, 9, 6, 21, 14));
  });

  test("since and until bound the rule", () => {
    const rule = redact({ since: "2026-10-06T21:00", until: "2026-10-06T22:00" });
    expect(rule(message())).toMatchObject({ redacted: true });
    expect(rule(message({ date: new Date(2026, 9, 6, 22, 0) }))).toBe(true);
  });
});
