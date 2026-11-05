import { Database } from "bun:sqlite";

import { Glob } from "bun";

import { handleKey } from "../../handles.ts";

const NAME = `
  COALESCE(
    NULLIF(TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '')), ''),
    r.ZNICKNAME,
    r.ZORGANIZATION
  )`;

const HANDLES = `
  SELECT p.ZFULLNUMBER AS handle, ${NAME} AS name
  FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
  UNION ALL
  SELECT e.ZADDRESS AS handle, ${NAME} AS name
  FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER`;

const EVERY_ACCOUNTS_DATABASE = ["AddressBook-v22.abcddb", "Sources/*/AddressBook-v22.abcddb"];

interface HandleRow {
  handle: string | null;
  name: string | null;
}

const databases = (root: string): string[] => {
  try {
    return EVERY_ACCOUNTS_DATABASE.flatMap((pattern) => [
      ...new Glob(pattern).scanSync({ absolute: true, cwd: root }),
    ]);
  } catch {
    return [];
  }
};

const readHandles = (file: string): HandleRow[] => {
  let db: Database | undefined;

  try {
    db = new Database(file, { readonly: true });

    return db.query<HandleRow, []>(HANDLES).all();
  } catch {
    return [];
  } finally {
    db?.close();
  }
};

export const loadContacts = (root: string): Map<string, string> => {
  const names = new Map<string, string>();

  for (const { handle, name } of databases(root).flatMap(readHandles)) {
    if (
      handle !== null &&
      name !== null &&
      handle !== "" &&
      name !== "" &&
      !names.has(handleKey(handle))
    ) {
      names.set(handleKey(handle), name);
    }
  }

  return names;
};
