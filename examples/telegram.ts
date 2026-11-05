import { homedir } from "node:os";

import type { Chat, Message, Source } from "@avgvstvs96/pigeon";

type Text = string | { text: string };

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

const isString = (text: Text): text is string => typeof text === "string";

const plain = (text: Text | Text[]) =>
  [text]
    .flat()
    .map((t) => (isString(t) ? t : t.text))
    .join("");

const readExport = async (file: string): Promise<Export> => {
  const raw = Bun.file(file.replace(/^~(?=\/)/u, homedir()));

  // SAFETY: Telegram Desktop's "Export chat history" writes this JSON shape
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an example source trusts the app that wrote the export
  return (await raw.json()) as Export;
};

const fileName = (file: string) => file.split("/").pop() ?? file;

export const telegram = (exportFile: string): Source => {
  let loaded: Promise<{ chats: Chat[]; messages: Message[] }> | undefined;

  const load = async () => {
    const data = await readExport(exportFile);

    const me =
      data.personal_information === undefined
        ? undefined
        : `user${data.personal_information.user_id}`;

    const chats: Chat[] = [];
    const messages: Message[] = [];

    for (const c of data.chats.list) {
      const chat = { id: String(c.id), name: c.name ?? "Saved Messages" };
      const people = new Map<string, string>();
      let last: Date | undefined;

      for (const m of c.messages) {
        if (m.type !== "message") {
          continue;
        }

        const fromMe = m.from_id === me;

        if (!fromMe && m.from_id !== undefined) {
          people.set(m.from_id, m.from ?? m.from_id);
        }

        last = new Date(Number(m.date_unixtime) * 1000);
        messages.push({
          id: `${c.id}/${m.id}`,
          source: "telegram",
          chat,
          from: fromMe
            ? { id: "me", name: "me" }
            : { id: m.from_id ?? "unknown", name: m.from ?? "unknown" },
          text: plain(m.text),
          date: last,
          attachments: [m.photo, m.file].flatMap((f) =>
            f === undefined ? [] : [{ name: fileName(f) }],
          ),
          ...(m.reply_to_message_id !== undefined && {
            replyTo: `${c.id}/${m.reply_to_message_id}`,
          }),
        });
      }

      chats.push({
        ...chat,
        source: "telegram",
        people: [...people].map(([id, name]) => ({ id, name })),
        group: !c.type.startsWith("personal"),
        ...(last && { date: last }),
      });
    }

    return {
      chats,
      messages: messages.toSorted((a, b) => b.date.getTime() - a.date.getTime()),
    };
  };

  return {
    id: "telegram",
    label: "Telegram",
    chats: async () => {
      loaded ??= load();
      const { chats } = await loaded;

      return chats;
    },
    messages: async function* messages() {
      loaded ??= load();
      const all = await loaded;

      yield* all.messages;
    },
  };
};
