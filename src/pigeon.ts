import { isPhone, sameHandle } from "./handles.ts";
import { screener } from "./screen.ts";
import type { Screened } from "./screen.ts";
import { imessage } from "./sources/imessage/index.ts";
import type { Chat, Config, Message, Outgoing, Source } from "./types.ts";

export interface MessageQuery {
  chat?: string | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
  text?: string | undefined;
  limit?: number | undefined;
}

export type WatchQuery = Pick<MessageQuery, "chat" | "text">;

export interface Pigeon {
  sources: Source[];
  chats: () => Promise<Chat[]>;
  findChats: (ref: string) => Promise<Chat[]>;
  chat: (ref: string) => Promise<Chat>;
  messages: (query?: MessageQuery) => AsyncGenerator<Screened>;
  watch: (query?: WatchQuery) => AsyncGenerator<Screened>;
  send: (ref: string, message: Outgoing) => Promise<void>;
}

type Stream<T> = AsyncIterable<T> | Iterable<T>;

const iterate = <T>(stream: Stream<T>): AsyncIterator<T> | Iterator<T> =>
  Symbol.asyncIterator in stream ? stream[Symbol.asyncIterator]() : stream[Symbol.iterator]();

const newestFirst = async function* newestFirst(
  streams: Stream<Message>[],
): AsyncGenerator<Message> {
  const lanes = await Promise.all(
    streams.map(iterate).map(async (iterator) => ({ head: await iterator.next(), iterator })),
  );

  try {
    while (true) {
      let newest: { lane: (typeof lanes)[number]; message: Message } | undefined;

      for (const lane of lanes) {
        if (
          lane.head.done !== true &&
          (newest === undefined || lane.head.value.date > newest.message.date)
        ) {
          newest = { lane, message: lane.head.value };
        }
      }

      if (newest === undefined) {
        return;
      }

      yield newest.message;
      newest.lane.head = await newest.lane.iterator.next();
    }
  } finally {
    await Promise.all(lanes.map(async ({ iterator }) => await iterator.return?.()));
  }
};

const pull = async (iterator: AsyncIterator<Message>) => ({
  iterator,
  result: await iterator.next(),
});

const arrivals = async function* arrivals(
  streams: AsyncIterable<Message>[],
): AsyncGenerator<Message> {
  const iterators = streams.map((stream) => stream[Symbol.asyncIterator]());

  const pending = new Map(iterators.map((iterator) => [iterator, pull(iterator)]));

  try {
    while (pending.size > 0) {
      const { iterator, result } = await Promise.race(pending.values());

      if (result.done === true) {
        pending.delete(iterator);
        continue;
      }

      pending.set(iterator, pull(iterator));
      yield result.value;
    }
  } finally {
    await Promise.all(iterators.map(async (iterator) => await iterator.return?.()));
  }
};

const matcher = (text: string | undefined): ((message: Message) => boolean) => {
  const terms = text?.toLowerCase().split(/\s+/u).filter(Boolean) ?? [];

  return (message) => {
    const haystack = message.text.toLowerCase();

    return terms.every((term) => haystack.includes(term));
  };
};

const only = (found: Chat[], ref: string): Chat => {
  const [first] = found;

  if (found.length === 1 && first !== undefined) {
    return first;
  }

  const names = found.slice(0, 8).map((c) => `  ${c.name} (${c.id})`);

  throw new Error(`"${ref}" matches ${found.length} chats, use an id:\n${names.join("\n")}`);
};

const byRecency = (a: Chat, b: Chat) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);

export const pigeon = ({ sources = [imessage()], filters = [] }: Config = {}): Pigeon => {
  const screen = screener(filters);

  const sourcesFor = (target: Chat | undefined) =>
    target === undefined ? sources : sources.filter((s) => s.id === target.source);

  const chats = async (): Promise<Chat[]> => {
    const lists = await Promise.all(sources.map(async (s) => await s.chats()));

    return lists.flat().toSorted(byRecency);
  };

  const lookup = async (ref: string, exact: boolean): Promise<Chat[]> => {
    const all = await chats();
    const needle = ref.trim().toLowerCase();
    const byId = all.filter((c) => sameHandle(c.id, ref));

    if (byId.length > 0) {
      return byId;
    }

    const byName = all.filter((c) => c.name.toLowerCase() === needle);

    if (byName.length > 0 || exact) {
      return byName;
    }

    return all.filter((c) => c.name.toLowerCase().includes(needle));
  };

  const findChats = async (ref: string) => await lookup(ref, false);

  const chat = async (ref: string): Promise<Chat> => {
    const found = await findChats(ref);

    if (found.length === 0) {
      throw new Error(`no chat matches "${ref}"`);
    }

    return only(found, ref);
  };

  const messages = async function* messages({
    chat: ref,
    since,
    until,
    text,
    limit = Number.POSITIVE_INFINITY,
  }: MessageQuery = {}): AsyncGenerator<Screened> {
    if (limit <= 0) {
      return;
    }

    const target = ref === undefined ? undefined : await chat(ref);
    const matches = matcher(text);
    const query = { chat: target?.id, since, until };
    let count = 0;

    for await (const message of newestFirst(sourcesFor(target).map((s) => s.messages(query)))) {
      if (since && message.date < since) {
        return;
      }

      const inRange =
        (!until || message.date < until) && (!target || message.chat.id === target.id);

      const kept = inRange ? screen(message) : undefined;

      if (kept && matches(kept)) {
        yield kept;
        count += 1;

        if (count >= limit) {
          return;
        }
      }
    }
  };

  const watch = async function* watch({
    chat: ref,
    text,
  }: WatchQuery = {}): AsyncGenerator<Screened> {
    const target = ref === undefined ? undefined : await chat(ref);
    const query = { chat: target?.id };
    const live = sourcesFor(target).flatMap((s) => (s.watch ? [s.watch(query)] : []));

    if (live.length === 0) {
      throw new Error("no source can watch for new messages");
    }

    const matches = matcher(text);

    for await (const message of arrivals(live)) {
      const kept = !target || message.chat.id === target.id ? screen(message) : undefined;

      if (kept && matches(kept)) {
        yield kept;
      }
    }
  };

  const senderFor = (target: Chat | undefined, ref: string): Source | undefined => {
    if (target) {
      return sourcesFor(target)[0];
    }

    return isPhone(ref) || ref.includes("@") ? sources.find((s) => s.send) : undefined;
  };

  const send = async (ref: string, message: Outgoing): Promise<void> => {
    const found = await lookup(ref, true);
    const target = found.length > 0 ? only(found, ref) : undefined;
    const source = senderFor(target, ref);

    if (!source) {
      throw new Error(`no chat matches "${ref}"`);
    }

    if (!source.send) {
      throw new Error(`${source.label ?? source.id} can't send messages`);
    }

    await source.send(target?.id ?? ref.trim(), message);
  };

  return { chat, chats, findChats, messages, send, sources, watch };
};
