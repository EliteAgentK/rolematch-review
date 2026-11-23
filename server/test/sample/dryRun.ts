// Uploads every file in /sample-documents through a RUNNING server (QA account) and prints what was extracted.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE ?? "http://localhost:8787";
const ROOT = fileURLToPath(new URL("../../../sample-documents", import.meta.url));
const [email, password] = readFileSync(fileURLToPath(new URL("../../data/qa-credentials.txt", import.meta.url)), "utf8").split("\n").map((l) => l.split(": ")[1]);
const jar = new Map<string, string>();
const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "http://localhost:5173" } });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return res;
};
const login = await call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
if (login.status !== 200) await call("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "QA Tester", orgName: "QA Organisation", email, password }) });
const ids = new Map<string, string>();
for (const [dir, kind] of [["jobs", "jd"], ["cvs", "cv"]] as const) for (const f of readdirSync(join(ROOT, dir))) {
  const fd = new FormData(); fd.append("kind", kind); fd.append("file", new File([readFileSync(join(ROOT, dir, f))], f));
  const d: any = await (await call("/api/documents", { method: "POST", body: fd })).json();
  ids.set(d.id, f); if (d.error) console.log("UPLOAD ERROR", f, d.error.code);
}
for (let i = 0; i < 180; i++) { const docs: any[] = await (await call("/api/documents")).json(); if (!docs.some((d) => ids.has(d.id) && d.status === "processing")) { for (const d of docs.filter((x) => ids.has(x.id) && x.status === "exception")) console.log("EXCEPTION", ids.get(d.id), d.errorCode, d.errorMessage); break; } await new Promise((s) => setTimeout(s, 1000)); }
const cands: any = await (await call("/api/candidates?limit=100")).json();
const jobs: any = await (await call("/api/jobs?limit=100")).json();
const names = new Set([...ids.values()]);
console.log("\n=== CANDIDATES ===");
for (const c of cands.items) console.log(`${c.name} | role: ${c.role || "-"} | ${c.email || "no email"} | ${c.location || "no location"} | skills(${(c.skills ?? []).length}): ${(c.skills ?? []).join(", ")} | jobs: ${(c.workHistory ?? []).map((w: any) => `${w.position}@${w.company} ${w.startDate}-${w.endDate}`).join("; ")} | edu: ${(c.education ?? []).map((e: any) => e.degree).join("; ")}`);
console.log("\n=== JOBS ===");
for (const j of jobs.items) console.log(`${j.title} | ${j.company || "-"} | ${j.location || "-"} | ${j.type || "-"}/${j.workArrangement || "-"} | skills: ${(j.skills ?? []).join(", ")} | mandatory(${(j.requirements ?? []).length}): ${(j.requirements ?? []).join(" / ")} | preferred: ${(j.preferredRequirements ?? []).join(" / ")}`);
