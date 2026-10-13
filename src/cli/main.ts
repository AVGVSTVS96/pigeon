#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { findConfig, loadConfig } from "../config.ts";
import { pigeon } from "../pigeon.ts";
import { parseWhen } from "../time.ts";
import type { Message } from "../types.ts";
import { ansi, chatLine, json, plain, transcript } from "./format.ts";

export const HELP = `pigeon: your messages, from the terminal

Usage
  pigeon chats [name]           chats, most recent first
  pigeon read [chat]            recent messages in a chat, or across all of them
  pigeon search <words...>      messages containing every word
  pigeon watch [chat]           new messages as they arrive
  pigeon send <chat> [text...]  send a message (text from stdin if omitted)
  pigeon config                 where the config is and what it loaded

A chat is its id (a phone number or email for 1:1 chats) or its name.

Options
  -n, --limit <n>     how many to show (default 30)
  -s, --since <when>  "30m", "12h", "3d", "2w", or a date like 2026-10-01
  -u, --until <when>  same forms as --since
  -c, --chat <chat>   limit search or watch to one chat
  -f, --file <path>   attach a file to send (repeatable)
      --json          one JSON object per line
  -h, --help

Filters in ~/.config/pigeon/config.ts apply to every command and can't be skipped.`;

const OPTIONS = {
  limit: { type: "string", short: "n" },
  since: { type: "string", short: "s" },
  until: { type: "string", short: "u" },
  chat: { type: "string", short: "c" },
  file: { type: "string", short: "f", multiple: true },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export function parse(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const limit = values.limit === undefined ? 30 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive whole number`);
  const [command, ...rest] = positionals;
  return {
    command,
    args: rest,
    limit,
    since: values.since === undefined ? undefined : parseWhen(values.since),
    until: values.until === undefined ? undefined : parseWhen(values.until),
    chat: values.chat,
    files: values.file ?? [],
    json: values.json ?? false,
    help: values.help ?? false,
  };
}

type Args = ReturnType<typeof parse>;

async function collect(messages: AsyncIterable<Message>): Promise<Message[]> {
  const all: Message[] = [];
  for await (const m of messages) all.push(m);
  return all.reverse();
}

async function run(args: Args, out: (line: string) => void): Promise<void> {
  const style = !args.json && process.stdout.isTTY && !process.env.NO_COLOR ? ansi : plain;
  const format = args.json ? json : transcript(style);
  const print = (m: Message) => out(format(m));
  const config = await loadConfig();
  const p = pigeon(config);
  const { since, until, limit } = args;

  switch (args.command) {
    case "chats": {
      const query = args.args.join(" ");
      const chats = (query ? await p.findChats(query) : await p.chats()).slice(0, limit);
      const width = Math.min(28, Math.max(0, ...chats.map((c) => c.name.length)));
      for (const chat of chats) out(args.json ? json(chat) : chatLine(chat, style, width));
      return;
    }
    case "read": {
      const chat = args.args.join(" ") || args.chat || undefined;
      (await collect(p.messages({ chat, since, until, limit }))).forEach(print);
      return;
    }
    case "search": {
      const text = args.args.join(" ");
      if (!text) throw new Error("search needs some words to look for");
      (await collect(p.messages({ chat: args.chat, text, since, until, limit }))).forEach(print);
      return;
    }
    case "watch": {
      const chat = args.args.join(" ") || args.chat || undefined;
      for await (const m of p.watch({ chat })) print(m);
      return;
    }
    case "send": {
      const [chat, ...words] = args.args;
      if (!chat) throw new Error("send needs a chat: pigeon send <chat> <text>");
      const piped = words.length === 0 && args.files.length === 0 && !process.stdin.isTTY;
      const text = piped ? (await Bun.stdin.text()).trimEnd() : words.join(" ");
      await p.send(chat, { text, files: args.files });
      return;
    }
    case "config": {
      out(`config   ${(await findConfig()) ?? "none"}`);
      out(`sources  ${p.sources.map((s) => s.label ?? s.id).join(", ")}`);
      out(`filters  ${config.filters?.length ?? 0}`);
      return;
    }
    default:
      throw new Error(`unknown command "${args.command}"\n\n${HELP}`);
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  try {
    const args = parse(argv);
    if (args.help || !args.command) {
      console.log(HELP);
      return 0;
    }
    await run(args, (line) => console.log(line));
    return 0;
  } catch (err) {
    console.error(`pigeon: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
