# pigeon

An iMessage CLI and library with pluggable sources and filters. Filters (including `redact()`) decide what anything reading through pigeon gets to see. Bun + TypeScript, no runtime dependencies. Public, MIT, published as `@avgvstvs96/pigeon`.

## Commands

- `bun run check`: oxlint, oxfmt, `tsc`, `bun test` (fake databases only). Lefthook runs it before each commit, CI on each push.
- `bun run fix`: oxlint's fixes, then oxfmt.
- `bun demo/seed.ts`: builds `demo/data` (a fake chat.db and config) and prints its `PIGEON_CONFIG=…`.
- `bun src/cli/main.ts`: the CLI from source.

## Map

```
sources ──messages() newest first──┐
 imessage (built in), yours        ▼
                         merge by date, re-check chat/since/until
config.ts filters ───────► screen(): keep · drop · replace, fail closed → Screened
                         search (after filters) · limit
                    CLI (src/cli)  or  library (src/index.ts)
```

| Folder                  | Job                                                             |
| ----------------------- | --------------------------------------------------------------- |
| `src/index.ts`          | the public API: anything exported there is a breaking change    |
| `src/pigeon.ts`         | the core: merge sources, resolve chats, search, watch, send     |
| `src/screen.ts`         | runs the filters and is the only maker of a `Screened` message  |
| `src/config.ts`         | finds and loads `~/.config/pigeon/config.ts`, parsed and strict |
| `src/sources/imessage/` | chat.db, Contacts, typedstream text, AppleScript send           |
| `src/cli/`              | argument parsing, transcript and JSON output                    |
| `examples/`, `skills/`  | a complete Telegram source; the skill agents install            |

iMessage is not privileged: it's declared with the same `defineSource` a user's config gets. When a feature could be a source option or a filter instead of a flag, make it that.

## Rules and what enforces them

| Rule                                                                                          | Enforced by                                                           |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Filters can't be skipped: every message the library and CLI hand out went through them        | `Screened` type on `Pigeon` and the CLI printers; `as` is lint-banned |
| Fail closed: a filter that throws or returns junk drops the message; a bad config is fatal    | `test/pigeon.test.ts`, `test/cli.test.ts`                             |
| Search runs after filters, so it can't reveal hidden text                                     | `test/pigeon.test.ts`, `test/cli.test.ts`                             |
| Sources yield newest first and the core trusts nothing else in a `Query`                      | `test/pigeon.test.ts` (a source that ignores its query)               |
| Tapbacks never become messages, so hidden text can't leak through a reaction                  | `test/imessage.test.ts`                                               |
| chat.db is read-only                                                                          | `readonly: true`, `test/imessage.test.ts`                             |
| No comments, `as`, `any` or non-null `!`                                                      | `oxlint.config.ts`                                                    |
| Rules target ids, never names: names come from Contacts and change under a rule               | `test/redact.test.ts`; judgment for new filters                       |
| `send` never guesses: only an id or an exact name, since a wrong guess texts the wrong people | judgment                                                              |
| `chats()` is metadata and documented as unfiltered                                            | judgment                                                              |

Choosing a different config file (`PIGEON_CONFIG`, `XDG_CONFIG_HOME`) stays allowed: pigeon guards against careless reads, not determined ones.

## Privacy

This repo is public. Tests, fixtures, the demo and docs use made-up people only (555-01xx numbers, example.com emails). Never commit anything read from a real chat.db or Contacts database; when checking against a real one, print counts, never message text.

`README.md` is the user-facing contract (commands, flags, the config API, `redact()` fields, the JSON shape): change it in the same commit as any of those. TypeScript is 7, newer than most model memory.
