export interface Person {
  id: string;
  name: string;
}

export interface Attachment {
  name: string;
  path?: string;
  mime?: string;
}

export interface Chat {
  id: string;
  source: string;
  name: string;
  people: Person[];
  group: boolean;
  date?: Date;
}

export interface Message {
  id: string;
  source: string;
  chat: { id: string; name: string };
  from: Person;
  text: string;
  date: Date;
  attachments: Attachment[];
  replyTo?: string;
  service?: string;
  redacted?: true;
}

export interface Query {
  chat?: string | undefined;
  since?: Date | undefined;
  until?: Date | undefined;
}

export interface Outgoing {
  text?: string | undefined;
  files?: string[] | undefined;
}

export interface Source {
  id: string;
  label?: string;
  chats: () => Promise<Chat[]> | Chat[];
  messages: (query: Query) => AsyncIterable<Message> | Iterable<Message>;
  watch?: (query: Query) => AsyncIterable<Message>;
  send?: (chat: string, message: Outgoing) => Promise<void>;
}

export type Filter = (message: Message) => boolean | Message;

export interface Config {
  sources?: Source[] | undefined;
  filters?: Filter[] | undefined;
}
