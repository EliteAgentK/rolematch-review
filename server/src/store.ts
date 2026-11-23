import { placeOf } from "./places";
import { createHash } from "node:crypto";
import { experienceOf } from "./dates";
import { audit, sql } from "./db";
import { ALWAYS_EDITABLE, CONFIGURABLE, editableFields, NEVER_EDITABLE, PolicyError } from "./editPolicy";
const CONFIGURABLE_FOR = (k: Kind) => CONFIGURABLE[k], NEVER_FOR = (k: Kind) => NEVER_EDITABLE[k], ALWAYS_FOR = (k: Kind) => ALWAYS_EDITABLE[k];
import { getSettings } from "./settings";
import { sameJson } from "./sameJson";

type Kind = "candidate" | "job";
const T = { candidate: "candidates", job: "jobs" } as const;

/**
 * Why a field read from the document was changed. Required for every such change, so a correction of the reader can be told apart from new
 * information, a preference or a disagreement (docs/learning/TRAINING_AND_IMPROVEMENT_PLAN.md, section 3). Only a correction is a reading error,
 * and only a correction goes into the error register. The recruiter's own work (notes, workflow status) needs no reason.
 */
export const CHANGE_KINDS = ["extraction_correction", "candidate_update", "recruiter_preference", "disputed_interpretation"] as const;
type ChangeKind = (typeof CHANGE_KINDS)[number];
const isChangeKind = (x: unknown): x is ChangeKind => typeof x === "string" && (CHANGE_KINDS as readonly string[]).includes(x);
export class ReasonRequiredError extends Error {
  constructor(public fields: string[]) { super(`Say why ${fields.length === 1 ? "this field was" : "these fields were"} changed: a correction of what was read, an update from the candidate, a preference, or a disagreement.`); }
}

/** `uploadedAt`: when the document was uploaded (kept on the record when it was added, pipeline.ts); for a record added before that was kept, when the
 *  record itself was added, moments later. Shown on every card and panel as "Uploaded 10 Nov", the exact time on hover (owner, 10 Nov 2026). */
/** `city` and, for a person, `location`: where they are as places.ts groups it. A person's location leaves the server as their town only, never a street
 *  or a number, whatever the record holds (owner, 11 Nov 2026: "people's full home addresses, really?"); a job keeps its own wording ("Sandton (hybrid)") as its stated fact, and also carries `town`, which its card shows (owner, 11 Nov 2026: a job card read
 *  "Johannesburg, Gauteng"). */
function hydrate<T extends { id: string }>(kind: Kind, row: any): T {
  const at = row.data?.uploadedAt ?? row.created_at, place = placeOf(row.data?.location), person = kind === "candidate";
  return { ...row.data, id: row.id, version: row.version, documentId: row.document_id, ...(at ? { uploadedAt: new Date(at).toISOString() } : {}), city: place.city, ...(person ? { location: place.town } : { town: place.town }) };
}


export async function getRecord<T extends { id: string }>(kind: Kind, orgId: string, id: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  const rows = await sql.unsafe(`select id, document_id, data, version, created_at from ${T[kind]} where org_id = $1 and id = $2`, [orgId, id]);
  return rows[0] ? hydrate<T>(kind, rows[0]) : null;
}
/** Several records of one kind in one trip (a job's shortlist): only those of this organisation, in no particular order. */
export async function getRecords<T extends { id: string }>(kind: Kind, orgId: string, ids: string[]): Promise<T[]> {
  const valid = ids.filter(isUuid);
  if (!valid.length) return [];
  const rows = await sql.unsafe(`select id, document_id, data, version, created_at from ${T[kind]} where org_id = $1 and id = any($2::uuid[])`, [orgId, valid]);
  return rows.map((r: any) => hydrate<T>(kind, r));
}
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class ConflictError extends Error {}

