// Our own file vault (docs/database/19_VAULT_V1.md): every original encrypted and bound to its path, written whole or not at all, under a name that says nothing,
// in its organisation's folder; old keys keep reading after a new one takes over; a path cannot climb out; no key, no vault. Everything invented.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fileVault, keysFrom, objectName, VaultTampered } from "../src/fileVault";

const ORG = "6f1c2a9e-0b4d-4c7e-9a51-3d2e8f7b6a10", OTHER = "0d9e8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b", DOC = "c3b2a190-8f7e-4d6c-b5a4-938271605f4e";
const key = () => randomBytes(32).toString("base64"), dir = () => mkdtempSync(join(tmpdir(), "vault-"));
const CV = new TextEncoder().encode("Thandi Mokoena\nthandi@mail.example\nFinancial Accountant, Northwind Traders");

test("an original goes in encrypted, comes back exactly, and its file shows no name and none of its words", async () => {
  const root = dir(), v = fileVault(root, keysFrom(`1:${key()}`));
  await v.put(`${ORG}/${DOC}`, CV);
  expect(Buffer.from(await v.get(`${ORG}/${DOC}`)).equals(Buffer.from(CV))).toBe(true);
  const files = readdirSync(join(root, ORG));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[0-9a-f]{64}\.bin$/);
  expect(files[0]).not.toContain(DOC);
  const onDisk = readFileSync(join(root, ORG, files[0]));
  expect(onDisk.subarray(0, 4).toString()).toBe("RMV1");
  expect(onDisk.includes(Buffer.from("Thandi"))).toBe(false);
});

test("a file is bound to its path: moved to another document or another organisation, it is refused, not served", async () => {
  const root = dir(), v = fileVault(root, keysFrom(`1:${key()}`)), other = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", at = (p: string) => join(root, p.split("/")[0], objectName(p));
  await v.put(`${ORG}/${DOC}`, CV);
  await v.put(`${ORG}/${other}`, new Uint8Array([1]));
  writeFileSync(at(`${ORG}/${other}`), readFileSync(at(`${ORG}/${DOC}`)));   // someone copies one document's file over another's
  await expect(v.get(`${ORG}/${other}`)).rejects.toBeInstanceOf(VaultTampered);
  await v.put(`${OTHER}/${DOC}`, new Uint8Array([2]));
  writeFileSync(at(`${OTHER}/${DOC}`), readFileSync(at(`${ORG}/${DOC}`)));   // the same document id, in another tenant's folder
  await expect(v.get(`${OTHER}/${DOC}`)).rejects.toBeInstanceOf(VaultTampered);
  expect(Buffer.from(await v.get(`${ORG}/${DOC}`)).equals(Buffer.from(CV))).toBe(true);   // the original is untouched
});

test("a flipped byte or the wrong key is refused", async () => {
  const root = dir(), v = fileVault(root, keysFrom(`1:${key()}`));
  await v.put(`${ORG}/${DOC}`, CV);
  const f = join(root, ORG, readdirSync(join(root, ORG))[0]), bytes = readFileSync(f);
  bytes[bytes.length - 1] ^= 1; writeFileSync(f, bytes);
  await expect(v.get(`${ORG}/${DOC}`)).rejects.toBeInstanceOf(VaultTampered);
  await v.put(`${ORG}/${DOC}`, CV);
  await expect(fileVault(root, keysFrom(`1:${key()}`)).get(`${ORG}/${DOC}`)).rejects.toBeInstanceOf(VaultTampered);
});

test("a new key takes over for new files while files under the old key still read", async () => {
  const root = dir(), k1 = key(), k2 = key();
  await fileVault(root, keysFrom(`1:${k1}`)).put(`${ORG}/${DOC}`, CV);
  const v = fileVault(root, keysFrom(`1:${k1},2:${k2}`));
  expect(Buffer.from(await v.get(`${ORG}/${DOC}`)).equals(Buffer.from(CV))).toBe(true);
  const other = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  await v.put(`${ORG}/${other}`, CV);
  const versions = readdirSync(join(root, ORG)).map((f) => readFileSync(join(root, ORG, f))[4]).sort();
  expect(versions).toEqual([1, 2]);
  await expect(fileVault(root, keysFrom(`2:${k2}`)).get(`${ORG}/${DOC}`)).rejects.toThrow(/key version 1/);   // a retired key cannot be dropped while files still need it
});

