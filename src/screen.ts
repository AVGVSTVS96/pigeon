import type { Filter, Message } from "./types.ts";

declare const screened: unique symbol;

export type Screened = Message & { readonly [screened]: true };

const isMessage = (value: boolean | Message): value is Message =>
  typeof value === "object" &&
  typeof value.text === "string" &&
  value.date instanceof Date &&
  Array.isArray(value.attachments);

export const screener = (filters: Filter[]): ((message: Message) => Screened | undefined) => {
  const warned = new Set<number>();

  const run = (filter: Filter, index: number, message: Message): boolean | Message => {
    try {
      return filter(message);
    } catch (error) {
      if (!warned.has(index)) {
        console.error(
          `pigeon: filter ${index + 1} threw, dropping what it fails on\n  ${String(error)}`,
        );
      }

      warned.add(index);

      return false;
    }
  };

  return (message) => {
    let current: Message | undefined = message;

    for (const [index, filter] of filters.entries()) {
      const result = run(filter, index, current);

      if (result !== true) {
        current = isMessage(result) ? result : undefined;
      }

      if (current === undefined) {
        return current;
      }
    }

    // SAFETY: every filter ran on this message and kept it
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- screen() is the one place a message becomes Screened
    return current as Screened;
  };
};
