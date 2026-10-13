import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineSource } from "./define.ts";
import { pigeon, type Pigeon } from "./pigeon.ts";
import { redact } from "./redact.ts";
import { imessage } from "./sources/imessage/index.ts";
import type { Config } from "./types.ts";

export const configApi = { defineSource, imessage, redact };

export type ConfigApi = typeof configApi;
export type ConfigFactory = (api: ConfigApi) => Config | Promise<Config>;

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "pigeon");
}

/** The config file pigeon will load, if there is one. */
export async function findConfig(): Promise<string | undefined> {
  const explicit = process.env.PIGEON_CONFIG?.trim();
  if (explicit) return explicit;
  for (const name of ["config.ts", "config.js"]) {
    const path = join(configDir(), name);
    if (await Bun.file(path).exists()) return path;
  }
}

function validate(raw: unknown, path: string): Config {
  if (!raw || typeof raw !== "object") throw new Error(`${path} must export a config object or a function returning one`);
  const { sources, filters } = raw as Config;
  if (filters !== undefined && !(Array.isArray(filters) && filters.every((f) => typeof f === "function"))) {
    throw new Error(`${path}: filters must be an array of functions`);
  }
  if (
    sources !== undefined &&
    !(Array.isArray(sources) && sources.every((s) => s && typeof s.id === "string" && typeof s.messages === "function"))
  ) {
    throw new Error(`${path}: sources must be an array of sources, each with an id and messages()`);
  }
  return { sources, filters };
}

/**
 * Reads `~/.config/pigeon/config.ts`. Unlike most tools, a config that fails
 * to load is fatal: it may hold the filters that hide messages, and running
 * without them would hand those messages out.
 */
export async function loadConfig(): Promise<Config> {
  const path = await findConfig();
  if (!path) return {};
  if (!(await Bun.file(path).exists())) throw new Error(`config not found: ${path}`);
  let raw: unknown;
  try {
    const mod = await import(pathToFileURL(path).href);
    raw = typeof mod.default === "function" ? await (mod.default as ConfigFactory)(configApi) : (mod.default ?? mod);
  } catch (err) {
    throw new Error(`couldn't load ${path}: ${err instanceof Error ? err.message : err}`);
  }
  return validate(raw, path);
}

/** pigeon with your config applied: the same messages, and the same hidden ones, as the CLI. */
export async function open(): Promise<Pigeon> {
  return pigeon(await loadConfig());
}
