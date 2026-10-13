import { describe, expect, test } from "bun:test";
import { decodeAttributedBody } from "../src/sources/imessage/typedstream.ts";
import { archives, encodeBody, hex } from "./fixture.ts";

describe("decodeAttributedBody", () => {
  test.each(archives.map((a) => [a.text.slice(0, 20), a] as const))("decodes a real NSArchiver blob: %s", (_, a) => {
    expect(decodeAttributedBody(hex(a.hex))).toBe(a.text);
  });

  test("decodes the fixture encoder at every length frame", () => {
    for (const text of ["", "hi", "a".repeat(127), "b".repeat(128), "🎉".repeat(100)]) {
      expect(decodeAttributedBody(encodeBody(text))).toBe(text);
    }
  });

  test("reads big-endian lengths from typedstream archives", () => {
    const text = "b".repeat(300);
    const bytes = [4, 11, ...new TextEncoder().encode("typedstream"), 0x81, 0x03, 0xe8, 0x01, 0x2b, 0x81, 0x01, 0x2c];
    expect(decodeAttributedBody(new Uint8Array([...bytes, ...new TextEncoder().encode(text), 0x86]))).toBe(text);
  });

  test("returns nothing for truncated or foreign data rather than guessing", () => {
    const header = [4, 11, ...new TextEncoder().encode("streamtyped"), 0x81, 0xe8, 0x03, 0x01, 0x2b];
    for (const payload of [[], [0x81], [0x81, 0x01], [0x82, 1, 0, 0], [0x85], [5, 0x61, 0x62], [1, 0xff]]) {
      expect(decodeAttributedBody(new Uint8Array([...header, ...payload]))).toBe("");
    }
    expect(decodeAttributedBody(new TextEncoder().encode("bplist00"))).toBe("");
  });
});
