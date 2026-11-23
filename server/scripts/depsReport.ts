// npm run deps:report : what is out of date and what is vulnerable, for the website and the backend, and whether Node is the newest long-term
// support release. Run monthly (docs/architecture/PRODUCTION_READINESS.md, standing routine). Writes server/data/deps/report-<date>.md.
// Reads the npm registry and nodejs.org only; installs nothing.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const run = (cwd: string, args: string[]) => { try { return execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 << 20 }); } catch (e: any) { return String(e.stdout ?? ""); } };

export function audit(cwd: string): { total: number; high: number; critical: number; lines: string[]; incomplete?: string } {
  // An audit that did not complete is reported as incomplete, never as 0 vulnerabilities (R40).
  let j: any;
  try { j = JSON.parse(run(cwd, ["audit", "--json"])); } catch { j = null; }
  if (!j || j.error || typeof j.vulnerabilities !== "object" || typeof j.metadata?.vulnerabilities?.total !== "number")
    return { total: 0, high: 0, critical: 0, lines: [], incomplete: j?.error ? `npm audit reported an error (${j.error.code ?? "unknown"})` : "npm audit did not return a complete report" };
  const v = j.vulnerabilities ?? {};
  const lines = Object.entries<any>(v).map(([name, x]) => `| ${name} | ${x.severity} | ${x.fixAvailable === true ? "yes" : x.fixAvailable ? `via ${x.fixAvailable.name}@${x.fixAvailable.version}` : "no"} |`);
  const m = j.metadata?.vulnerabilities ?? {};
  return { total: m.total ?? lines.length, high: m.high ?? 0, critical: m.critical ?? 0, lines };
}

function outdated(cwd: string): string[] {
  const j = JSON.parse(run(cwd, ["outdated", "--json"]) || "{}");
  return Object.entries<any>(j).map(([name, x]) => {
    // semver: below 1.0 the second number is the breaking one (0.8 to 0.9 can break), from 1.0 the first
    const [c, l] = [String(x.current).split("."), String(x.latest).split(".")];
    const major = c[0] !== l[0] || (c[0] === "0" && c[1] !== l[1]);
    return `| ${name} | ${x.current} | ${x.wanted} | ${x.latest} | ${major ? "major" : "minor/patch"} |`;
  });
}

async function nodeLts(): Promise<string> {
  try {
    const list: any[] = await (await fetch("https://nodejs.org/dist/index.json", { signal: AbortSignal.timeout(15000) })).json();
    const lts = list.find((r) => r.lts);
    return `Running ${process.version}; newest long-term support release: ${lts.version} (${lts.lts})${lts.version === process.version ? " (current)" : " (update available)"}.`;
  } catch { return `Running ${process.version}; nodejs.org could not be reached to compare.`; }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = [`# Dependency report, ${new Date().toISOString().slice(0, 10)}`, "", await nodeLts(), ""];
  for (const [label, dir] of [["Website", ROOT], ["Backend", join(ROOT, "server")]] as const) {
    const a = audit(dir), o = outdated(dir);
    out.push(`## ${label}`, "", a.incomplete ? `**Vulnerabilities: AUDIT INCOMPLETE** (${a.incomplete}). This is not a clean result.` : `**Vulnerabilities:** ${a.total} (${a.critical} critical, ${a.high} high).`, "");
    if (a.lines.length) out.push("| package | severity | fix |", "|---|---|---|", ...a.lines, "");
    out.push(`**Out of date:** ${o.length} package(s).`, "");
    if (o.length) out.push("| package | installed | newest within range | newest | kind |", "|---|---|---|---|---|", ...o, "");
  }
  out.push("Known holds: a Chakra UI update is checked with npm run test:visual (every screen, pixel for pixel).");
  const dir = fileURLToPath(new URL("../data/deps/", import.meta.url)); mkdirSync(dir, { recursive: true });
  const file = join(dir, `report-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, out.join("\n") + "\n");
  console.log(out.join("\n")); console.log(`\nwritten to ${file.replace(ROOT, "")}`);
}
