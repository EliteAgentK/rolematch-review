// RoleMatch's own copy of original CVs and job descriptions (docs/architecture/RESILIENCE.md, step 5), so "View Original CV" still works when
// Supabase's storage or database is unreachable. Filled and pruned by each copy refresh (scripts/refreshCopy.ts): a document deleted in RoleMatch
// leaves this copy at the next refresh, and at once when the deletion job runs on this server. Encrypted at rest (src/localVault.ts), and named by a
// hash of the storage path so the file names reveal no organisation or document.
import { join } from "node:path";
import { keyFromEnv, nameFor, Vault } from "./localVault";

export class OriginalsCopy {
  private vault: Vault;
  constructor(dir: string, key: Buffer | null) { this.vault = new Vault(dir, key); }
  static fromEnv(dataDir: string) { return new OriginalsCopy(join(dataDir, "originals-copy"), keyFromEnv()); }
  get enabled() { return this.vault.enabled; }
  has(storagePath: string) { return this.vault.names(".bin").includes(nameFor(storagePath)); }
  read(storagePath: string): Buffer | null { if (!this.enabled) return null; try { return this.vault.get(nameFor(storagePath)); } catch { return null; } }
  write(storagePath: string, bytes: Uint8Array) { this.vault.put(nameFor(storagePath), Buffer.from(bytes)); }
  remove(storagePath: string) { this.vault.remove(nameFor(storagePath)); }
  /** How many copied files have no document any more. */
  orphans(keep: Iterable<string>): number { const wanted = new Set([...keep].map(nameFor)); return this.vault.names(".bin").filter((f) => !wanted.has(f)).length; }
  /** Removes every copied file whose document no longer exists. Returns how many were removed. */
  prune(keep: Iterable<string>): number {
    const wanted = new Set([...keep].map(nameFor));
    let removed = 0;
    for (const f of this.vault.names(".bin")) if (!wanted.has(f)) { this.vault.remove(f); removed++; }
    return removed;
  }
  /** The storage paths in `paths` that are not copied yet. */
  missing(paths: string[]): string[] { const have = new Set(this.vault.names(".bin")); return paths.filter((p) => !have.has(nameFor(p))); }
}

/** The copy exists for when the database is lost or damaged, and that is exactly when the database lists few or no documents. A deletion arrives one at a time and removes its own copy (src/deletion.ts), so
 * many orphans at once means something is wrong with the database, not that people deleted things: keep the copies and say so. */
export const pruneLooksSafe = (orphans: number, total: number) => orphans === 0 || (orphans < total && (orphans <= 5 || orphans / total <= 0.1));
