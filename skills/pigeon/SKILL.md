---
name: pigeon
description: Read, search, watch and send the user's iMessages (and any other sources they've configured) with the pigeon CLI. Use whenever a task involves their texts or chats, instead of opening chat.db or any Messages database directly.
---

# pigeon

`pigeon` reads the user's messages with their filters already applied. Messages
they've hidden show up as `[redacted]`; that is intentional, so never try to
recover them, and never read `chat.db` or a copy of it directly.

```bash
pigeon chats [name]               # find a chat and its id
pigeon read <chat> [-n 30]        # recent messages, oldest first
pigeon read -s 1d                 # everything from the last day, all chats
pigeon search <words...> [-c chat] [-s 2w]
pigeon watch [chat] --json        # stream new messages
pigeon send <chat> "text" [-f file]
```

- A chat is its id (a phone number or email for 1:1 chats, `chat…` for groups) or its name. If a name matches several chats, pigeon lists them; retry with the id.
- `-s/--since` and `-u/--until` take `30m`, `12h`, `3d`, `2w`, `today`, `yesterday` or a date.
- Add `--json` for one object per line: `chat`, `from` (`id` is `"me"` for the user), `text`, `date` (local time), `attachments`, `replyTo`, `redacted`.
- Default output is a compact transcript; prefer it for reading, `--json` for processing.
- Sending is visible to other people: only send when the user asked for that message.
