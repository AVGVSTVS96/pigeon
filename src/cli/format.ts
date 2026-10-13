import type { Chat, Message } from "../types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export interface Style {
  dim(text: string): string;
  bold(text: string): string;
}

export const plain: Style = { dim: (t) => t, bold: (t) => t };
export const ansi: Style = { dim: (t) => `\x1b[2m${t}\x1b[22m`, bold: (t) => `\x1b[1m${t}\x1b[22m` };

/** "Oct 6 21:14", with the year when it isn't this one. */
export function shortDate(date: Date, now = new Date()): string {
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO 8601 in local time with its offset, so a reader sees the same day you do. */
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`
  );
}

export function json(value: Chat | Message): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    const original = this[key];
    return original instanceof Date ? localIso(original) : v;
  });
}

export function chatLine(chat: Chat, style: Style, width: number): string {
  const when = chat.date ? shortDate(chat.date) : "";
  const tag = chat.group ? style.dim(`  group of ${chat.people.length + 1}`) : "";
  return `${style.dim(when.padEnd(12))}  ${style.bold(chat.name.padEnd(width))}  ${style.dim(chat.id)}${tag}`;
}

function body(message: Message): string {
  const files = message.attachments.map((a) => `[attachment: ${a.name}]`);
  return [message.text, ...files].filter(Boolean).join(" ");
}

/** Messages as a transcript, with a header each time the chat changes. */
export function transcript(style: Style) {
  let chat: string | undefined;
  return (message: Message): string => {
    const lines: string[] = [];
    const key = `${message.source}\0${message.chat.id}`;
    if (key !== chat) {
      chat = key;
      lines.push(style.bold(`── ${message.chat.name}`) + style.dim(` · ${message.chat.id}`));
    }
    const when = shortDate(message.date);
    const [first, ...rest] = `${message.from.name}: ${body(message)}`.split("\n");
    lines.push(`${style.dim(when)}  ${first}`);
    for (const line of rest) lines.push(`${" ".repeat(when.length)}  ${line}`);
    return lines.join("\n");
  };
}
