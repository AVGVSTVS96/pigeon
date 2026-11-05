const APPLE_EPOCH_MS = 978_307_200_000;
const NANOSECONDS_SINCE = 1e12;

export const toAppleTime = (date: Date) => (date.getTime() - APPLE_EPOCH_MS) * 1e6;

export const fromAppleTime = (value: number) =>
  new Date((value > NANOSECONDS_SINCE ? value / 1e6 : value * 1e3) + APPLE_EPOCH_MS);

export const GROUP_CHAT_STYLE = 43;

export const IS_CONTENT_NOT_TAPBACK =
  "m.item_type = 0 AND m.associated_message_type NOT BETWEEN 2000 AND 3999";

export const MESSAGE_COLUMNS = `
  m.ROWID AS rowid, m.guid, m.text, m.attributedBody AS body, m.date, m.is_from_me AS fromMe,
  m.service, m.thread_originator_guid AS replyTo, m.cache_has_attachments AS hasAttachments,
  h.id AS handle, c.chat_identifier AS chat`;

export interface MessageRow {
  rowid: number;
  guid: string;
  text: string | null;
  body: Uint8Array | null;
  date: number;
  fromMe: number;
  service: string | null;
  replyTo: string | null;
  hasAttachments: number;
  handle: string | null;
  chat: string | null;
}

export interface AttachmentRow {
  filename: string | null;
  name: string | null;
  mime: string | null;
}

export interface ChatRow {
  rowid: number;
  guid: string;
  identifier: string;
  displayName: string | null;
  style: number;
  lastDate: number | null;
}

export const filled = (value: string | null | undefined): string | undefined =>
  value === null || value === "" ? undefined : value;
