// npm run safety:secrets [-- --staged | --history | --range <base>..<head> | --dir <path>] : secret scan with gitleaks
// (docs/security/SAFETY_CHECKS.md). gitleaks' maintained default rules are always on; .gitleaks.toml adds RoleMatch rules on top.
// Exit 0: the scan completed and found nothing. Exit 1: it completed and found something. Exit 2: the scan is INCOMPLETE (gitleaks missing,
// crashed, or its report is missing, unreadable or contradicts its exit code); that is never treated as clean.
// Findings are printed as rule, file, line and commit only; secret values never are (they are redacted inside gitleaks as well).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FOUND = 3;   // gitleaks' exit code for findings is set to 3, so its own errors (1) and crashes cannot be mistaken for findings or for a clean scan

export function scan(mode, { gitleaks = process.env.GITLEAKS_BIN || "gitleaks", cwd = ROOT, config = join(ROOT, ".gitleaks.toml") } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "secret-scan-")), report = join(tmp, "report.json");
  const common = ["--redact", "--no-banner", "--log-level", "error", "--exit-code", String(FOUND), "--config", config, "--report-format", "json", "--report-path", report];
  const args = mode.kind === "dir" ? ["dir", mode.path, ...common]
    : mode.kind === "staged" ? ["git", "--pre-commit", "--staged", ...common, "."]
    : mode.kind === "range" ? ["git", "--log-opts", mode.range, ...common, "."]
    : ["git", ...common, "."];   // whole history: every branch and tag gitleaks' default log options reach
  try {
    const r = spawnSync(gitleaks, args, { cwd, encoding: "utf8", timeout: 600_000 });
    const incomplete = (reason) => ({ status: "incomplete", reason, findings: [] });
    if (r.error) return incomplete(r.error.code === "ENOENT" ? "gitleaks is not installed" : `gitleaks could not run (${r.error.code ?? r.error.message})`);
    if (r.status !== 0 && r.status !== FOUND) return incomplete(`gitleaks failed (exit ${r.status ?? r.signal})`);
    let findings;
    try { findings = JSON.parse(readFileSync(report, "utf8")); } catch { return incomplete("gitleaks did not write a readable report"); }
    if (!Array.isArray(findings)) return incomplete("gitleaks' report is not a list of findings");
    if ((r.status === FOUND) !== (findings.length > 0)) return incomplete(`gitleaks' exit code (${r.status}) does not match its report (${findings.length} findings)`);
    return { status: findings.length ? "found" : "clean", findings: findings.map((f) => ({ rule: f.RuleID, file: f.File, line: f.StartLine, commit: f.Commit ? f.Commit.slice(0, 8) : undefined, fingerprint: f.Fingerprint })) };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2);
  const mode = a[0] === "--staged" ? { kind: "staged" } : a[0] === "--range" ? { kind: "range", range: a[1] } : a[0] === "--dir" ? { kind: "dir", path: a[1] } : { kind: "history" };
  if ((mode.kind === "range" || mode.kind === "dir") && !a[1]) { console.error(`--${mode.kind} needs a value`); process.exit(2); }
  const r = scan(mode);
  if (r.status === "incomplete") { console.error(`secret scan INCOMPLETE: ${r.reason}. This is a failure, not a clean result.`); process.exit(2); }
  for (const f of r.findings) console.error(`possible secret: ${f.rule} in ${f.file}:${f.line}${f.commit ? ` (commit ${f.commit})` : ""} [fingerprint ${f.fingerprint}]`);
  console.log(r.status === "clean" ? "secret scan completed: nothing found" : `secret scan completed: ${r.findings.length} possible secret(s). Values are hidden; remove them, and rotate any real key.`);
  process.exit(r.status === "clean" ? 0 : 1);
}
