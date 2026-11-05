import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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

const copyIntoMessagesFolder = async (file: string): Promise<string> => {
  const dir = path.join(homedir(), "Library/Messages/Attachments/pigeon", crypto.randomUUID());

  await mkdir(dir, { recursive: true });
  const staged = path.join(dir, path.basename(file));

  await copyFile(path.resolve(file), staged);

  return staged;
};

export type Recipient = { chat: string } | { handle: string };

const TIMEOUT_MS = 30_000;

export const send = async (to: Recipient, { text = "", files = [] }: Outgoing): Promise<void> => {
  if (!text && files.length === 0) {
    throw new Error("nothing to send");
  }

  const staged = await Promise.all(files.map(copyIntoMessagesFolder));
  const [kind, id] = "chat" in to ? ["chat", to.chat] : ["handle", to.handle];

  const proc = Bun.spawn(["osascript", "-", id, kind, text, ...staged], {
    stderr: "pipe",
    stdin: new Blob([SCRIPT]),
    stdout: "ignore",
    timeout: TIMEOUT_MS,
  });

  const code = await proc.exited;

  if (proc.signalCode !== null) {
    throw new Error(
      "Messages didn't answer. The first send from a new app or ssh needs a one-time OK: " +
        "check for a prompt on the Mac, or System Settings › Privacy & Security › Automation.",
    );
  }

  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();

    throw new Error(`Messages couldn't send: ${stderr.trim()}`);
  }
};
