#!/usr/bin/env bun
import { parseArgs } from "node:util";

import { findConfig, loadConfig } from "../config.ts";
import { pigeon } from "../pigeon.ts";
import type { Pigeon } from "../pigeon.ts";
import type { Screened } from "../screen.ts";
import { parseWhen } from "../time.ts";
import type { Config } from "../types.ts";
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
  -s, --since <when>  "30m", "12h", "3d", "2w", today, yesterday, or a date
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

const DEFAULT_LIMIT = 30;

export const parse = (argv: string[]) => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: OPTIONS,
  });

  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a positive whole number`);
  }

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
};

type Args = ReturnType<typeof parse>;

interface Run {
  args: Args;
  config: Config;
  out: (line: string) => void;
  p: Pigeon;
  print: (message: Screened) => void;
  style: typeof ansi;
}

const oldestFirst = async (messages: AsyncIterable<Screened>): Promise<Screened[]> => {
  const all: Screened[] = [];

  for await (const message of messages) {
    all.push(message);
  }

  return all.toReversed();
};

const readStdin = async () => {
  const text = await Bun.stdin.text();

  return text.trimEnd();
};

const chatArg = (args: Args) => args.args.join(" ") || args.chat;

const commands = {
  chats: async ({ args, out, p, style }) => {
    const query = args.args.join(" ");
    const found = query ? await p.findChats(query) : await p.chats();
    const chats = found.slice(0, args.limit);
    const width = Math.min(28, Math.max(0, ...chats.map((c) => c.name.length)));

    for (const chat of chats) {
      out(args.json ? json(chat) : chatLine(chat, style, width));
    }
  },
  config: async ({ config, out, p }) => {
    const path = await findConfig();

    out(`config   ${path ?? "none"}`);
    out(`sources  ${p.sources.map((s) => s.label ?? s.id).join(", ")}`);
    out(`filters  ${config.filters?.length ?? 0}`);
  },
  read: async ({ args, p, print }) => {
    const { limit, since, until } = args;
    const messages = await oldestFirst(p.messages({ chat: chatArg(args), limit, since, until }));

    for (const message of messages) {
      print(message);
    }
  },
  search: async ({ args, p, print }) => {
    const { chat, limit, since, until } = args;
    const text = args.args.join(" ");

    if (!text) {
      throw new Error("search needs some words to look for");
    }

    const messages = await oldestFirst(p.messages({ chat, limit, since, text, until }));

    for (const message of messages) {
      print(message);
    }
  },
  send: async ({ args, p }) => {
    const [chat, ...words] = args.args;

    if (chat === undefined) {
      throw new Error("send needs a chat: pigeon send <chat> <text>");
    }

    const piped = words.length === 0 && args.files.length === 0 && !process.stdin.isTTY;
    const text = piped ? await readStdin() : words.join(" ");

    await p.send(chat, { files: args.files, text });
  },
  watch: async ({ args, p, print }) => {
    for await (const message of p.watch({ chat: chatArg(args) })) {
      print(message);
    }
  },
} satisfies Record<string, (run: Run) => Promise<void>>;

const isCommand = (name: string | undefined): name is keyof typeof commands =>
  name !== undefined && Object.hasOwn(commands, name);

const run = async (args: Args, out: (line: string) => void): Promise<void> => {
  if (!isCommand(args.command)) {
    throw new Error(`unknown command "${args.command ?? ""}", see pigeon --help`);
  }

  const colored = !args.json && process.stdout.isTTY && (process.env.NO_COLOR ?? "") === "";
  const style = colored ? ansi : plain;
  const format = args.json ? json : transcript(style);
  const config = await loadConfig();

  await commands[args.command]({
    args,
    config,
    out,
    p: pigeon(config),
    print: (message) => {
      out(format(message));
    },
    style,
  });
};

export const main = async (argv = Bun.argv.slice(2)): Promise<number> => {
  try {
    const args = parse(argv);

    if (args.help || args.command === undefined) {
      console.log(HELP);

      return 0;
    }

    await run(args, (line) => {
      console.log(line);
    });

    return 0;
  } catch (error) {
    console.error(`pigeon: ${error instanceof Error ? error.message : String(error)}`);

    return 1;
  }
};

if (import.meta.main) {
  process.exit(await main());
}
