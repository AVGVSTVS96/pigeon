import type { Source } from "./types.ts";

/** Types a source. The built-in iMessage source is declared with this too. */
export function defineSource<S extends Source>(source: S): S {
  return source;
}
