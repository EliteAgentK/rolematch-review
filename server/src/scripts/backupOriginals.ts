// The private originals' side of a backup and restore (deploy/backup.sh, deploy/restore.sh). They are copied into this server's encrypted vault (src/originalsCopy.ts): new ones added, deleted ones removed.
//   node src/scripts/backupOriginals.js          brings the vault up to date
//   node src/scripts/backupOriginals.js restore  puts every original the database names back into Supabase storage
import { config } from "../config";
import { platformSql as sql } from "../db";
import { contentTypeOf, sniff } from "../formats";
import { OriginalsCopy, pruneLooksSafe } from "../originalsCopy";
import { getObject, putObject } from "../supabase";
import { guardTarget } from "./target";

// Restoring writes every original back into storage: it says which database names them, and refuses live or one elsewhere unless told on purpose
// (target.ts; code review, 16 Nov 2026, D-M5). Bringing the vault up to date only reads the database.
if (process.argv.includes("restore")) guardTarget("restore originals");
const vault = OriginalsCopy.fromEnv(config.dataDir);
if (!vault.enabled) { console.error("LOCAL_ENCRYPTION_KEY is not set: refusing to copy originals unencrypted."); process.exit(1); }
const paths = ((await sql`select storage_path from documents where storage_path is not null`) as { storage_path: string }[]).map((r) => r.storage_path);
let done = 0; const failed: number[] = [];
if (process.argv.includes("restore")) {
  for (const [i, p] of paths.entries()) {
    const bytes = vault.read(p);
    if (!bytes) { failed.push(i); continue; }
    const type = sniff(new Uint8Array(bytes));
    await putObject(p, new Uint8Array(bytes), type ? contentTypeOf(type) : "application/octet-stream").then(() => done++, () => failed.push(i));
  }
  console.log(`Restored ${done} of ${paths.length} originals; ${failed.length} could not be restored.`);
} else {
  for (const [i, p] of vault.missing(paths).entries()) await getObject(p).then((b) => { vault.write(p, b); done++; }, () => failed.push(i));
  const orphans = vault.orphans(paths), total = orphans + paths.length;
  if (!pruneLooksSafe(orphans, total)) { console.error(`REFUSED to remove ${orphans} of ${total} copies: the database lists far fewer documents than the vault holds, which is what a lost database looks like. Nothing was removed. A person must look.`); process.exit(1); }
  const removed = vault.prune(paths);
  console.log(`Vault holds ${paths.length - failed.length} of ${paths.length} originals: ${done} added, ${removed} removed, ${failed.length} could not be read.`);
}
await sql.end({ timeout: 5 });
process.exit(failed.length ? 1 : 0);
