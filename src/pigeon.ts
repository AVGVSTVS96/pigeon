import { isPhone, sameHandle } from "./handles.ts";
import { imessage } from "./sources/imessage/index.ts";
import type { Chat, Config, Filter, Message, Outgoing, Source } from "./types.ts";

export interface MessageQuery {
  /** A chat id or name, from any source. */
  chat?: string;
  since?: Date;
  until?: Date;
  /** Words that must all appear, matched after filters run so hidden text is never searched. */
  text?: string;
  limit?: number;
}

export interface Pigeon {
  sources: Source[];
  /** Every chat, most recent first. */
  chats(): Promise<Chat[]>;
  /** Chats matching an id, a name, or part of a name. */
  findChats(ref: string): Promise<Chat[]>;
  /** Exactly one chat, or an error naming the candidates. */
  chat(ref: string): Promise<Chat>;
  /** Filtered messages, newest first. */
  messages(query?: MessageQuery): AsyncGenerator<Message>;
  /** Filtered messages as they arrive. */
  watch(query?: Omit<MessageQuery, "since" | "until" | "limit">): AsyncGenerator<Message>;
  send(ref: string, message: Outgoing): Promise<void>;
}

type Stream<T> = AsyncIterable<T> | Iterable<T>;

function iterate<T>(stream: Stream<T>): AsyncIterator<T> | Iterator<T> {
  return Symbol.asyncIterator in stream ? stream[Symbol.asyncIterator]() : stream[Symbol.iterator]();
}

/** Merges streams that are each newest first into one that is newest first. */
async function* newestFirst(streams: Stream<Message>[]): AsyncGenerator<Message> {
  const iterators = streams.map(iterate);
  try {
    const heads = await Promise.all(iterators.map((it) => it.next()));
    while (true) {
      let next = -1;
      heads.forEach((head, i) => {
        if (!head.done && (next < 0 || head.value.date > heads[next]!.value.date)) next = i;
      });
      if (next < 0) return;
      yield heads[next]!.value;
      heads[next] = await iterators[next]!.next();
    }
  } finally {
    await Promise.all(iterators.map((it) => it.return?.()));
  }
}

/** Merges live streams in arrival order. */
async function* arrivals(streams: AsyncIterable<Message>[]): AsyncGenerator<Message> {
  const iterators = streams.map((s) => s[Symbol.asyncIterator]());
  const pull = (i: number) => iterators[i]!.next().then((result) => ({ i, result }));
  const pending = new Map(iterators.map((_, i) => [i, pull(i)]));
  try {
    while (pending.size > 0) {
      const { i, result } = await Promise.race(pending.values());
      if (result.done) {
        pending.delete(i);
        continue;
      }
      pending.set(i, pull(i));
      yield result.value;
    }
  } finally {
    await Promise.all(iterators.map((it) => it.return?.()));
  }
}

function matcher(text: string | undefined): (message: Message) => boolean {
  const terms = text?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return (m) => {
    const haystack = m.text.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
}

/**
 * Runs every filter in order. A filter that throws or returns anything but
 * `true` or a message drops the message: when in doubt, nothing leaks.
 */
function screener(filters: Filter[]): (message: Message) => Message | undefined {
  const warned = new Set<number>();
  return (message) => {
    let current = message;
    for (const [i, filter] of filters.entries()) {
      let result: unknown;
      try {
        result = filter(current);
      } catch (err) {
        if (!warned.has(i)) console.error(`pigeon: filter ${i + 1} threw, dropping what it fails on\n  ${err}`);
        warned.add(i);
        return undefined;
      }
      if (result === true) continue;
      if (!result || typeof result !== "object") return undefined;
      current = result as Message;
    }
    return current;
  };
}

function only(found: Chat[], ref: string): Chat {
  if (found.length === 1) return found[0]!;
  const names = found.slice(0, 8).map((c) => `  ${c.name} (${c.id})`);
  throw new Error(`"${ref}" matches ${found.length} chats, use an id:\n${names.join("\n")}`);
}

export function pigeon({ sources = [imessage()], filters = [] }: Config = {}): Pigeon {
  const screen = screener(filters);
  const sourceOf = (chat: Chat) => sources.find((s) => s.id === chat.source);

  async function chats(): Promise<Chat[]> {
    const lists = await Promise.all(sources.map((s) => s.chats()));
    return lists.flat().sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }

  async function findChats(ref: string): Promise<Chat[]> {
    const all = await chats();
    const needle = ref.trim().toLowerCase();
    const byId = all.filter((c) => sameHandle(c.id, ref));
    if (byId.length > 0) return byId;
    const byName = all.filter((c) => c.name.toLowerCase() === needle);
    if (byName.length > 0) return byName;
    return all.filter((c) => c.name.toLowerCase().includes(needle));
  }

  async function chat(ref: string): Promise<Chat> {
    const found = await findChats(ref);
    if (found.length === 0) throw new Error(`no chat matches "${ref}"`);
    return only(found, ref);
  }

  async function* messages({ chat: ref, since, until, text, limit = Infinity }: MessageQuery = {}) {
    if (limit <= 0) return;
    const target = ref === undefined ? undefined : await chat(ref);
    const from = target ? [sourceOf(target)!] : sources;
    const matches = matcher(text);
    let count = 0;
    for await (const message of newestFirst(from.map((s) => s.messages({ chat: target?.id, since, until })))) {
      if (since && message.date < since) return;
      if (until && message.date >= until) continue;
      if (target && message.chat.id !== target.id) continue;
      const kept = screen(message);
      if (!kept || !matches(kept)) continue;
      yield kept;
      if (++count >= limit) return;
    }
  }

  async function* watch({ chat: ref, text }: Omit<MessageQuery, "since" | "until" | "limit"> = {}) {
    const target = ref === undefined ? undefined : await chat(ref);
    const live = (target ? [sourceOf(target)!] : sources).filter((s) => s.watch);
    if (live.length === 0) throw new Error("no source can watch for new messages");
    const matches = matcher(text);
    for await (const message of arrivals(live.map((s) => s.watch!({ chat: target?.id })))) {
      if (target && message.chat.id !== target.id) continue;
      const kept = screen(message);
      if (kept && matches(kept)) yield kept;
    }
  }

  async function send(ref: string, message: Outgoing): Promise<void> {
    const found = await findChats(ref);
    const target = found.length > 0 ? only(found, ref) : undefined;
    const source = target ? sourceOf(target) : isPhone(ref) || ref.includes("@") ? sources.find((s) => s.send) : undefined;
    if (!source) throw new Error(`no chat matches "${ref}"`);
    if (!source.send) throw new Error(`${source.label ?? source.id} can't send messages`);
    await source.send(target?.id ?? ref.trim(), message);
  }

  return { sources, chats, findChats, chat, messages, watch, send };
}
