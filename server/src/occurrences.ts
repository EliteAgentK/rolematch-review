// Structured, privacy-conscious records of failures, grouped under the suspected defect they belong to (migration 018). This is the first slice of
// platform-wide error handling: it is wired into uploads, batches and document processing so far, and the coverage matrix
// (docs/learning/COVERAGE_MATRIX.md) says honestly what is not yet covered. It extends the error register; it does not replace it:
// a confirmed defect is a person's decision recorded against an entry in docs/learning/ERROR_REGISTER.md, and nothing here is training data.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "./db";
import { parserVersionLabel } from "./version";

export type OccurrenceKind = "expected_validation" | "operational_transient" | "suspected_defect" | "confirmed_defect" | "model_error" | "ambiguous";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

// Codes that mean "the file or the request is not acceptable": an expected outcome with a message the person can act on, not a software fault.
const EXPECTED = new Set(["FILE_TYPE", "IDENTITY_UNRESOLVED", "TITLE_UNRESOLVED", "PHOTO_UNREADABLE", "SCAN_UNREADABLE", "NEEDS_OCR", "PAGES_LIMIT", "PAGE_LIMIT", "PAGES_UNVERIFIED", "FILE_TOO_BIG", "UNREADABLE", "CANCELLED"]);
const EXPECTED_PREFIX = /^(FILE-|VAL-|LOCK-|BATCH-|QUOTA-|RES-|PERM-)/;
export function classify(code: string, o: { attempt?: number; maxAttempts?: number; final?: boolean } = {}): { kind: OccurrenceKind; severity: Severity } {
  if (EXPECTED.has(code) || EXPECTED_PREFIX.test(code)) return { kind: "expected_validation", severity: "info" };
  // Anything else is unexplained. While the queue will try again it is temporary trouble; when it has given up it is a suspected defect, never a confirmed one.
  return o.final ? { kind: "suspected_defect", severity: "medium" } : { kind: "operational_transient", severity: "low" };
}

/** A stable key for "the same suspected defect": the same component, stage and code, whichever file or person hit it. */
export const defectKey = (component: string, stage: string | null | undefined, code: string) =>
  createHash("sha256").update(`${component}|${stage ?? ""}|${code}`).digest("hex").slice(0, 16);

/** Keeps a message useful and safe to store: no addresses, long numbers or tokens, no stack trace, bounded length. */
export function sanitise(text: unknown, max = 200): string {
  return String(text ?? "")
    .split("\n")[0]
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(eyJ[\w-]{10,}|[A-Za-z0-9_-]{32,})\b/g, "[token]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .slice(0, max);
}

let appVersion = "unknown";
try { appVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown"; } catch { /* a version is context, not a requirement */ }
const versionsInForce = () => ({ app: appVersion, parser: parserVersionLabel(), extraction: "rules", node: process.version });

export const recordingFailures = { count: 0, last: null as string | null };
const KEEP = 5000;   // rows kept per organisation; older ones are pruned (the running counts in defect_groups are kept)
export interface Occurrence { orgId: string; correlationId: string; component: string; stage?: string | null; code: string; kind?: OccurrenceKind; severity?: Severity; batchId?: string | null; documentId?: string | null; userId?: string | null; attempt?: number; final?: boolean; message?: unknown }

/** Records one occurrence and counts it under its suspected defect. It never throws: a failure to record must not turn a handled failure into a different failure,
 * and it must not hide it either, so a failure to record is itself written to the error log (without the occurrence's contents). */
export async function recordOccurrence(o: Occurrence): Promise<void> {
  try {
    const { kind, severity } = o.kind ? { kind: o.kind, severity: o.severity ?? "medium" } : classify(o.code, { final: o.final });
    const key = defectKey(o.component, o.stage, o.code);
    await sql`insert into error_occurrences (org_id, correlation_id, component, stage, code, kind, severity, batch_id, document_id, user_id, defect_key, attempt, versions, detail)
              values (${o.orgId}, ${o.correlationId}, ${o.component}, ${o.stage ?? null}, ${o.code}, ${kind}, ${o.severity ?? severity}, ${o.batchId ?? null}, ${o.documentId ?? null}, ${o.userId ?? null}, ${key}, ${o.attempt ?? null}, ${sql.json(versionsInForce() as any)}, ${sql.json({ message: sanitise(o.message) } as any)})`;
    await sql`insert into defect_groups (org_id, defect_key, component, code, kind) values (${o.orgId}, ${key}, ${o.component}, ${o.code}, ${kind})
              on conflict (org_id, portal_id, defect_key) do update set occurrences = defect_groups.occurrences + 1, last_seen = now(),
                status = case when defect_groups.status in ('resolved') then 'suspected' else defect_groups.status end`;   // a resolved defect that recurs is reopened
    if (Math.random() < 0.02) await sql`delete from error_occurrences where org_id = ${o.orgId} and id in (select id from error_occurrences where org_id = ${o.orgId} order by occurred_at desc offset ${KEEP})`;
  } catch (e: any) {
    recordingFailures.count++; recordingFailures.last = new Date().toISOString();   // a failure to record is itself counted, so a broken recorder is visible (health details), not silent
    console.error(JSON.stringify({ level: "error", event: "occurrence.record_failed", component: o.component, code: o.code, correlationId: o.correlationId, reason: sanitise(e?.message, 120) }));
  }
}

/** For an administrator: groups with counts, newest activity first, and each group's latest occurrences. */
export async function defectOverview(orgId: string) {
  const groups = await sql`select defect_key, component, code, kind, status, register_ref, occurrences, first_seen, last_seen from defect_groups where org_id = ${orgId} order by last_seen desc limit 100`;
  const recent = await sql`select id, correlation_id, component, stage, code, kind, severity, batch_id, document_id, defect_key, attempt, versions, detail, occurred_at from error_occurrences where org_id = ${orgId} order by occurred_at desc limit 100`;
  return { groups, recent };
}

export async function setDefectStatus(orgId: string, userId: string, key: string, status: string, registerRef: unknown) {
  if (!["suspected", "confirmed", "resolved", "accepted_limitation"].includes(status)) throw Object.assign(new Error("Unknown status."), { code: "VAL-001" });
  // Confirming a defect is a person's decision and must point at the register entry that holds the reproducible case and the regression test.
  if (status === "confirmed" && !/^R\d{1,4}$/.test(String(registerRef ?? ""))) throw Object.assign(new Error("Confirming a defect needs its error register entry (for example R24)."), { code: "VAL-001" });
  const r = await sql`update defect_groups set status = ${status}, register_ref = coalesce(${registerRef ? String(registerRef) : null}, register_ref), status_changed_by = ${userId}, status_changed_at = now() where org_id = ${orgId} and defect_key = ${key} returning defect_key`;
  return r.length > 0;
}
