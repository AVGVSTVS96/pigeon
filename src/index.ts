export type { Attachment, Chat, Config, Filter, Message, Outgoing, Person, Query, Source } from "./types.ts";
export type { ConfigApi, ConfigFactory } from "./config.ts";
export type { MessageQuery, Pigeon } from "./pigeon.ts";
export type { RedactRule } from "./redact.ts";
export type { IMessageOptions } from "./sources/imessage/index.ts";

export { configDir, findConfig, loadConfig, open } from "./config.ts";
export { defineSource } from "./define.ts";
export { pigeon } from "./pigeon.ts";
export { REDACTED, redact } from "./redact.ts";
export { imessage } from "./sources/imessage/index.ts";
