import { rmSync } from "node:fs";
import { join } from "node:path";
import { fakeChatDb, fakeContacts } from "../test/fixture.ts";

/** Builds demo/data: a chat.db and Contacts of made-up people, for the README and recordings. */
const dir = join(import.meta.dir, "data");
rmSync(dir, { recursive: true, force: true });
const fake = fakeChatDb(dir);
const contacts = fakeContacts([
  { first: "Mom", phones: ["+1 (212) 555-0101"] },
  { first: "Riley", last: "Quinn", phones: ["+1 (212) 555-0102"] },
  { first: "Sam", last: "Okafor", emails: ["sam@example.com"] },
]);

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const mom = fake.chat({ id: "+12125550101" });
const riley = fake.chat({ id: "+12125550102" });
const club = fake.chat({ id: "chat204", handles: ["+12125550102", "sam@example.com"], group: true, name: "Book club" });

const script: [number, number, string, string, { name: string; mime: string }?][] = [
  [mom, 3000, "+12125550101", "are you still coming sunday?"],
  [mom, 2990, "me", "yes! bringing dessert"],
  [mom, 2985, "+12125550101", "your aunt says bring the good pie this time"],
  [riley, 1500, "+12125550102", "the wifi password is purple-otter-42"],
  [riley, 1490, "me", "thank you!!"],
  [club, 600, "sam@example.com", "chapter 9 for thursday?"],
  [club, 590, "+12125550102", "only if someone brings snacks"],
  [club, 585, "me", "on it", { name: "IMG_2041.heic", mime: "image/heic" }],
  [mom, 30, "+12125550101", "call me when you land ✈️"],
];
for (const [chat, minutes, from, text, file] of script) {
  fake.message({ chat, from, text, date: ago(minutes), attachments: file && [file] });
}
fake.db.close();

await Bun.write(
  join(dir, "config.ts"),
  `export default ({ imessage, redact }) => ({
  sources: [imessage({ db: ${JSON.stringify(fake.path)}, contacts: ${JSON.stringify(contacts)} })],
  filters: [
    redact({ chat: "+12125550102", match: /purple-otter-\\d+/ }),
  ],
});
`,
);
console.log(`PIGEON_CONFIG=${join(dir, "config.ts")}`);
