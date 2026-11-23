// The dependency audit's rules, kept apart from the command so they can be tested (test/audit-check.test.ts, register R40).
// Three outcomes, never mixed up:
//   "clean"       npm audit ran to completion on this dependency tree and reported no advisories;
//   "advisories"  it ran to completion and reported advisories (judged against audit-allowlist.json by the caller);
//   "incomplete"  anything else: the folder or its package files are missing, npm could not run, the output is not a complete audit report,
//                 or the report and npm's exit code disagree. An incomplete audit is a failure, never "no advisories".
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Runs `npm audit --omit=dev --json` in `dir`, a filesystem path (R40 was a URL path, with %20 for a space, given as the folder). */
export function npmAudit(dir) {
  const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20, timeout: 180_000 });
  return { status: r.status, stdout: r.stdout ?? "", error: r.error ? String(r.error.code ?? r.error.message) : undefined };
}

export function auditTree({ name, dir, run = npmAudit, exists = existsSync }) {
  const incomplete = (reason) => ({ name, dir, status: "incomplete", reason, advisories: [] });
  if (!exists(dir)) return incomplete(`the folder ${dir} does not exist`);
  for (const f of ["package.json", "package-lock.json"]) if (!exists(join(dir, f))) return incomplete(`${f} is missing in ${dir}`);
  const r = run(dir);
  if (r.error) return incomplete(`npm audit could not run (${r.error})`);
  let report;
  try { report = JSON.parse(r.stdout); } catch { return incomplete("npm audit did not return a readable report"); }
  if (report?.error) return incomplete(`npm audit reported an error (${report.error.code ?? "unknown"}${report.error.summary ? `: ${report.error.summary}` : ""})`);
  const totals = report?.metadata?.vulnerabilities, deps = report?.metadata?.dependencies;
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null || typeof totals?.total !== "number")
    return incomplete("the report is missing the expected structure");
  if (!(typeof deps?.prod === "number" && deps.prod > 0)) return incomplete("the report says no production dependencies were checked");
  // npm audit exits 0 when it found nothing and 1 when it found advisories; anything else means it did not finish normally.
  if (!((r.status === 0 && totals.total === 0) || (r.status === 1 && totals.total > 0))) return incomplete(`npm audit's exit code (${r.status}) does not match its report (${totals.total} advisories)`);
  const advisories = new Set();
  for (const v of Object.values(report.vulnerabilities)) for (const via of v.via ?? []) if (typeof via === "object" && via.url) advisories.add(String(via.url).split("/").pop());
  if (totals.total > 0 && advisories.size === 0) return incomplete("the report counts advisories but names none");
  return { name, dir, status: advisories.size ? "advisories" : "clean", advisories: [...advisories].sort(), checkedProduction: deps.prod };
}

/** Judges reported advisories against the allowlist. Execution failures are never judged here: an incomplete audit stays incomplete. */
export function judge(advisories, allow, today = new Date().toISOString().slice(0, 10)) {
  return advisories.map((id) => {
    const a = allow.find((x) => x.advisory === id);
    return !a ? { id, verdict: "new" } : a.reviewBy < today ? { id, verdict: "expired", reviewBy: a.reviewBy } : { id, verdict: "accepted", reviewBy: a.reviewBy, package: a.package };
  });
}
