import { sameHandle } from "./handles.ts";
import { dayRange, toDate, type DateInput } from "./time.ts";
import type { Filter, Message } from "./types.ts";

export const REDACTED = "[redacted]";

type OneOrMany<T> = T | T[];

export interface RedactRule {
  /** Chat id or exact chat name. For a 1:1 iMessage chat, the id is the person's number or email. */
  chat?: OneOrMany<string>;
  /** Sender handle, or `"me"`. */
  from?: OneOrMany<string>;
  /** A whole day, local time: `"2026-10-06"`. */
  on?: DateInput;
  since?: DateInput;
  until?: DateInput;
  /** Hide only these strings. Without it, the whole message is hidden. */
  match?: OneOrMany<string | RegExp>;
}

function list<T>(value: OneOrMany<T> | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPattern(match: string | RegExp): RegExp {
  if (typeof match === "string") return new RegExp(escape(match), "gi");
  return match.global ? match : new RegExp(match.source, match.flags + "g");
}

/** Replaces every match of every pattern, merging overlaps so each hidden span reads as one marker. */
function hide(text: string, patterns: RegExp[]): string {
  const spans = patterns
    .flatMap((p) => [...text.matchAll(p)].map((m) => [m.index, m.index + m[0].length] as const))
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of spans) {
    if (start >= at) out += text.slice(at, start) + REDACTED;
    at = Math.max(at, end);
  }
  return out + text.slice(at);
}

/**
 * A filter that hides messages instead of dropping them, so a reader can still
 * tell something was there. Every field narrows the rule; `redact({})` hides everything.
 */
export function redact(rule: RedactRule): Filter {
  const chats = list(rule.chat);
  const senders = list(rule.from);
  const [onStart, onEnd] = rule.on === undefined ? [] : dayRange(rule.on);
  const since = rule.since === undefined ? onStart : toDate(rule.since);
  const until = rule.until === undefined ? onEnd : toDate(rule.until);
  const patterns = list(rule.match).map(toPattern);

  const applies = (m: Message) =>
    (chats.length === 0 ||
      chats.some((c) => sameHandle(c, m.chat.id) || c.toLowerCase() === m.chat.name.toLowerCase())) &&
    (senders.length === 0 || senders.some((s) => sameHandle(s, m.from.id))) &&
    (since === undefined || m.date >= since) &&
    (until === undefined || m.date < until);

  return (m) => {
    if (!applies(m)) return true;
    if (patterns.length === 0) return { ...m, text: REDACTED, attachments: [], redacted: true };
    const text = hide(m.text, patterns);
    return text === m.text ? true : { ...m, text, redacted: true };
  };
}
