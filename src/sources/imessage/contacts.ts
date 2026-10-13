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

function databases(root: string): string[] {
  try {
    return ["AddressBook-v22.abcddb", "Sources/*/AddressBook-v22.abcddb"].flatMap((pattern) => [
      ...new Glob(pattern).scanSync({ cwd: root, absolute: true }),
    ]);
  } catch {
    return [];
  }
}

/**
 * Names from the macOS Contacts database, keyed by `handleKey`. Read directly
 * so it works over ssh, where the Contacts framework isn't available. Every
 * account (iCloud, Google, local) keeps its own database under Sources/.
 */
export function loadContacts(root: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of databases(root)) {
    let db: Database | undefined;
    try {
      db = new Database(file, { readonly: true });
      for (const { handle, name } of db.query<{ handle: string | null; name: string | null }, []>(HANDLES).all()) {
        if (handle && name && !names.has(handleKey(handle))) names.set(handleKey(handle), name);
      }
    } catch {
      continue;
    } finally {
      db?.close();
    }
  }
  return names;
}
