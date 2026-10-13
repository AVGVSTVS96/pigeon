# pigeon

An iMessage CLI with pluggable sources and filters. Read, search, watch and
send; filters (including `redact()`) decide what anything reading through
pigeon gets to see. Bun + TypeScript, no runtime dependencies.

**The shape of it**

```
sources ──messages() newest first──┐
 imessage (built in)               │
 yours (config.ts)                 ▼
                         merge by date, re-check chat/since/until
                                   │
config.ts filters ─────────────────┤  keep · drop · replace, fail closed
                                   ▼
                         search (after filters) · limit
                                   │
                    CLI (src/cli)  or  library (open / pigeon)
```

iMessage is **not privileged**: it's declared with the same `defineSource`
and `Source` interface a user's config gets. Anything it can do, a config
source can do. Keep it that way; when a feature could be a source option or a
filter instead of a flag, make it that.

---

## Commands

```bash
bun test              # all tests (bun:test), against fake databases only
bun run typecheck     # tsc --noEmit
bun demo/seed.ts      # build demo/data (fake chat.db + config), prints PIGEON_CONFIG=...
bun src/cli/main.ts   # run the CLI from source
```

## Layout

```
src/
  index.ts             PUBLIC API (package exports): types, pigeon, open, redact, imessage, defineSource
  types.ts             Message, Chat, Person, Attachment, Source, Filter, Config
  pigeon.ts            the core: merge sources, apply filters, resolve chats, search, watch, send
  config.ts            find + load ~/.config/pigeon/config.ts (fails closed), open()
  redact.ts            the redact() filter
  handles.ts           phone/email normalization (handleKey, sameHandle)
  time.ts              local-day parsing, "3d"-style durations
  define.ts            defineSource
  cli/main.ts          bin: arg parsing and commands
  cli/format.ts        transcript lines, chat lines, JSON with local dates
  sources/imessage/
    index.ts           the iMessage source: SQL over chat.db, watch, send
    typedstream.ts     message text from attributedBody
    contacts.ts        names from the macOS Contacts databases
    send.ts            AppleScript send
examples/telegram.ts   a complete user source (Telegram Desktop JSON export)
demo/seed.ts           fake data for the README and recordings
test/                  fixture.ts builds fake chat.db / Contacts databases
```

## Invariants

**Filters can't be skipped.** No flag or option bypasses them. Every path
that hands out messages (`messages`, `watch`, the CLI, the library) goes
through `screen()` in `pigeon.ts`. Choosing a different config file
(`PIGEON_CONFIG`, `XDG_CONFIG_HOME`) is deliberate, not careless, and stays
allowed: pigeon guards against careless reads, not determined ones.

**Fail closed.** A filter that throws, or returns anything but `true` or a
message, drops that message. A config that fails to import or has the wrong
shape is fatal: `loadConfig` throws and the CLI exits 1 with nothing on
stdout. Never "log and continue without the config" like most tools do.

**Search runs after filters.** Matching raw text first would let a search
reveal what a redaction hides. A source may pre-filter for speed, but the core
always re-matches the filtered text.

**Sources yield newest first; the core trusts nothing else.** `Query` is a
hint. `pigeon.ts` re-checks chat, since and until, and stops at the first
message older than `since`, so a source that ignores the query is still
correct.

**Tapbacks never become messages.** In chat.db a tapback is a message row
whose text quotes the message it reacts to. The iMessage source excludes
`associated_message_type` 2000–3999 so a hidden message can't leak through a
reaction to it.

**One chat per identifier.** Messages keeps separate chat rows for iMessage and
SMS with the same person; the iMessage source merges them by
`chat_identifier`, which is also the chat's public id. For 1:1 chats that id is
the person's handle, so `redact({ chat: "+1…" })` targets exactly that
conversation and not group chats they're in.

**chat.db is read-only.** Open it with `{ readonly: true }`, never write.
Dates are nanoseconds since 2001-01-01 (`fromAppleTime` handles old
second-based rows too).

**`src/index.ts` is public API.** Treat changes to anything exported there,
and to the `Source` / `Message` shapes, as breaking.

## Privacy

This repo is public. Tests, fixtures, the demo and docs use made-up people
only (555-01xx numbers, example.com emails). Never commit anything read from a
real chat.db or Contacts database. When checking behavior against a real
database, print counts, never message text.

## Conventions

- Bun-first: `bun:sqlite`, `Bun.file`, `Bun.spawn`, `bun:test`.
- `.ts` extensions on relative imports; named exports only.
- Plain TypeScript in the public API so anyone can write a source.
- Comments only for the non-obvious (chat.db quirks, ordering rules).
- Errors for people: say what failed and how to fix it, one line on stderr.

## Docs to keep in sync

`README.md` is the user-facing contract: commands, flags, the config API,
`redact()` fields and the JSON shape. Change it in the same commit as any of
those.
