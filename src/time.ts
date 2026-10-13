export type DateInput = Date | number | string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const AGO = /^(\d+(?:\.\d+)?)([mhdw])$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Bare dates ("2026-10-06") are local midnight, not UTC like `new Date()` reads them. */
export function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  const day = DAY.exec(input.trim());
  const date = day ? new Date(+day[1]!, +day[2]! - 1, +day[3]!) : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${input}`);
  return date;
}

/** A calendar day in local time, as [start, end). */
export function dayRange(input: DateInput): [Date, Date] {
  const start = new Date(toDate(input));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start, end];
}

/** CLI times: "30m", "12h", "3d", "2w" ago, "today" or "yesterday" (from midnight), or any date `toDate` reads. */
export function parseWhen(input: string, now = Date.now()): Date {
  const word = input.trim().toLowerCase();
  if (word === "today" || word === "yesterday") {
    const [start] = dayRange(now);
    if (word === "yesterday") start.setDate(start.getDate() - 1);
    return start;
  }
  const ago = AGO.exec(word);
  if (ago) return new Date(now - Number(ago[1]) * UNIT_MS[ago[2] as keyof typeof UNIT_MS]);
  return toDate(input);
}
