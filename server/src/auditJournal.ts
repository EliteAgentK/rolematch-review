// Audit entries that could not be written because the main database was unreachable (docs/architecture/RESILIENCE.md, step 5). Some actions are
// only allowed with an audit record written first, viewing an original CV for one. During an outage the record is written here, durably (on disk
// before the action goes ahead) and encrypted, and moved into audit_events with its original time when the database is back. The entry's id becomes
// the audit row's id, so moving it twice can never create two rows.
import { join } from "node:path";
import { keyFromEnv, Vault } from "./localVault";

export interface JournalEntry { id: string; orgId: string; actorId: string | null; action: string; entityType: string; entityId: string | null; detail: Record<string, unknown>; correlationId: string | null; createdAt: string }

export class AuditJournal {
  private vault: Vault;
  constructor(dir: string, key: Buffer | null) { this.vault = new Vault(dir, key); }
  static fromEnv(dataDir: string) { return new AuditJournal(join(dataDir, "audit-journal"), keyFromEnv()); }
  get enabled() { return this.vault.enabled; }
  /** Writes the entry to disk before returning; throws if it cannot, so the caller refuses the action rather than act unrecorded. */
  append(e: Omit<JournalEntry, "id" | "createdAt">): JournalEntry {
    if (!this.enabled) throw new Error("the audit journal is not configured");
    const entry: JournalEntry = { ...e, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.vault.put(`${entry.id}.json`, Buffer.from(JSON.stringify(entry)), true);
    return entry;
  }
  all(): JournalEntry[] {
    if (!this.enabled) return [];
    const out: JournalEntry[] = [];
    for (const f of this.vault.names(".json")) { try { out.push(JSON.parse(this.vault.get(f).toString("utf8"))); } catch { /* tampered: left for a person */ } }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  done(id: string) { this.vault.remove(`${id}.json`); }
}