/** Apply a recruiter edit. The original extraction is never overwritten; every changed field is audited. */
export async function updateRecord<T extends { id: string; version?: number }>(
  kind: Kind, orgId: string, actorId: string, id: string, patch: Record<string, unknown>, expectedVersion: number | undefined, correlationId?: string, changeKind?: unknown,
): Promise<T | null> {
  if (!isUuid(id)) return null;
  const allowed = editableFields(kind, (await getSettings(orgId)).settings.editing);   // what this organisation lets a person change
  return sql.begin(async (q) => {
    // Lock the row so two simultaneous edits cannot both pass the version check.
    const rows = await q.unsafe(`select id, document_id, data, version, created_at from ${T[kind]} where org_id = $1 and id = $2 for update`, [orgId, id]);
    const row = rows[0];
    if (!row) return null;
    if (expectedVersion !== undefined && expectedVersion !== row.version) throw new ConflictError("This record was changed by someone else. Reload it and try again.");
    const current = row.data;
    const next = { ...current };
    const changes: Record<string, unknown> = {};
    // A field that is locked is refused, loudly, when the edit would change it. A client may send the whole record back, so a locked field that is
    // unchanged is simply ignored. Fields the platform does not know about are ignored as before.
    const known = new Set([...Object.keys(CONFIGURABLE_FOR(kind)), ...NEVER_FOR(kind), ...ALWAYS_FOR(kind)]);
    // A person's location leaves the server as their town only (hydrate below), and a client may send the whole record back: the town it was shown is
    // the stored place unchanged, not a new one. Without this a note was refused with "Say why this field was changed" (found 18 Nov 2026).
    const asShown = (k: string) => kind === "candidate" && k === "location" && typeof current.location === "string" && patch[k] === placeOf(current.location).town;
    const unchanged = (k: string) => sameJson(patch[k], current[k]) || asShown(k);
    const refused = Object.keys(patch).filter((k) => known.has(k) && !allowed.includes(k) && !unchanged(k));
    if (refused.length) throw new PolicyError(refused, kind);
    for (const key of allowed) {
      if (!(key in patch)) continue;
      if (unchanged(key)) continue;
      // Notes are confidential: audit that they changed, not what they said.
      changes[key] = key === "recruiterNotes" ? { changed: true } : { from: current[key], to: patch[key] };
      next[key] = patch[key];
    }
    if (!Object.keys(changes).length) return hydrate<T>(kind, row);
    // A candidate's years are the platform's, never typed: where the organisation lets a recruiter edit the work history, the years are worked out again
    // from the roles as edited, and audited beside them (code review, 16 Nov 2026, C-M3).
    if (kind === "candidate" && "workHistory" in changes) {
      const experience = experienceOf(next.workHistory ?? []);
      if (experience !== (current.experience ?? "")) { changes.experience = { from: current.experience ?? "", to: experience, workedOut: true }; next.experience = experience; }
    }
    // A field read from the document changed: the reason is required, recorded with the change, and a correction is written to the error register.
    const fromDocument = Object.keys(changes).filter((k) => k in CONFIGURABLE_FOR(kind));
    if (fromDocument.length && !isChangeKind(changeKind)) throw new ReasonRequiredError(fromDocument);
    // Which of a candidate's fields a person has corrected from what the CV says: matching gives the AI those as corrected, beside the CV (aiMatch.ts
    // passagesOf), so a correction is assessed rather than lost under the CV's own lines (independent audit, 20 Nov 2026).
    if (kind === "candidate" && fromDocument.length) next.correctedFields = [...new Set([...(Array.isArray(current.correctedFields) ? current.correctedFields : []), ...fromDocument])].sort();
    const updated = await q.unsafe(`update ${T[kind]} set data = $1, version = version + 1, updated_at = now() where id = $2 returning id, document_id, data, version, created_at`, [q.json(next as any) as any, id]);
    await audit(q, orgId, actorId, `${kind}.edited`, kind, id, fromDocument.length ? { changes, changeKind } : { changes }, correlationId);
    if (fromDocument.length && changeKind === "extraction_correction") {
      const parserVersion = (current.extraction as { parserVersion?: string } | undefined)?.parserVersion ?? null;
      for (const field of fromDocument) {
        const c = changes[field] as { from: unknown; to: unknown };
        // The same correction again, by a retry or on the same document, is one lesson: how often a fault appears must not be inflated.
        await q`insert into error_register (org_id, record_kind, record_id, document_id, field_path, from_value, to_value, change_kind, parser_version, created_by, component, component_version, dedupe_key)
                values (${orgId}, ${kind}, ${id}, ${row.document_id}, ${field}, ${q.json((c.from ?? null) as any)}, ${q.json((c.to ?? null) as any)}, 'extraction_correction', ${parserVersion}, ${actorId}, 'reader', ${parserVersion}, ${createHash("sha256").update(JSON.stringify([row.document_id ?? id, field, c.to ?? null])).digest("hex").slice(0, 32)})
                on conflict (org_id, dedupe_key) where dedupe_key is not null do nothing`;
      }
    }
    return hydrate<T>(kind, updated[0]);
  }) as Promise<T | null>;
}

