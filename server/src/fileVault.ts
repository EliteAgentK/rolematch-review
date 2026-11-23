// Our own file vault for originals (docs/database/19_VAULT_V1.md, 06_FILE_VAULT.md). Each object is AES-256-GCM encrypted with the path bound in as associated
// data, so a file copied to another document or another organisation's folder fails its check instead of being served. On disk:
//   <root>/<organisation id>/<sha256(path)>.bin  =  "RMV1" | key version (1 byte) | nonce (12) | tag (16) | ciphertext
// Written to a temporary file in the same folder, flushed, then renamed, so a reader sees the old object or the new one, never part of one.
// Keys come from VAULT_KEYS ("1:<base64>,2:<base64>"), held in the host's root-only settings file, never on the vault's disk or in the database;
// new objects use the highest version, and older objects keep reading with theirs until they are rewritten.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const MAGIC = Buffer.from("RMV1"), HEAD = MAGIC.length + 1 + 12 + 16;
/** A stored object failed its check: changed on disk, moved from another path, or written under another key. Never served. */
export class VaultTampered extends Error {}

export function keysFrom(spec: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [v, b64] = part.split(":"), version = Number(v), key = Buffer.from(b64 ?? "", "base64");
    if (!Number.isInteger(version) || version < 1 || version > 255) throw new Error("VAULT_KEYS: a key version is a whole number from 1 to 255");
    if (key.length !== 32) throw new Error("VAULT_KEYS: each key must be 32 bytes, base64-encoded (openssl rand -base64 32)");
    if (keys.has(version)) throw new Error(`VAULT_KEYS: version ${version} is given twice`);
    keys.set(version, key);
  }
  return keys;
}

/** Two segments, an organisation and a document, each of letters, digits, dots, dashes and underscores, starting with a letter or digit: nothing can climb out. */
const PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const checked = (path: string) => { if (!PATH.test(path)) throw new Error("not a vault path: <organisation>/<document> expected"); return path; };
/** The name an object has on disk: says nothing about the document. */
export const objectName = (path: string) => `${createHash("sha256").update(checked(path)).digest("hex")}.bin`;
const aad = (path: string) => Buffer.from(`rolematch-vault|${path}`);

export function fileVault(root: string, keys: Map<number, Buffer>) {
  if (!keys.size) throw new Error("The file vault needs VAULT_KEYS: it never writes an original unencrypted.");
  const current = Math.max(...keys.keys()), folder = (path: string) => join(root, checked(path).split("/")[0]), fileOf = (path: string) => join(folder(path), objectName(path));
  return {
    async put(path: string, bytes: Uint8Array) {
      const dir = folder(path), nonce = randomBytes(12), c = createCipheriv("aes-256-gcm", keys.get(current)!, nonce);
      c.setAAD(aad(path));
      const body = Buffer.concat([c.update(bytes), c.final()]), sealed = Buffer.concat([MAGIC, Buffer.from([current]), nonce, c.getAuthTag(), body]);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`), f = await open(tmp, "wx", 0o600);
      try { await f.writeFile(sealed); await f.sync(); } finally { await f.close(); }
      try { await rename(tmp, fileOf(path)); } catch (e) { await rm(tmp, { force: true }); throw e; }
      const d = await open(dir, "r"); try { await d.sync(); } finally { await d.close(); }   // the rename itself survives a power cut
    },
    async get(path: string): Promise<Uint8Array> {
      const sealed = await readFile(fileOf(path)).catch((e) => { throw e?.code === "ENOENT" ? new Error("That file is not in the vault.") : e; });
      if (sealed.length < HEAD || !sealed.subarray(0, 4).equals(MAGIC)) throw new VaultTampered("A stored file failed its check.");
      const version = sealed[4], key = keys.get(version);
      if (!key) throw new Error(`The vault needs key version ${version} to read this file, and it is not in VAULT_KEYS.`);
      const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(5, 17));
      d.setAAD(aad(path)); d.setAuthTag(sealed.subarray(17, HEAD));
      try { return new Uint8Array(Buffer.concat([d.update(sealed.subarray(HEAD)), d.final()])); } catch { throw new VaultTampered("A stored file failed its check."); }
    },
    async remove(paths: string[]) { await Promise.all(paths.map((p) => rm(fileOf(p), { force: true }))); },
  };
}
