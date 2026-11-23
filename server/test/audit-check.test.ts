import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
// @ts-expect-error: plain JavaScript module shared with the command line
import { auditTree, judge } from "../scripts/auditCore.mjs";

// R40: the audit reported "no advisories" for the website for two weeks without ever auditing it (its folder path had %20 for the space, npm failed,
// and the failure was read as an empty report). An audit that did not complete must say so; findings and failures are different outcomes.
const base = mkdtempSync(join(tmpdir(), "audit check "));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const tree = (name: string, files = ["package.json", "package-lock.json"]) => { const d = join(base, name); mkdirSync(d, { recursive: true }); for (const f of files) writeFileSync(join(d, f), "{}"); return d; };
const report = (o: { total?: number; prod?: number; vulns?: object } = {}) => JSON.stringify({ auditReportVersion: 2, vulnerabilities: o.vulns ?? {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: o.total ?? 0 }, dependencies: { prod: o.prod ?? 172, dev: 10, total: 182 } } });
const ok = (stdout: string, status = 0) => () => ({ status, stdout });

test("a folder whose path contains spaces is audited at that exact path, and a valid empty report is a clean result", () => {
  const dir = tree("my project with spaces");
  let ranIn = "";
  const t = auditTree({ name: "website", dir, run: (d: string) => { ranIn = d; return { status: 0, stdout: report() }; } });
  expect(ranIn).toBe(dir); expect(ranIn).toContain(" "); expect(ranIn).not.toContain("%20");
  expect(t).toMatchObject({ status: "clean", advisories: [], checkedProduction: 172 });
});

test("a missing folder or missing package files make the audit incomplete, and npm is never run", () => {
  let ran = false; const run = () => { ran = true; return { status: 0, stdout: report() }; };
  expect(auditTree({ name: "x", dir: join(base, "Talent%20Hub"), run })).toMatchObject({ status: "incomplete", reason: expect.stringMatching(/does not exist/) });
  expect(auditTree({ name: "x", dir: tree("no lockfile", ["package.json"]), run })).toMatchObject({ status: "incomplete", reason: expect.stringMatching(/package-lock\.json is missing/) });
  expect(ran).toBe(false);
});

test("scanner errors are incomplete, never clean: npm missing, network error report, unreadable or partial output, no dependencies checked, exit code out of step", () => {
  const dir = tree("errors");
  const cases: [string, () => { status: number | null; stdout: string; error?: string }][] = [
    ["could not run", () => ({ status: null, stdout: "", error: "ENOENT" })],
    ["reported an error", ok(JSON.stringify({ error: { code: "ENOTFOUND", summary: "request to https://registry.npmjs.org failed" } }), 1)],
    ["readable report", ok("", 1)],
    ["readable report", ok("{\"auditReportVersion\":2,", 0)],
    ["expected structure", ok("{}", 0)],
    ["expected structure", ok(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), 0)],
    ["no production dependencies", ok(report({ prod: 0 }), 0)],
    ["does not match", ok(report(), 1)],
    ["does not match", ok(report(), 137)],
  ];
  for (const [why, run] of cases) {
    const t = auditTree({ name: "server", dir, run });
    expect(t.status, why).toBe("incomplete"); expect(t.reason).toMatch(new RegExp(why)); expect(t.advisories).toEqual([]);
  }
});

test("advisories are a finding, kept separate from failures, and are judged against the allowlist by date", () => {
  const vulns = { "sprintf-js": { via: [{ url: "https://github.com/advisories/GHSA-hp3w-g68c-fv3c" }] }, argparse: { via: ["sprintf-js"] }, other: { via: [{ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }] } };
  const t = auditTree({ name: "server", dir: tree("findings"), run: ok(report({ total: 3, vulns }), 1) });
  expect(t).toMatchObject({ status: "advisories", advisories: ["GHSA-aaaa-bbbb-cccc", "GHSA-hp3w-g68c-fv3c"] });
  const allow = [{ advisory: "GHSA-hp3w-g68c-fv3c", reviewBy: "2027-01-20", package: "sprintf-js" }];
  expect(judge(t.advisories, allow, "2026-11-02").map((j: any) => j.verdict)).toEqual(["new", "accepted"]);
  expect(judge(t.advisories, allow, "2027-02-01").map((j: any) => j.verdict)).toEqual(["new", "expired"]);
  expect(auditTree({ name: "server", dir: tree("counted not named"), run: ok(report({ total: 2, vulns: { a: { via: ["b"] } } }), 1) })).toMatchObject({ status: "incomplete" });
});
