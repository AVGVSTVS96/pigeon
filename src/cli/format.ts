import type { Screened } from "../screen.ts";
import type { Chat } from "../types.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export interface Style {
  dim: (text: string) => string;
  bold: (text: string) => string;
}

export const plain: Style = { bold: (t) => t, dim: (t) => t };

export const ansi: Style = {
  bold: (t) => `\u001B[1m${t}\u001B[22m`,
  dim: (t) => `\u001B[2m${t}\u001B[22m`,
};

export const shortDate = (date: Date, now = new Date()): string => {
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;

  return `${MONTHS[date.getMonth()] ?? ""} ${date.getDate()}${year} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const localIso = (date: Date): string => {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`
  );
};

const withLocalDates = (value: Chat | Screened) => ({
  ...value,
  ...(value.date && { date: localIso(value.date) }),
});

export const json = (value: Chat | Screened): string => JSON.stringify(withLocalDates(value));

export const chatLine = (chat: Chat, style: Style, width: number): string => {
  const when = chat.date ? shortDate(chat.date) : "";
  const tag = chat.group ? style.dim(`  group of ${chat.people.length + 1}`) : "";

  return `${style.dim(when.padEnd(12))}  ${style.bold(chat.name.padEnd(width))}  ${style.dim(chat.id)}${tag}`;
};

const body = (message: Screened): string => {
  const files = message.attachments.map((a) => `[attachment: ${a.name}]`);

  return [message.text, ...files].filter(Boolean).join(" ");
};

export const transcript = (style: Style): ((message: Screened) => string) => {
  let chat: string | undefined;

  return (message) => {
    const lines: string[] = [];
    const key = `${message.source}\0${message.chat.id}`;

    if (key !== chat) {
      chat = key;
      lines.push(style.bold(`── ${message.chat.name}`) + style.dim(` · ${message.chat.id}`));
    }

    const when = shortDate(message.date);
    const [first, ...rest] = `${message.from.name}: ${body(message)}`.split("\n");

    lines.push(`${style.dim(when)}  ${first ?? ""}`);

    for (const line of rest) {
      lines.push(`${" ".repeat(when.length)}  ${line}`);
    }

    return lines.join("\n");
  };
};
