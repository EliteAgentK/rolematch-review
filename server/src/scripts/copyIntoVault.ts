// The rehearsal copy of every original from Supabase's private bucket into our own vault (docs/database/19_VAULT_V1.md). Reads live, writes only the vault.
//   VAULT_DIR=/srv/rehearsal/vault VAULT_KEYS=… node src/scripts/copyIntoVault.js
// Each original is downloaded, put into the vault, read back and decrypted, and must have the downloaded bytes' SHA-256; it is compared with the hash the
// database recorded at upload too, which differs only where the pipeline replaced an oversized image with its smaller form. Counts only, never a path or a byte.
import { createHash } from "node:crypto";
import { fileVault, keysFrom } from "../fileVault";

type Vault = ReturnType<typeof fileVault>;
export interface CopyCounts { listed: number; copied: number; verified: number; differsFromRecord: number; missingAtSource: number; failed: number }
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Copies each document's original, a few at a time, and checks each one back out of the vault. */
export async function copyIntoVault(docs: { path: string; sha256: string }[], read: (path: string) => Promise<Uint8Array>, vault: Vault, atOnce = 3): Promise<CopyCounts> {
  const n: CopyCounts = { listed: docs.length, copied: 0, verified: 0, differsFromRecord: 0, missingAtSource: 0, failed: 0 };
  let next = 0;
  const one = async ({ path, sha256 }: { path: string; sha256: string }) => {
    let bytes: Uint8Array;
    try { bytes = await read(path); } catch { n.missingAtSource++; return; }
    try {
      await vault.put(path, bytes); n.copied++;
      const back = await vault.get(path), want = sha(bytes);
      if (sha(back) === want) n.verified++; else n.failed++;
      if (want !== sha256) n.differsFromRecord++;
    } catch { n.failed++; }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, docs.length) }, async () => { while (next < docs.length) await one(docs[next++]); }));
  return n;
}

if (process.argv[1]?.endsWith("copyIntoVault.js") || process.argv[1]?.endsWith("copyIntoVault.ts")) {
  // The source must be Supabase: with STORE_DIR set, getObject would read a vault, and the copy would prove nothing.
  if (process.env.STORE_DIR) { console.error("STORE_DIR is set: this copies from Supabase, so run it without STORE_DIR."); process.exit(1); }
  const dir = process.env.VAULT_DIR; if (!dir) { console.error("VAULT_DIR is not set."); process.exit(1); }
  const vault = fileVault(dir, keysFrom(process.env.VAULT_KEYS ?? ""));
  const { platformSql: sql } = await import("../db"), { getObject } = await import("../supabase");
  const docs = ((await sql`select storage_path as path, sha256 from documents where storage_path is not null`) as { path: string; sha256: string }[]);
  const n = await copyIntoVault(docs, getObject, vault);
  console.log(JSON.stringify({ event: "vault.copy", ...n }));
  await sql.end({ timeout: 5 });
  process.exit(n.failed || n.missingAtSource || n.verified !== n.listed ? 1 : 0);
}
