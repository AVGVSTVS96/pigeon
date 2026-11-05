import { watch } from "node:fs";
import path from "node:path";

const SETTLE_MS = 50;

const resolveAfter = (ms: number, signal: PromiseWithResolvers<boolean>) =>
  setTimeout(() => {
    signal.resolve(false);
  }, ms);

export const changes = async function* changes(
  dbPath: string,
  fallbackMs = 3000,
): AsyncGenerator<boolean> {
  let signal = Promise.withResolvers<boolean>();
  let dirty = false;

  const watcher = watch(path.dirname(dbPath), () => {
    dirty = true;
    signal.resolve(true);
  });

  try {
    while (true) {
      if (!dirty) {
        const timer = resolveAfter(fallbackMs, signal);

        await signal.promise;
        clearTimeout(timer);
        await Bun.sleep(SETTLE_MS);
      }

      const changed = dirty;

      dirty = false;
      signal = Promise.withResolvers<boolean>();
      yield changed;
    }
  } finally {
    watcher.close();
  }
};
