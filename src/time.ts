export type DateInput = Date | number | string;

const BARE_DAY = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const AGO = /^(?<amount>\d+(?:\.\d+)?)(?<unit>[mhdw])$/u;

const UNIT_MS = new Map([
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
  ["w", 604_800_000],
]);

const localMidnight = (input: string): Date | undefined => {
  const day = BARE_DAY.exec(input)?.groups;

  if (day === undefined) {
    return undefined;
  }

  return new Date(Number(day.year), Number(day.month) - 1, Number(day.day));
};

export const toDate = (input: DateInput): Date => {
  if (input instanceof Date) {
    return input;
  }

  const date = localMidnight(String(input).trim()) ?? new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`not a date: ${input}`);
  }

  return date;
};

export const dayRange = (input: DateInput): [Date, Date] => {
  const start = new Date(toDate(input));

  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  end.setDate(end.getDate() + 1);

  return [start, end];
};

const ago = (word: string, now: number): Date | undefined => {
  const match = AGO.exec(word)?.groups;
  const unit = match === undefined ? undefined : UNIT_MS.get(match.unit ?? "");

  if (match === undefined || unit === undefined) {
    return undefined;
  }

  return new Date(now - Number(match.amount) * unit);
};

export const parseWhen = (input: string, now = Date.now()): Date => {
  const word = input.trim().toLowerCase();

  if (word === "today" || word === "yesterday") {
    const [start] = dayRange(now);

    if (word === "yesterday") {
      start.setDate(start.getDate() - 1);
    }

    return start;
  }

  return ago(word, now) ?? toDate(input);
};
