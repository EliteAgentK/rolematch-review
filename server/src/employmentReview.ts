// The uncertain parts of an employment history, brought to a person with the document's own lines beside them, and what happens when they answer. A review changes the record, keeps what was there before, says who did it, and makes any earlier match on the record out of date until it has been run again. It reaches only roles the reading itself marked unsure: a role the reading is sure of stays under the organisation's edit policy.
import { experienceOf } from "./dates";
import { audit, sql } from "./db";
import { readerInput } from "./modelReader";
import { ConflictError, getRecord, isUuid } from "./store";
import type { Candidate, WorkItem } from "./types";

export class ReviewError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const NEAR = 3;
/** Each role with the document's lines it stands on and the pages they are on. */
export async function employmentEvidence(orgId: string, candidateId: string) {
  const c = await getRecord<Candidate>("candidate", orgId, candidateId);
  if (!c) return null;
  const text = c.documentId ? String((await sql`select source_text from documents where id = ${c.documentId} and org_id = ${orgId}`)[0]?.source_text ?? "") : "", { byNumber } = readerInput(text);
  const linesOf = (ns: number[]) => { const near = new Set<number>(); for (const n of ns) for (let k = n - NEAR; k <= n + NEAR; k++) if (byNumber.has(k)) near.add(k); return [...near].sort((a, b) => a - b).map((n) => ({ n, text: byNumber.get(n)!, cited: ns.includes(n) })); };
  return { version: c.version, employment: c.reading?.employment ?? null, originalDocumentUrl: c.documentId ? `/api/documents/${c.documentId}/original` : null, unconfirmedRoles: c.reading?.unconfirmedRoles ?? [],
    roles: (c.workHistory ?? []).map((r, index) => ({ index, position: r.position, company: r.company, startDate: r.startDate, endDate: r.endDate, status: r.status ?? null, agreement: r.agreement ?? null, rulesReading: r.rulesReading ?? null, pages: r.pages ?? [], lines: linesOf(r.lines ?? []) })) };
}
const clean = (v: unknown) => String(v ?? "").trim().slice(0, 160);

/** One recruiter's answer about one role, or about the history as a whole. */
export async function reviewEmployment(orgId: string, actorId: string, candidateId: string, body: any, correlationId: string): Promise<Candidate> {
  if (!isUuid(candidateId)) throw new ReviewError(404, "RES-001", "Not found.");
  const action = String(body?.action ?? ""); if (!["confirm", "correct", "remove", "resolve"].includes(action)) throw new ReviewError(400, "VAL-001", "That is not an action on an employment history.");
  return sql.begin(async (q) => {
    const row = (await q`select id, document_id, data, version from candidates where org_id = ${orgId} and id = ${candidateId} for update`)[0];
    if (!row) throw new ReviewError(404, "RES-001", "Not found.");
    if (typeof body.version === "number" && body.version !== row.version) throw new ConflictError("This record was changed by someone else. Reload it and try again.");
    const data = row.data as Candidate, roles: WorkItem[] = [...(data.workHistory ?? [])], reading = data.reading, by = { actorId, at: new Date().toISOString() };
    if (!reading) throw new ReviewError(409, "CONF-001", "This record's reading has nothing to review.");
    let detail: Record<string, unknown>;
    if (action === "resolve") {
      detail = { action, before: reading.employment };
      data.reading = { ...reading, employment: { state: "supported", reasons: [], resolved: { ...by, reasons: reading.employment.reasons } } as any };
    } else {
      const index = Number(body.index), role = roles[index];
      if (!Number.isInteger(index) || !role) throw new ReviewError(404, "RES-001", "That role is not on this record.");
      if (role.status === "supported" || role.status === undefined) throw new ReviewError(403, "PERM-002", "This role is not in question: it stays under your organisation's edit policy.");
      if (action === "remove") { roles.splice(index, 1); detail = { action, index, before: role }; }
      else if (action === "confirm") { roles[index] = { ...role, status: "supported", reviewed: by } as WorkItem; detail = { action, index, role: { position: role.position, company: role.company } }; }
      else {
        const to = { position: clean(body.values?.position), company: clean(body.values?.company), startDate: clean(body.values?.startDate), endDate: clean(body.values?.endDate) };
        if (!to.position && !to.company) throw new ReviewError(400, "VAL-001", "A role needs a title or an employer.");
        roles[index] = { ...role, ...to, status: "supported", reviewed: by, asRead: { position: role.position, company: role.company, startDate: role.startDate, endDate: role.endDate } } as WorkItem;
        detail = { action, index, from: { position: role.position, company: role.company, startDate: role.startDate, endDate: role.endDate }, to };
      }
    }
    // The years are the platform's, worked out from the roles the record now holds (code review, 16 Nov 2026, C-M3): a role removed or its dates corrected
    // changes them, and the audit says from what to what.
    const experience = experienceOf(roles);
    if (experience !== (data.experience ?? "")) detail = { ...detail, experience: { from: data.experience ?? "", to: experience } };
    const next = { ...data, workHistory: roles, experience };
    const updated = (await q`update candidates set data = ${q.json(next as any)}, version = version + 1, updated_at = now() where id = ${candidateId} and org_id = ${orgId} returning id, document_id, data, version`)[0];
    await audit(q, orgId, actorId, "candidate.employment_reviewed", "candidate", candidateId, detail, correlationId);
    return { ...updated.data, id: updated.id, documentId: updated.document_id, version: updated.version } as Candidate;
  }) as Promise<Candidate>;
}
