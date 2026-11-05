import { sameHandle } from "./handles.ts";
import { dayRange, toDate } from "./time.ts";
import type { DateInput } from "./time.ts";
import type { Filter, Message } from "./types.ts";

export const REDACTED = "[redacted]";

type OneOrMany<T> = T | T[];

export interface RedactRule {
  chat?: OneOrMany<string>;
  from?: OneOrMany<string>;
  on?: DateInput;
  since?: DateInput;
  until?: DateInput;
  match?: OneOrMany<string | RegExp>;
}

const list = <T>(value: OneOrMany<T> | undefined): T[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

const freshGlobalPattern = (match: string | RegExp): RegExp => {
  if (match instanceof RegExp) {
    return new RegExp(match.source, `${match.flags.replaceAll(/[gy]/gu, "")}g`);
  }

  return new RegExp(escape(match), "giu");
};

const hide = (text: string, patterns: RegExp[]): string => {
  const spans = patterns
    .flatMap((pattern) =>
      [...text.matchAll(pattern)].map((m) => [m.index, m.index + m[0].length] as const),
    )
    .filter(([start, end]) => end > start)
    .toSorted((a, b) => a[0] - b[0]);

  let out = "";
  let at = 0;

  for (const [start, end] of spans) {
    if (start >= at) {
      out += text.slice(at, start) + REDACTED;
    }

    at = Math.max(at, end);
  }

  return out + text.slice(at);
};

const bounds = (rule: RedactRule) => {
  const [onStart, onEnd] = rule.on === undefined ? [] : dayRange(rule.on);
  const since = rule.since === undefined ? onStart : toDate(rule.since);
  const until = rule.until === undefined ? onEnd : toDate(rule.until);

  return { ...(since && { since }), ...(until && { until }) };
};

export const redact = (rule: RedactRule): Filter => {
  const chats = list(rule.chat);
  const senders = list(rule.from);
  const { since, until } = bounds(rule);
  const patterns = list(rule.match).map(freshGlobalPattern);

  const applies = (m: Message) =>
    (chats.length === 0 || chats.some((c) => sameHandle(c, m.chat.id))) &&
    (senders.length === 0 || senders.some((s) => sameHandle(s, m.from.id))) &&
    (since === undefined || m.date >= since) &&
    (until === undefined || m.date < until);

  return (m) => {
    if (!applies(m)) {
      return true;
    }

    if (patterns.length === 0) {
      return { ...m, attachments: [], redacted: true, text: REDACTED };
    }

    const text = hide(m.text, patterns);

    const attachments = m.attachments.map((a) =>
      hide(a.name, patterns) === a.name ? a : { name: REDACTED },
    );

    const changed = text !== m.text || attachments.some((a, i) => a !== m.attachments[i]);

    return changed ? { ...m, attachments, redacted: true, text } : true;
  };
};
