import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Outgoing } from "../../types.ts";

const SCRIPT = `
on run argv
  set target to item 1 of argv
  set body to item 3 of argv
  tell application "Messages"
    if item 2 of argv is "chat" then
      set recipient to chat id target
    else
      set recipient to buddy target of (first service whose service type is iMessage)
    end if
    if body is not "" then send body to recipient
    repeat with i from 4 to count of argv
      send (POSIX file (item i of argv) as alias) to recipient
    end repeat
  end tell
end run`;

/** Messages reliably reads files only from inside its own folder, so copy them there first. */
async function stage(file: string): Promise<string> {
  const dir = join(homedir(), "Library/Messages/Attachments/pigeon", crypto.randomUUID());
  await mkdir(dir, { recursive: true });
  const staged = join(dir, basename(file));
  await copyFile(resolve(file), staged);
  return staged;
}

export type Recipient = { chat: string } | { handle: string };

export async function send(to: Recipient, { text = "", files = [] }: Outgoing): Promise<void> {
  if (!text && files.length === 0) throw new Error("nothing to send");
  const staged = await Promise.all(files.map(stage));
  const [kind, id] = "chat" in to ? ["chat", to.chat] : ["handle", to.handle];
  const proc = Bun.spawn(["osascript", "-", id, kind, text, ...staged], {
    stdin: new Blob([SCRIPT]),
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`Messages couldn't send: ${(await new Response(proc.stderr).text()).trim()}`);
  }
}
