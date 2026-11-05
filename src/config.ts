import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defineSource } from "./define.ts";
import { pigeon } from "./pigeon.ts";
import type { Pigeon } from "./pigeon.ts";
import { redact } from "./redact.ts";
import { imessage } from "./sources/imessage/index.ts";
import type { Config, Filter, Source } from "./types.ts";

export const configApi = { defineSource, imessage, redact };

export type ConfigApi = typeof configApi;

export type ConfigFactory = (api: ConfigApi) => Config | Promise<Config>;

export const configDir = (): string => {
  const base = process.env.XDG_CONFIG_HOME?.trim() ?? "";

  return path.join(base === "" ? path.join(homedir(), ".config") : base, "pigeon");
};

export const findConfig = async (): Promise<string | undefined> => {
  const explicit = process.env.PIGEON_CONFIG?.trim() ?? "";

  if (explicit !== "") {
    return explicit;
  }

  for (const name of ["config.ts", "config.js"]) {
    const file = path.join(configDir(), name);

    if (await Bun.file(file).exists()) {
      return file;
    }
  }

  return undefined;
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const hasDefault = (mod: unknown): mod is { default: unknown } =>
  isObject(mod) && "default" in mod && mod.default !== undefined;

const isFactory = (value: unknown): value is ConfigFactory => typeof value === "function";

interface ConfigExport {
  sources?: unknown;
  filters?: unknown;
}

const isConfigExport = (value: unknown): value is ConfigExport => isObject(value);

const isFilter = (value: unknown): value is Filter => typeof value === "function";

const isSource = (value: unknown): value is Source =>
  isObject(value) &&
  "id" in value &&
  typeof value.id === "string" &&
  "messages" in value &&
  typeof value.messages === "function";

const validate = (raw: ConfigExport, file: string): Config => {
  const unknownKeys = Object.keys(raw).filter((key) => key !== "sources" && key !== "filters");

  if (unknownKeys.length > 0) {
    throw new Error(
      `${file}: unknown config keys: ${unknownKeys.join(", ")} (expected sources, filters)`,
    );
  }

  const { filters, sources } = raw;

  if (filters !== undefined && !(Array.isArray(filters) && filters.every(isFilter))) {
    throw new Error(`${file}: filters must be an array of functions`);
  }

  if (sources !== undefined && !(Array.isArray(sources) && sources.every(isSource))) {
    throw new Error(`${file}: sources must be an array of sources, each with an id and messages()`);
  }

  return { filters, sources };
};

const evaluate = async (file: string): Promise<ConfigExport> => {
  try {
    const mod: unknown = await import(pathToFileURL(file).href);

    if (!hasDefault(mod)) {
      throw new Error("it has no default export");
    }

    const raw = isFactory(mod.default) ? await mod.default(configApi) : mod.default;

    if (!isConfigExport(raw)) {
      throw new Error("it must export a config object or a function returning one");
    }

    return raw;
  } catch (error) {
    throw new Error(
      `couldn't load ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

export const loadConfig = async (): Promise<Config> => {
  const file = await findConfig();

  if (file === undefined) {
    return {};
  }

  if (!(await Bun.file(file).exists())) {
    throw new Error(`config not found: ${file}`);
  }

  const raw = await evaluate(file);

  if (!isConfigExport(raw)) {
    throw new Error(`${file} must export a config object or a function returning one`);
  }

  return validate(raw, file);
};

export const open = async (): Promise<Pigeon> => pigeon(await loadConfig());
