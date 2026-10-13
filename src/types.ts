export interface Person {
  /** Phone number, email, or any stable handle. `"me"` for messages you sent. */
  id: string;
  name: string;
}

export interface Attachment {
  name: string;
  path?: string;
  mime?: string;
}

export interface Chat {
  /** Unique within its source. For iMessage 1:1 chats this is the other person's handle. */
  id: string;
  source: string;
  name: string;
  /** Everyone in the chat except you. */
  people: Person[];
  group: boolean;
  /** When the last message was sent. */
  date?: Date;
}

export interface Message {
  /** Unique within its source. */
  id: string;
  source: string;
  chat: { id: string; name: string };
  from: Person;
  text: string;
  date: Date;
  attachments: Attachment[];
  /** Id of the message this one replies to. */
  replyTo?: string;
  service?: string;
  /** Set by `redact()` when some or all of this message was hidden. */
  redacted?: true;
}

export interface Query {
  /** A chat id from this source. */
  chat?: string;
  since?: Date;
  until?: Date;
}

export interface Outgoing {
  text?: string;
  files?: string[];
}

/**
 * Anything that holds messages. Only `chats` and `messages` are required, so a
 * read-only source is a few lines; `watch` and `send` light up those commands.
 */
export interface Source {
  id: string;
  label?: string;
  chats(): Promise<Chat[]> | Chat[];
  /** Newest first. `query` is a hint: pigeon re-checks it, so a source may ignore it. */
  messages(query: Query): AsyncIterable<Message> | Iterable<Message>;
  /** New messages as they arrive. */
  watch?(query: Query): AsyncIterable<Message>;
  send?(chat: string, message: Outgoing): Promise<void>;
}

/** Keep (`true`), drop (`false`), or replace (return a new message). */
export type Filter = (message: Message) => boolean | Message;

export interface Config {
  sources?: Source[];
  filters?: Filter[];
}
