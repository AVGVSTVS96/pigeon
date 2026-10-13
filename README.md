# pigeon

Your messages, from the terminal. Read, search, watch and send iMessage, with
filters that decide what anything reading through pigeon gets to see.

Built for people and for agents: plain-text transcripts by default, JSON lines
with `--json`. Runs on Bun.

```
$ pigeon read
── Mom · +12125550101
Oct 11 13:24  Mom: are you still coming sunday?
Oct 11 13:34  me: yes! bringing dessert
── Riley Quinn · +12125550102
Oct 12 14:24  Riley Quinn: the wifi password is [redacted]
Oct 12 14:34  me: thank you!!
── Book club · chat204
Oct 13 05:24  Sam Okafor: chapter 9 for thursday?
Oct 13 05:39  me: on it [attachment: IMG_2041.heic]
```

- **Read and search** every chat, with names from your Contacts
- **Watch** new messages as they arrive, ready to pipe into a script or an agent
- **Send** text and files through Messages
- **Redact** a chat, a day, a sender or a string, on every command, with no way around it from the CLI
- **Make it yours** in one `config.ts`: [filters](#filters) and [sources](#sources) for Telegram, WhatsApp, anything, built on the same API as iMessage

## Install

pigeon needs [Bun](https://bun.sh) and macOS for iMessage. On Linux it can
still read a `chat.db` copied from a Mac.

```bash
bun add -g github:AVGVSTVS96/pigeon
pigeon --help
```

Give your terminal **Full Disk Access** (System Settings › Privacy & Security)
so it can read `~/Library/Messages/chat.db`. The first `pigeon send` asks once
for permission to control Messages.

## Usage

```bash
pigeon chats                 # chats, most recent first
pigeon chats book            # chats whose name contains "book"
pigeon read mom              # the last 30 messages with Mom
pigeon read                  # the last 30 messages anywhere
pigeon read -s 1d            # everything from the last 24 hours
pigeon read -s yesterday -u today  # all of yesterday
pigeon search dinner sunday  # messages with every word, newest 30
pigeon search pie -c mom     # ...in one chat
pigeon watch                 # new messages, live
pigeon watch --json | jq .   # ...as JSON lines
pigeon send mom "landed!"    # send a message (to an id or a chat's full name)
pigeon send mom -f pie.jpg   # send a file
echo "on my way" | pigeon send +12125550101
pigeon config                # which config loaded, and how many filters
```

A chat is its id or its name. For a 1:1 iMessage chat the id is the other
person's phone number or email, written any way you like (`+1 212 555 0101`,
`2125550101`). Group chats have ids like `chat204`, shown by `pigeon chats`.

| Flag | Meaning |
| ---- | ------- |
| `-n`, `--limit <n>` | how many to show (default 30) |
| `-s`, `--since <when>` | `30m`, `12h`, `3d`, `2w`, `today`, `yesterday`, or a date like `2026-10-01` |
| `-u`, `--until <when>` | same forms as `--since` |
| `-c`, `--chat <chat>` | limit `search` or `watch` to one chat |
| `-f`, `--file <path>` | attach a file to `send` (repeatable) |
| `--json` | one JSON object per line |

`read` and `search` show the newest matches, printed oldest first like a
conversation. Dates are local time, in text and in JSON.

<details>
<summary>The JSON shape</summary>

```json
{
  "id": "6A1F3B7C-…",
  "source": "imessage",
  "chat": { "id": "+12125550102", "name": "Riley Quinn" },
  "from": { "id": "+12125550102", "name": "Riley Quinn" },
  "text": "the wifi password is [redacted]",
  "date": "2026-10-12T14:24:45-07:00",
  "attachments": [],
  "service": "iMessage",
  "redacted": true
}
```

`from.id` is `"me"` for messages you sent. `replyTo` holds the id of the
message being replied to. `attachments` entries have a `name`, a `mime`
when known, and a `path` when the file is on this Mac (with Messages in
iCloud, older files may only be in the cloud).

</details>

## Make it yours

Everything is configured from one file, `~/.config/pigeon/config.ts`. It's
plain TypeScript: export a function that receives pigeon's API and returns
your `sources` and `filters`.

```ts
// ~/.config/pigeon/config.ts
import type { ConfigFactory } from "@avgvstvs96/pigeon";

export default (({ imessage, redact }) => ({
  sources: [imessage()],
  filters: [
    redact({ chat: "+12125550102", on: "2026-10-06" }),   // one chat, one day
    redact({ match: /\b\d{3}-\d{2}-\d{4}\b/ }),             // anything shaped like an SSN
    (m) => !/verification code/i.test(m.text),             // drop 2FA texts entirely
  ],
})) satisfies ConfigFactory;
```

Without a config, pigeon reads iMessage with no filters.

### Filters

A filter is a function that gets each message and returns:

| Return | Effect |
| ------ | ------ |
| `true` | keep it |
| `false` | drop it |
| a message | show this one instead |

Filters run in order, on every command: `read`, `search`, `watch`, and the
[library](#library). There is no flag to skip them, so whatever reads your
messages through pigeon (you, a script, an agent) sees exactly what your
filters allow.

pigeon fails closed. A filter that throws drops the message it threw on. A
config that fails to load stops pigeon with an error instead of running
without its filters, and so does one with a typo in it (`filter:` instead of
`filters:`). Search runs *after* filters, so hidden text can't be found by
searching for it.

Filters apply to messages. `pigeon chats` still lists every chat, with its
name, people and the time of its last message.

### Redact

`redact()` is the built-in filter for hiding things. It keeps the message
but replaces its text with `[redacted]`, so a reader still sees that
something was said, and when, but not what. Every field narrows the rule:

```ts
redact({ chat: "+12125550102" })                     // a whole chat
redact({ chat: "chat204", on: "2026-10-06" })        // one day of a group chat
redact({ from: "+12125550102", since: "2026-09-01" }) // one person, from a date on
redact({ from: "me", until: "2020-01-01" })          // everything you sent before 2020
redact({ match: ["gate code", /\d{4}/] })            // just these strings, everywhere
```

| Field | Matches |
| ----- | ------- |
| `chat` | a chat id (one or a list): a phone number or email for 1:1 chats, the id from `pigeon chats` for groups |
| `from` | a sender's handle, or `"me"` (one or a list) |
| `on` | a whole day, local time: `"2026-10-06"` |
| `since` / `until` | a time range: a `Date`, a timestamp, or a date string |
| `match` | strings (case-insensitive) or regexes to hide in the text and attachment names; without it, the whole message is hidden along with its attachments |

Phone numbers match however they're written, so `"212-555-0102"` and
`"+12125550102"` are the same person. Rules take ids, not names: a contact
or group can be renamed, and a rule that quietly stopped matching would show
everything it was hiding.

### Sources

iMessage isn't special: it's declared with the same `defineSource` your
config gets. A source needs an `id` and two functions:

```ts
import type { Source } from "@avgvstvs96/pigeon";

const notes: Source = {
  id: "notes",
  chats: () => [{ id: "inbox", source: "notes", name: "Inbox", people: [], group: false }],
  *messages() {
    yield {
      id: "1",
      source: "notes",
      chat: { id: "inbox", name: "Inbox" },
      from: { id: "me", name: "me" },
      text: "remember the pie",
      date: new Date(),
      attachments: [],
    };
  },
};
```

`messages()` yields newest first and may ignore its query (`chat`,
`since`, `until`): pigeon re-checks every message, so the simplest source is
just "here are my messages". Add `watch()` to make `pigeon watch` work for it
and `send()` for `pigeon send`. [`examples/telegram.ts`](examples/telegram.ts)
is a complete source for Telegram Desktop's JSON export in about 80 lines.

Sources merge into one stream by date, and filters apply to all of them:

```ts
import { telegram } from "./telegram.ts";

export default (({ imessage, redact }) => ({
  sources: [imessage(), telegram("~/Downloads/Telegram Desktop/DataExport/result.json")],
  filters: [redact({ match: "the gate code" })],
})) satisfies ConfigFactory;
```

`imessage()` takes options too: `db` to read another `chat.db` (a backup,
or a copy on Linux), `contacts` to point at another Contacts folder or
`false` to show raw handles, and `id` to tell two iMessage sources apart.

## Library

The CLI is a thin layer over the same API, which you can use directly:

```ts
import { open } from "@avgvstvs96/pigeon";

const pigeon = await open(); // your config, your filters

for await (const m of pigeon.messages({ chat: "mom", since: new Date("2026-10-01") })) {
  console.log(m.from.name, m.text);
}

for await (const m of pigeon.watch()) {
  if (m.text.includes("call me")) await pigeon.send(m.chat.id, { text: "calling in 5" });
}
```

`pigeon({ sources, filters })` builds one without reading a config file.

## For agents

Agents read the same transcripts you do, and `--json` when they need
structure. [`skills/pigeon/SKILL.md`](skills/pigeon/SKILL.md) teaches Claude
Code, Codex and other skill-aware agents to use pigeon instead of opening
`chat.db` themselves:

```bash
cp -r skills/pigeon ~/.claude/skills/
```

## How it reads iMessage

pigeon opens `chat.db` read-only and never writes to it. It reads message
text from `attributedBody` when newer macOS leaves `text` empty, merges a
person's iMessage and SMS threads into one chat like Messages does, and
reads names straight from the Contacts database, so it works over ssh too.
Tapbacks and system events (renames, people joining) aren't messages and are
skipped; tapbacks also quote the message they react to, so skipping them keeps
hidden text from leaking out through a "Loved …".

`watch` wakes on every write to the database and checks every few seconds in
case an event is missed. `send` uses AppleScript, so it needs Messages to be
signed in and permission to control it.

## What redaction promises

pigeon never hands out what your filters hide, through any command or the
library. It can't stop other programs from opening `chat.db` themselves:
anything with Full Disk Access can. Give your agents pigeon and they have no
reason to go around it. Anything truly sensitive is safest deleted from
Messages.

## Credits

[imsg](https://github.com/steipete/imsg) by Peter Steinberger was a great map
of `chat.db`'s quirks.

## License

MIT
