// npm run safety:licences : checks every package in the committed lockfiles (website and server) against the owner's permissive-only rule
// (scripts/safety/licence-policy.json). Reads the lockfiles only, so it needs no install and cannot be fooled by what happens to be in node_modules.
// Fails on: a licence that is neither allowed nor covered by an exception; a package with no licence stated; an exception past its review date;
// a lockfile that cannot be read. An SPDX "A OR B" passes if either side is allowed; "A AND B" needs every part allowed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const policy = JSON.parse(readFileSync(new URL("./licence-policy.json", import.meta.url), "utf8"));
const allowed = new Set(policy.allowed);
const today = new Date().toISOString().slice(0, 10);
const glob = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
const exceptionFor = (name) => policy.exceptions.find((e) => e.packages.some((p) => glob(p).test(name)));

function permitted(expr) {
  const e = expr.trim().replace(/^\((.*)\)$/, "$1");
  if (/\bOR\b/.test(e)) return e.split(/\bOR\b/).some((x) => permitted(x));
  if (/\bAND\b/.test(e)) return e.split(/\bAND\b/).every((x) => permitted(x));
  return allowed.has(e);
}

let failed = false, warned = 0, checked = 0;
const used = new Set();
for (const [label, lockfile] of [["website", "package-lock.json"], ["server", "server/package-lock.json"]]) {
  let lock;
  try { lock = JSON.parse(readFileSync(root + lockfile, "utf8")); }
  catch (e) { console.error(`${label}: cannot read ${lockfile} (${e.message}); this is a failure, not a clean result`); failed = true; continue; }
  if (!lock.packages || lock.lockfileVersion < 2) { console.error(`${label}: ${lockfile} has no per-package licence data (lockfile v2+ needed)`); failed = true; continue; }
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    checked++;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const lic = typeof pkg.license === "object" ? pkg.license?.type : pkg.license;
    const where = `${label}: ${name}@${pkg.version} (${pkg.dev ? "dev" : "production"})`;
    if (!lic) { console.error(`${where}: no licence stated; needs review`); failed = true; continue; }
    if (permitted(lic)) continue;
    const ex = exceptionFor(name);
    if (!ex) { console.error(`${where}: licence "${lic}" is not on the permissive list and has no exception; needs review`); failed = true; continue; }
    used.add(ex);
    if (ex.devOnly && !pkg.dev) { console.error(`${where}: the exception for "${lic}" covers development use only, but this copy is a production dependency`); failed = true; continue; }
    if (ex.reviewBy < today) { console.error(`${where}: exception for "${lic}" was due for review on ${ex.reviewBy}`); failed = true; continue; }
    if (ex.status !== "accepted") warned++;
  }
}
for (const ex of used) if (ex.status !== "accepted") console.warn(`pending review until ${ex.reviewBy}: ${ex.packages.join(", ")} (${ex.licence}; ${ex.scope})`);
for (const ex of policy.exceptions) if (!used.has(ex)) console.warn(`unused exception (remove it): ${ex.packages.join(", ")}`);
console.log(`${checked} packages checked; ${warned} covered by exceptions still pending the owner's review; ${failed ? "FAILED" : "passed"}`);
process.exit(failed ? 1 : 0);
