import type { Source } from "./types.ts";

export const defineSource = <S extends Source>(source: S): S => source;
