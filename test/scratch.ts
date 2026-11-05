import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "pigeon-test-"));

process.env.TMPDIR = root;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
