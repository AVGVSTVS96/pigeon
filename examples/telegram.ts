import { homedir } from "node:os";
import type { Chat, Message, Source } from "@avgvstvs96/pigeon";

type Text = string | ({ text: string } & Record<string, unknown>);

interface Export {
  personal_information?: { user_id: number };
  chats: {
    list: {
      id: number;
      name?: string;
      type: string;
      messages: {
        id: number;
        type: string;
        date_unixtime: string;
        from?: string;
        from_id?: string;
        text: Text | Text[];
        file?: string;
        photo?: string;
        reply_to_message_id?: number;
      }[];
    }[];
  };
}

const plain = (text: Text | Text[]) => [text].flat().map((t) => (typeof t === "string" ? t : t.text)).join("");

/**
 * Telegram Desktop's "Export chat history" (JSON) as a pigeon source.
 * Read-only: no watch, no send. Copy this file next to your config to use it.
 */
export function telegram(path: string): Source {
  let loaded: Promise<{ chats: Chat[]; messages: Message[] }> | undefined;

  const load = async () => {
    const data: Export = await Bun.file(path.replace(/^~(?=\/)/, homedir())).json();
    const me = data.personal_information && `user${data.personal_information.user_id}`;
    const chats: Chat[] = [];
    const messages: Message[] = [];
    for (const c of data.chats.list) {
      const chat = { id: String(c.id), name: c.name ?? "Saved Messages" };
      const people = new Map<string, string>();
      let last: Date | undefined;
      for (const m of c.messages) {
        if (m.type !== "message") continue;
        const fromMe = m.from_id === me;
        if (!fromMe && m.from_id) people.set(m.from_id, m.from ?? m.from_id);
        last = new Date(Number(m.date_unixtime) * 1000);
        messages.push({
          id: `${c.id}/${m.id}`,
          source: "telegram",
          chat,
          from: fromMe ? { id: "me", name: "me" } : { id: m.from_id ?? "unknown", name: m.from ?? "unknown" },
          text: plain(m.text),
          date: last,
          attachments: [m.photo, m.file].filter((f) => f !== undefined).map((f) => ({ name: f.split("/").pop()! })),
          ...(m.reply_to_message_id && { replyTo: `${c.id}/${m.reply_to_message_id}` }),
        });
      }
      chats.push({
        ...chat,
        source: "telegram",
        people: [...people].map(([id, name]) => ({ id, name })),
        group: !c.type.startsWith("personal"),
        date: last,
      });
    }
    messages.sort((a, b) => b.date.getTime() - a.date.getTime());
    return { chats, messages };
  };

  return {
    id: "telegram",
    label: "Telegram",
    chats: async () => (await (loaded ??= load())).chats,
    async *messages() {
      yield* (await (loaded ??= load())).messages;
    },
  };
}
