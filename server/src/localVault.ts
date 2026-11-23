// Files RoleMatch keeps on its own server for resilience (docs/architecture/RESILIENCE.md): uploads held during an outage, the copy of original CVs,
// and audit entries journaled while the audit log cannot be written. Each file is encrypted with AES-256-GCM under LOCAL_ENCRYPTION_KEY
// (12-byte nonce, 16-byte tag, then the encrypted bytes), written owner-only and atomically. A tampered file fails its tag and is never used.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export function keyFromEnv(): Buffer | null {
  const raw = process.env.LOCAL_ENCRYPTION_KEY ?? "";
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("LOCAL_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return key;
}

export class Vault {
  constructor(readonly dir: string, private key: Buffer | null) { if (key && key.length !== 32) throw new Error("the key must be 32 bytes"); }
  get enabled() { return !!this.key; }

  seal(plain: Buffer): Buffer {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", this.key!, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }
  open(sealed: Buffer): Buffer {
    const d = createDecipheriv("aes-256-gcm", this.key!, sealed.subarray(0, 12));
    d.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
  }
  /** Encrypts and writes `name` atomically; with `durable`, the data is on disk (fsync) before this returns. */
  put(name: string, plain: Buffer, durable = false) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = join(this.dir, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
    const fd = openSync(tmp, "w", 0o600);
    try { writeSync(fd, this.seal(plain)); if (durable) fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, join(this.dir, name));
    if (durable) { const d = openSync(this.dir, "r"); try { fsyncSync(d); } finally { closeSync(d); } }
  }
  get(name: string): Buffer { return this.open(readFileSync(join(this.dir, name))); }
  names(suffix = ""): string[] { try { return readdirSync(this.dir).filter((f) => !f.startsWith(".") && f.endsWith(suffix)); } catch { return []; } }
  remove(name: string) { rmSync(join(this.dir, name), { force: true }); }
}

/** A storage path as a file name that reveals nothing about the organisation or document. */
export const nameFor = (storagePath: string) => createHash("sha256").update(storagePath).digest("hex") + ".bin";
