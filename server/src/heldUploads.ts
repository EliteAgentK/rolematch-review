// Uploads accepted while saving is paused (the main database unreachable; docs/architecture/RESILIENCE.md, step 4). The file and its details are
// held on this server, encrypted (src/localVault.ts), and replayed through the normal upload path when the main database is back, keeping the same
// document id so the recruiter's "waiting" card simply carries on. Without LOCAL_ENCRYPTION_KEY nothing is held and uploads during an outage are
// refused, as before.
import { statSync } from "node:fs";
import { join } from "node:path";
import { keyFromEnv, Vault } from "./localVault";

export interface HeldMeta { id: string; orgId: string; portalId?: string; userId: string; kind: "cv" | "jd"; fileName: string; type: string; size: number; sha256: string; heldAt: string; requestId: string }
export interface HeldLimits { perOrg: number; totalBytes: number }
const DEFAULT_LIMITS: HeldLimits = { perOrg: 50, totalBytes: 500 * 1024 * 1024 };

export class HeldUploads {
  private vault: Vault;
  constructor(dir: string, key: Buffer | null, private limits: HeldLimits = DEFAULT_LIMITS) { this.vault = new Vault(dir, key); }
  static fromEnv(dataDir: string) { return new HeldUploads(join(dataDir, "held"), keyFromEnv()); }
  get enabled() { return this.vault.enabled; }

  /** Every held upload's details (oldest first), across organisations; unreadable entries are skipped, never guessed. */
  all(): HeldMeta[] {
    if (!this.enabled) return [];
    const out: HeldMeta[] = [];
    for (const f of this.vault.names(".meta")) { try { out.push(JSON.parse(this.vault.get(f).toString("utf8"))); } catch { /* tampered or another key: left for a person */ } }
    return out.sort((a, b) => a.heldAt.localeCompare(b.heldAt));
  }
  list(orgId: string) { return this.all().filter((m) => m.orgId === orgId); }
  get(orgId: string, id: string) { return this.list(orgId).find((m) => m.id === id); }
  bytes(id: string): Buffer { return this.vault.get(`${id}.bin`); }

  /** Holds one upload. The same file held twice for the same organisation is the same held upload. Refuses when the holding area is full. */
  hold(meta: Omit<HeldMeta, "heldAt">, file: Uint8Array): { meta: HeldMeta; duplicate: boolean } | { full: string } {
    if (!this.enabled) return { full: "holding is not configured" };
    const mine = this.list(meta.orgId), same = mine.find((m) => m.kind === meta.kind && m.sha256 === meta.sha256);
    if (same) return { meta: same, duplicate: true };
    if (mine.length >= this.limits.perOrg) return { full: `your organisation already has ${mine.length} uploads waiting` };
    let total = 0; for (const f of this.vault.names(".bin")) { try { total += statSync(join(this.vault.dir, f)).size; } catch { /* gone */ } }
    if (total + file.length > this.limits.totalBytes) return { full: "the holding area is full" };
    const full: HeldMeta = { ...meta, heldAt: new Date().toISOString() };
    this.vault.put(`${meta.id}.bin`, Buffer.from(file), true);   // the file first, so a details file never points at nothing
    this.vault.put(`${meta.id}.meta`, Buffer.from(JSON.stringify(full)), true);
    return { meta: full, duplicate: false };
  }
  release(id: string) { this.vault.remove(`${id}.meta`); this.vault.remove(`${id}.bin`); }
}
