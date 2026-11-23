// One link contract between the Overview and the Matching Board (docs/architecture/PLAN_OVERVIEW_LINKS.md): every block opens the board in the state it
// describes, `/dashboard?focus=<what>&...`, and the board reads it here and nowhere else. Nothing here asks the AI or costs a credit: a link only sets the
// board's filters, opens records, or shows a match that was already saved.
export type BoardFocus =
  | { kind: "new"; days: number }
  | { kind: "jobs" }
  | { kind: "shortlisted" }
  | { kind: "department"; dept: string }
  | { kind: "match"; candidateId: string; jobId: string }
  | { kind: "record"; candidateId?: string; jobId?: string }
  | { kind: "attention"; rule: string; title: string };

const ID = /^[\w-]{1,64}$/, RULE = /^[a-z-]{1,40}$/;

export function boardLink(f: BoardFocus): string {
  const p = new URLSearchParams({ focus: f.kind });
  if (f.kind === "new") p.set("days", String(f.days));
  if (f.kind === "department") p.set("dept", f.dept);
  if (f.kind === "match" || f.kind === "record") { if (f.candidateId) p.set("c", f.candidateId); if (f.jobId) p.set("j", f.jobId); }
  if (f.kind === "attention") { p.set("rule", f.rule); p.set("title", f.title); }
  return `/dashboard?${p}`;
}

/** What a link asks for, or null when it asks for nothing this board knows: an unknown or malformed link changes nothing. */
export function parseFocus(search: string): BoardFocus | null {
  const p = new URLSearchParams(search), kind = p.get("focus"), c = p.get("c") ?? "", j = p.get("j") ?? "";
  switch (kind) {
    case "new": { const days = Number(p.get("days")); return [7, 30, 90].includes(days) ? { kind, days } : null; }
    case "jobs": case "shortlisted": return { kind };
    case "department": { const dept = (p.get("dept") ?? "").trim(); return dept && dept.length <= 60 ? { kind, dept } : null; }
    case "match": return ID.test(c) && ID.test(j) ? { kind, candidateId: c, jobId: j } : null;
    case "record": return (ID.test(c) || ID.test(j)) ? { kind, ...(ID.test(c) ? { candidateId: c } : {}), ...(ID.test(j) ? { jobId: j } : {}) } : null;
    case "attention": { const rule = p.get("rule") ?? "", title = (p.get("title") ?? "").slice(0, 80); return RULE.test(rule) ? { kind, rule, title: title || "Needs attention" } : null; }
    default: return null;
  }
}

/** The link's own parameters, for the board to take off the address once it has acted on them (a refresh then shows the board as the person left it). */
export const FOCUS_PARAMS = ["focus", "days", "dept", "c", "j", "rule", "title"];
