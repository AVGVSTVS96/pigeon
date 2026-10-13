import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../src/cli/main.ts";
import { localIso, shortDate } from "../src/cli/format.ts";
import { fakeChatDb, fakeContacts } from "./fixture.ts";

const RILEY = "+12125550100";
const fake = fakeChatDb();
const riley = fake.chat({ id: RILEY });
const club = fake.chat({ id: "chat901", handles: ["sam@example.com"], group: true, name: "Book club" });
fake.message({ chat: riley, from: RILEY, text: "see you at 8", date: new Date(2026, 9, 5, 20, 0) });
fake.message({ chat: riley, from: RILEY, text: "the gate code is 4321", date: new Date(2026, 9, 6, 21, 14) });
fake.message({ chat: riley, from: "me", text: "got it\nthanks", date: new Date(2026, 9, 6, 21, 15) });
fake.message({ chat: club, from: "sam@example.com", text: "chapter 3 tonight", date: new Date(2026, 9, 7, 9, 30) });
const contacts = fakeContacts([{ first: "Riley", phones: [RILEY] }]);

function config(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "pigeon-config-")), "config.ts");
  writeFileSync(path, body);
  return path;
}

const hideOct6 = config(`
  export default ({ imessage, redact }) => ({
    sources: [imessage({ db: ${JSON.stringify(fake.path)}, contacts: ${JSON.stringify(contacts)} })],
    filters: [redact({ chat: "${RILEY}", on: "2026-10-06" })],
  });
`);

async function pigeon(args: string[], configPath = hideOct6) {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], {
    env: { ...process.env, PIGEON_CONFIG: configPath, NO_COLOR: "1", TZ: Intl.DateTimeFormat().resolvedOptions().timeZone },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("cli", () => {
  test("read prints a transcript, oldest first, with the config's redaction applied", async () => {
    const { stdout, code } = await pigeon(["read", "riley"]);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        `── Riley · ${RILEY}`,
        "Oct 5 20:00  Riley: see you at 8",
        "Oct 6 21:14  Riley: [redacted]",
        "Oct 6 21:15  me: [redacted]",
        "",
      ].join("\n"),
    );
  });

  test("read with no chat reads everywhere and heads each chat", async () => {
    const { stdout } = await pigeon(["read", "-n", "2"]);
    expect(stdout).toBe(
      [`── Riley · ${RILEY}`, "Oct 6 21:15  me: [redacted]", "── Book club · chat901", "Oct 7 09:30  sam@example.com: chapter 3 tonight", ""].join(
        "\n",
      ),
    );
  });

  test("search can't find hidden text", async () => {
    expect((await pigeon(["search", "gate", "code"])).stdout).toBe("");
    expect((await pigeon(["search", "chapter"])).stdout).toContain("chapter 3 tonight");
  });

  test("--json prints one message per line with local dates", async () => {
    const lines = (await pigeon(["read", RILEY, "--json", "--since", "2026-10-06"])).stdout.trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      expect.objectContaining({ text: "[redacted]", redacted: true, attachments: [], date: localIso(new Date(2026, 9, 6, 21, 14)) }),
      expect.objectContaining({ text: "[redacted]", from: { id: "me", name: "me" } }),
    ]);
  });

  test("chats lists names, ids and group sizes", async () => {
    const { stdout } = await pigeon(["chats"]);
    expect(stdout.split("\n")[0]).toBe(`${shortDate(new Date(2026, 9, 7, 9, 30))}   Book club  chat901  group of 2`);
    expect(stdout).toContain(`Riley      ${RILEY}`);
  });

  test("config shows what loaded", async () => {
    expect((await pigeon(["config"])).stdout).toBe(`config   ${hideOct6}\nsources  iMessage\nfilters  1\n`);
  });

  test("a broken config stops pigeon instead of reading without its filters", async () => {
    const broken = config(`export default { filters: [redact({ chat: "x" })] };`);
    const { stdout, stderr, code } = await pigeon(["read"], broken);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("couldn't load");
  });

  test("a config with the wrong shape stops pigeon too", async () => {
    const { stderr, code } = await pigeon(["read"], config(`export default { filters: [{ chat: "x" }] };`));
    expect(code).toBe(1);
    expect(stderr).toContain("filters must be an array of functions");
  });

  test("errors are one line on stderr", async () => {
    expect(await pigeon(["read", "nobody"])).toEqual({ stdout: "", stderr: 'pigeon: no chat matches "nobody"\n', code: 1 });
  });
});

describe("parse", () => {
  test("reads flags and relative times", () => {
    const args = parse(["search", "gate", "code", "-n", "5", "-s", "3d", "--json"]);
    expect(args).toMatchObject({ command: "search", args: ["gate", "code"], limit: 5, json: true });
    expect(Date.now() - args.since!.getTime()).toBeCloseTo(3 * 86_400_000, -4);
  });

  test("rejects a bad limit", () => {
    expect(() => parse(["read", "-n", "0"])).toThrow("--limit");
  });
});