/** A person confirms they have looked at a flagged record. The flag is only ever cleared by this explicit action, and it is audited. */
export async function markReviewed<T extends { id: string; version?: number }>(kind: Kind, orgId: string, actorId: string, id: string, expectedVersion: number | undefined, correlationId?: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  return sql.begin(async (q) => {
    const rows = await q.unsafe(`select id, document_id, data, version, created_at from ${T[kind]} where org_id = $1 and id = $2 for update`, [orgId, id]);
    const row = rows[0];
    if (!row) return null;
    if (expectedVersion !== undefined && expectedVersion !== row.version) throw new ConflictError("This record was changed by someone else. Reload it and try again.");
    if (row.data.reviewState === "reviewed") return hydrate<T>(kind, row); // already confirmed: nothing to do
    const before = row.data.reviewState ?? "none";
    const next = { ...row.data, reviewState: "reviewed", review: { ...(row.data.review ?? { reasons: [], notes: [], rulesVersion: "" }), state: "reviewed", reviewedBy: actorId, reviewedAt: new Date().toISOString() } };
    const updated = await q.unsafe(`update ${T[kind]} set data = $1, version = version + 1, updated_at = now() where id = $2 returning id, document_id, data, version, created_at`, [q.json(next as any) as any, id]);
    await audit(q, orgId, actorId, `${kind}.review_confirmed`, kind, id, { from: before, reasons: row.data.review?.reasons ?? [] }, correlationId);
    return hydrate<T>(kind, updated[0]);
  }) as Promise<T | null>;
}

// ---------------------------------------------------------------- paginated, searchable lists
export interface Page<T> { items: T[]; nextCursor: string | null; total: number }
export interface ListOptions { limit?: number; cursor?: string; q?: string; status?: string; /** any of these statuses (a hiring manager's list) */ statusIn?: readonly string[]; review?: string }

const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify([ts, id])).toString("base64url");
function decodeCursor(c?: string): [string, string] | null {
  if (!c) return null;
  try { const [ts, id] = JSON.parse(Buffer.from(c, "base64url").toString()); return typeof ts === "string" && isUuid(id) && !Number.isNaN(Date.parse(ts)) ? [ts, id] : null; } catch { return null; }
}

/** One page of records, newest first. Search words must ALL appear (any order); filters are exact. */
export async function searchRecords<T extends { id: string }>(kind: Kind, orgId: string, o: ListOptions = {}): Promise<Page<T>> {
  const asked = Number.isFinite(o.limit) ? Math.floor(o.limit as number) : 25;
  const limit = Math.min(100, Math.max(1, asked));
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  const add = (clause: string, value: unknown) => { params.push(value); where += ` and ${clause.replace("?", `$${params.length}`)}`; };
  for (const word of (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) add("search like ? escape '\\'", `%${word.replace(/[\\%_]/g, "\\$&")}%`);
  if (o.status) add("data->>'status' = ?", o.status);
  if (o.statusIn) add("data->>'status' = any(?::text[])", [...o.statusIn]);
  if (o.review) add("data->>'reviewState' = ?", o.review);
  const [{ total }] = await sql.unsafe(`select count(*)::int as total from ${T[kind]} where ${where}`, params as any[]);

  const cur = decodeCursor(o.cursor);
  const pageParams = [...params];
  let pageWhere = where;
  if (cur) { pageParams.push(cur[0], cur[1]); pageWhere += ` and (created_at, id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length}::uuid)`; }
  pageParams.push(limit + 1);
  const rows = await sql.unsafe(`select id, document_id, data, version, created_at, created_at::text as ts from ${T[kind]} where ${pageWhere} order by created_at desc, id desc limit $${pageParams.length}`, pageParams as any[]);
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { items: page.map((r: any) => hydrate<T>(kind, r)), nextCursor: more ? encodeCursor(page[page.length - 1].ts, page[page.length - 1].id) : null, total };
}
