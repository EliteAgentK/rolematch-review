import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CASES } from "./failures/library";

// A remembered note prevents nothing, so the register is checked: an entry without its source, cause, versions, fix, test and measured outcome fails CI, as does a retained failure case that belongs to no entry.
const reg = JSON.parse(readFileSync(join(import.meta.dirname, "failures", "register.json"), "utf8")), root = join(import.meta.dirname, "..");
describe("the failure register", () => {
  test("every entry has what makes it usable", () => {
    for (const e of reg.entries) {
      for (const k of ["id", "group", "summary", "source", "cause", "measured", "status"]) expect(String(e[k] ?? "").trim(), `${e.id}: ${k}`).not.toBe("");
      expect(reg.statuses, e.id).toContain(e.status);
      expect(e.affected.length, `${e.id}: affected versions`).toBeGreaterThan(0);
      if (e.status !== "open") { expect(e.fix?.commit, `${e.id}: fix commit`).toMatch(/^[0-9a-f]{7,40}$/); expect(e.fix?.version, `${e.id}: fixed in`).toBeTruthy(); expect(e.tests.length, `${e.id}: regression test`).toBeGreaterThan(0); }
      for (const t of e.tests ?? []) expect(existsSync(join(root, t)), `${e.id}: ${t} exists`).toBe(true);
    }
  });
  test("identifiers are unique", () => { const ids = reg.entries.map((e: any) => e.id); expect(new Set(ids).size).toBe(ids.length); });
  test("a test cited for an entry named after it really mentions it, or runs its library cases", () => {
    for (const e of reg.entries) { if (e.cases || e.status === "open") continue; const named = e.tests.some((t: string) => readFileSync(join(root, t), "utf8").includes(e.id)); expect(named, `${e.id} is not mentioned in ${e.tests}`).toBe(true); }
  });
  test("every retained failure case belongs to an entry", () => {
    const patterns = reg.entries.filter((e: any) => e.cases).map((e: any) => new RegExp(e.cases));
    const orphans = CASES.map((c) => c.id).filter((id) => !patterns.some((p: RegExp) => p.test(id)));
    expect(orphans).toEqual([]);
  });
  test("a cited commit exists, where the history is available", () => {
    let shallow = true; try { shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() === "true"; } catch { /* no git */ }
    if (shallow) return;
    for (const e of reg.entries) if (e.fix?.commit) expect(() => execFileSync("git", ["cat-file", "-e", `${e.fix.commit}^{commit}`], { cwd: root, stdio: "ignore" }), `${e.id}: ${e.fix.commit}`).not.toThrow();
  });
});