test("a path must be an organisation and a document, and cannot climb out", async () => {
  const v = fileVault(dir(), keysFrom(`1:${key()}`));
  for (const bad of ["../etc/passwd", `${ORG}/../x`, `/${ORG}/${DOC}`, `${ORG}//${DOC}`, `${ORG}/${DOC}/more`, `${ORG}`, `${ORG}/doc name`, ""])
    await expect(v.put(bad, CV), bad).rejects.toThrow(/not a vault path/);
  await expect(v.get(`${ORG}/..`)).rejects.toThrow(/not a vault path/);
});

test("a write is whole or not there: no temporary file is left, and an overwrite replaces in one step", async () => {
  const root = dir(), v = fileVault(root, keysFrom(`1:${key()}`));
  await v.put(`${ORG}/${DOC}`, CV);
  await v.put(`${ORG}/${DOC}`, new Uint8Array([9, 9]));
  expect(readdirSync(join(root, ORG))).toHaveLength(1);
  expect([...(await v.get(`${ORG}/${DOC}`))]).toEqual([9, 9]);
  await Promise.all(Array.from({ length: 20 }, (_, i) => v.put(`${ORG}/${DOC}`, new Uint8Array([i]))));
  expect(readdirSync(join(root, ORG))).toHaveLength(1);   // twenty overlapping writes leave one whole file and no temporaries
  expect((await v.get(`${ORG}/${DOC}`)).length).toBe(1);
});

test("removed files are gone; a missing file is said to be missing, not tampered", async () => {
  const root = dir(), v = fileVault(root, keysFrom(`1:${key()}`));
  await v.put(`${ORG}/${DOC}`, CV);
  await v.remove([`${ORG}/${DOC}`, `${ORG}/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`]);
  const e = await v.get(`${ORG}/${DOC}`).catch((x) => x);
  expect(e).not.toBeInstanceOf(VaultTampered);
  expect(String(e.message)).toMatch(/not in the vault/);
});

test("no key, no vault: it refuses to start rather than write plain files", () => {
  expect(() => fileVault(dir(), keysFrom(""))).toThrow(/VAULT_KEYS/);
  expect(() => keysFrom("1:short")).toThrow(/32 bytes/);
  expect(() => keysFrom(`0:${key()}`)).toThrow(/1 to 255/);
  expect(() => keysFrom(`1:${key()},1:${key()}`)).toThrow(/twice/);
});

test("the rehearsal copy counts what it copied, checked back, found changed since upload, and could not find, and prints nothing of any file", async () => {
  const { copyIntoVault } = await import("../src/scripts/copyIntoVault"), { createHash } = await import("node:crypto");
  const v = fileVault(dir(), keysFrom(`1:${key()}`)), sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const files: Record<string, Uint8Array> = { [`${ORG}/${DOC}`]: CV, [`${ORG}/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`]: new Uint8Array([1, 2]), [`${OTHER}/${DOC}`]: new Uint8Array([3]) };
  const docs = [
    { path: `${ORG}/${DOC}`, sha256: sha(CV) },
    { path: `${ORG}/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`, sha256: "0".repeat(64) },   // replaced by its smaller form after upload
    { path: `${OTHER}/${DOC}`, sha256: sha(new Uint8Array([3])) },
    { path: `${OTHER}/f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f`, sha256: "1".repeat(64) },   // gone from the bucket
  ];
  const n = await copyIntoVault(docs, async (p) => { if (!files[p]) throw new Error("404"); return files[p]; }, v);
  expect(n).toEqual({ listed: 4, copied: 3, verified: 3, differsFromRecord: 1, missingAtSource: 1, failed: 0 });
  expect(Buffer.from(await v.get(`${ORG}/${DOC}`)).equals(Buffer.from(CV))).toBe(true);
  expect(JSON.stringify(n)).not.toContain(ORG);
});
