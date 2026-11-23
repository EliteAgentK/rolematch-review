// Comparing two scored runs on the same inputs. Versioned, and tested in compare.test.ts.
//   1.0.0 (invalid): passing checks had no stable id, so a check that flipped between right and wrong went unmatched.
//   1.1.0 (incomplete): stable ids, but a check present in only one run was ignored, so NEW errors (for example a new unsupported skill) were never counted.
//   2.0.0: every check is matched by id and counted, including checks added or removed between runs; malformed or empty input is an error, never zero.
export const COMPARATOR_VERSION = "2.0.0";
export const SCORER_VERSION = "2.2.0";   // a certificate the reference calls Expired is judged on the record's validity, not on its completion (owner, 2026-11-04)

export type Change = "right → wrong" | "wrong → right" | "added correct" | "added error" | "removed correct" | "removed error" | "published → refused" | "refused → published";
export interface DocChange { path: string; id?: string; field?: string; change: Change }
export interface Row { path: string; ok: boolean; code?: string | null; scorerVersion?: string; checks: { id: string; ok: boolean; field: string }[]; [k: string]: unknown }

export function validate(rows: Row[], name: string): void {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${name}: no scored documents (an empty run is an error, never a clean result)`);
  for (const r of rows) {
    if (r.scorerVersion !== SCORER_VERSION) throw new Error(`${name}: ${r.path} was scored by scorer ${r.scorerVersion ?? "unknown"}, not ${SCORER_VERSION}: re-score`);
    if (!Array.isArray(r.checks)) throw new Error(`${name}: ${r.path} has no checks array`);
    for (const c of r.checks) if (typeof c.id !== "string" || !c.id.includes("|") || c.id.endsWith("|")) throw new Error(`${name}: ${r.path} has a check without a stable id (${JSON.stringify(c).slice(0, 80)})`);
  }
}

/** Per-document changes between an incumbent and an experiment. Several checks may share an id (a skill listed twice): they are compared as counts. */
export function compareRows(A: Row[], B: Row[]): DocChange[] {
  validate(A, "incumbent"); validate(B, "experiment");
  const pa = A.map((r) => r.path).sort().join("\n"), pb = B.map((r) => r.path).sort().join("\n");
  if (pa !== pb) throw new Error("the runs do not cover the same documents");
  const byPath = new Map(B.map((r) => [r.path, r]));
  const out: DocChange[] = [];
  // the field travels with the change: two fields can share an id prefix (a skill counted as an extra printed skill in one run, unsupported in another)
  const count = (cs: Row["checks"]) => { const m = new Map<string, { ok: number; bad: number; okField?: string; badField?: string }>(); for (const c of cs) { const v = m.get(c.id) ?? { ok: 0, bad: 0 }; if (c.ok) { v.ok++; v.okField = c.field; } else { v.bad++; v.badField = c.field; } m.set(c.id, v); } return m; };
  for (const x of A) {
    const y = byPath.get(x.path)!;
    if (x.ok !== y.ok) out.push({ path: x.path, change: x.ok ? "published → refused" : "refused → published" });
    const cx = count(x.checks), cy = count(y.checks);
    for (const id of new Set([...cx.keys(), ...cy.keys()])) {
      const u = cx.get(id) ?? { ok: 0, bad: 0 }, v = cy.get(id) ?? { ok: 0, bad: 0 };
      const shared = Math.min(u.ok + u.bad, v.ok + v.bad);
      // within the checks present in both runs: flips; beyond them: additions or removals
      const flipsToRight = Math.max(0, Math.min(v.ok - u.ok, shared)), flipsToWrong = Math.max(0, Math.min(u.ok - v.ok, shared));
      for (let i = 0; i < flipsToRight; i++) out.push({ path: x.path, id, field: v.okField, change: "wrong → right" });
      for (let i = 0; i < flipsToWrong; i++) out.push({ path: x.path, id, field: v.badField, change: "right → wrong" });
      const okLeft = v.ok - u.ok - flipsToRight + flipsToWrong, badLeft = v.bad - u.bad + flipsToRight - flipsToWrong;
      for (let i = 0; i < Math.abs(okLeft); i++) out.push({ path: x.path, id, field: okLeft > 0 ? v.okField : u.okField, change: okLeft > 0 ? "added correct" : "removed correct" });
      for (let i = 0; i < Math.abs(badLeft); i++) out.push({ path: x.path, id, field: badLeft > 0 ? v.badField : u.badField, change: badLeft > 0 ? "added error" : "removed error" });
    }
  }
  return out;
}
export const tallyChanges = (cs: DocChange[]) => cs.reduce((m, c) => ((m[c.change] = (m[c.change] ?? 0) + 1), m), {} as Partial<Record<Change, number>>);
/** Worse in any way: a right check turned wrong, a new error, a correct check lost, or a document refused. */
export const worsenings = (cs: DocChange[]) => cs.filter((c) => c.change === "right → wrong" || c.change === "added error" || c.change === "removed correct" || c.change === "published → refused");
