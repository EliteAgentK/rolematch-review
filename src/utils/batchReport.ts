import type { BatchReport } from "../api/client";

export const LABEL: Record<string, string> = { added: "Added", added_needs_review: "Added, needs review", failed: "Could not be added", blocked_needs_review: "Held for review (not read)", duplicate: "Already in your organisation", unsupported_or_refused: "Refused at upload", left_out_before_sending: "Left out before sending", cancelled: "Cancelled" };
export const ORDER = ["added", "added_needs_review", "blocked_needs_review", "failed", "duplicate", "unsupported_or_refused", "left_out_before_sending", "cancelled"];

export const duration = (sec: number) => (sec < 90 ? `${sec} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

/** The report as a spreadsheet-ready CSV. Cells that start with = + - @ are prefixed so a file name cannot run as a formula when opened. */
export function reportCsv(r: BatchReport): string {
  const cell = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = [["File", "Outcome", "Record saved", "Problem", "Next action", "Uploaded by", "Admitted", "Finished", "Retries", "Reference"], ...r.files.map((f) => [f.fileName, LABEL[f.outcome] ?? f.outcome, f.recordSaved ? "yes" : "no", f.problem, f.nextAction, f.uploadedBy, f.admittedAt, f.finishedAt, f.retries, f.reference])];
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}


/** A server time in the viewer's own time zone (the device's, unless one is given), with the zone named: "29 October 2026, 09:15 SAST" in Johannesburg,
 *  "29 October 2026, 07:15 GMT" in London. RoleMatch may be used from anywhere, so no zone is assumed (owner, 12 Nov 2026). */
export function localStamp(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-ZA", { timeZone, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")} ${g("month")} ${g("year")}, ${g("hour")}:${g("minute")} ${g("timeZoneName")}`;
}
/** "CV batch submitted by a@b.co.za · 29 October 2026, 09:15 SAST · 100 files" */
export function batchSubmittedLine(b: { kind: "cv" | "jd"; submittedByEmail: string; createdAt: string; counts: { declared: number } }, timeZone?: string): string {
  return `${b.kind === "cv" ? "CV" : "Job description"} batch submitted by ${b.submittedByEmail || "an unknown account"} · ${localStamp(b.createdAt, timeZone)} · ${b.counts.declared} file${b.counts.declared === 1 ? "" : "s"}`;
}
/** "CV batch completed · Submitted by a@b · 09:23 SAST · 94 ready, 4 need review, 2 failed" (only the parts that apply). */
export function batchCompletedLine(b: { kind: "cv" | "jd"; submittedByEmail: string; finishedAt: string | null; counts: { completed: number; needsReview: number; failed: number; blocked: number; cancelled: number; duplicates: number; refused: number } }, timeZone?: string): string {
  const c = b.counts, parts = [[c.completed, "ready"], [c.needsReview, "need review"], [c.blocked, "blocked for review"], [c.failed, "failed"], [c.refused, "refused"], [c.duplicates, "already in"], [c.cancelled, "cancelled"]].filter(([n]) => (n as number) > 0).map(([n, l]) => `${n} ${l}`);
  const time = b.finishedAt ? (localStamp(b.finishedAt, timeZone).split(", ").pop() ?? "") : "";
  return `${b.kind === "cv" ? "CV" : "Job description"} batch completed · Submitted by ${b.submittedByEmail || "an unknown account"}${time ? ` · ${time}` : ""} · ${parts.join(", ") || "nothing added"}`;
}
