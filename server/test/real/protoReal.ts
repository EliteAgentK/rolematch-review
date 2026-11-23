// The identity prototype on the real development CVs. Private output goes to server/data/real-cvs/proto/; only opaque ids, states and counts are printed. File-name agreement is a diagnostic, not accuracy.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readIdentity, identityFields } from "../../src/docmodel/identity";
import { buildDocModel } from "../../src/docmodel/model";
import { sniff } from "../../src/formats";
import { stopOcr } from "../../src/ocr";

if (process.env.ANTHROPIC_API_KEY) throw new Error("Refusing: real CVs must not reach any outside service.");
const PRIVATE = join(import.meta.dirname, "..", "..", "data", "real-cvs"), inv = JSON.parse(readFileSync(join(PRIVATE, "inventory.json"), "utf8")), [runId, baseRun = "real-baseline-1"] = process.argv.slice(2);
mkdirSync(join(PRIVATE, "proto"), { recursive: true, mode: 0o700 });
const labelsPath = join(PRIVATE, "labels.json"); let labels: Record<string, any> = {}; try { labels = JSON.parse(readFileSync(labelsPath, "utf8")); } catch { /* none yet */ }
const out: any[] = [], ms: number[] = [];
for (const d of inv.docs.filter((x: any) => x.role === "development")) {
  const bytes = new Uint8Array(readFileSync(join(inv.source, d.file))), t = performance.now(), model = await buildDocModel(bytes, sniff(bytes)!), i = readIdentity(model), took = Math.round(performance.now() - t); ms.push(took);
  const cur = JSON.parse(readFileSync(join(PRIVATE, "runs", baseRun, `${d.id}.json`), "utf8"));
  const proto = identityFields(i), current = { fullName: cur.record?.name ?? "", email: cur.record?.email ?? "", phone: cur.record?.phone ?? "" };
  out.push({ id: d.id, format: d.format, reader: model.reader, ms: took, proto, current, identity: i });
  const agrees = (name: string) => (!name ? "none" : d.names.some((w: string) => name.toLowerCase().includes(w)) ? "file-name agrees" : "unconfirmed");
  const owners = i.contacts.reduce<Record<string, number>>((a, c) => ({ ...a, [c.owner]: (a[c.owner] ?? 0) + 1 }), {});
  console.log(`${d.id} ${model.reader.padEnd(10)} ${String(took).padStart(6)}ms name: current ${agrees(current.fullName).padEnd(16)} proto ${agrees(proto.fullName).padEnd(16)} ${i.name.status === "abstained" ? `(${i.name.reason})` : ""} email ${current.email ? "y" : "-"}/${proto.email ? "y" : "-"} phone ${current.phone ? "y" : "-"}/${proto.phone ? "y" : "-"} contacts ${JSON.stringify(owners)}${i.agencyDocument ? " AGENCY" : ""}`);
}
await stopOcr();
writeFileSync(join(PRIVATE, "proto", `${runId}.json`), JSON.stringify(out, null, 1), { mode: 0o600 });
const tally = (who: "current" | "proto") => out.reduce((a, r) => { const d = inv.docs.find((x: any) => x.id === r.id), n = r[who].fullName; const k = !n ? "none" : d.names.some((w: string) => n.toLowerCase().includes(w)) ? "agrees" : "unconfirmed"; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<string, number>);
console.log("\nname vs file name (DIAGNOSTIC, not accuracy): current", JSON.stringify(tally("current")), "prototype", JSON.stringify(tally("proto")));
console.log("agency documents recognised:", out.filter((r) => r.identity.agencyDocument).length, "| median ms", [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)], "slowest", Math.max(...ms));
const checked = out.filter((r) => labels[r.id]);
if (!checked.length) console.log("checked answers: none yet, so no accuracy can be stated. npm run review:real opens the private page.");
else {
  const score = (who: "current" | "proto", field: "name" | "email" | "phone", key: string) => checked.reduce((a, r) => { const e = String(labels[r.id][field] ?? "").toLowerCase().trim(), g = String(r[who][key] ?? "").toLowerCase().trim(), nd = (s: string) => (field === "phone" ? s.replace(/\D/g, "").replace(/^27/, "0") : s); if (labels[r.id][`${field}Unsure`]) a.unsure++; else if (!e) a[g ? "wrong" : "correct"]++; else if (!g) a.missing++; else a[nd(g) === nd(e) ? "correct" : "wrong"]++; return a; }, { correct: 0, wrong: 0, missing: 0, unsure: 0 });
  console.log(`checked answers for ${checked.length} CVs:`); for (const [f, k] of [["name", "fullName"], ["email", "email"], ["phone", "phone"]] as const) console.log(`  ${f}: current ${JSON.stringify(score("current", f, k))} prototype ${JSON.stringify(score("proto", f, k))}`);
}

// The agency and the recruiter, on documents a person ticked or the prototype read as an agency's. Nothing counts as accuracy until a person has entered the answers.
const agencyDocs = out.filter((r) => labels[r.id]?.agency || r.identity.agencyDocument), isAgency = (r: any) => r.identity.agencyDocument, ticked = agencyDocs.filter((r) => labels[r.id]?.agency);
console.log(`agency documents: ticked by a person ${ticked.length}, read by the prototype ${agencyDocs.filter(isAgency).length}, both ${ticked.filter(isAgency).length}`);
const details: [string, (i: any) => string | undefined][] = [["agencyName", (i) => i.agency?.name.value], ["recruiterName", (i) => i.agency?.recruiter.name.value], ["recruiterEmail", (i) => i.agency?.recruiter.email.value], ["recruiterPhone", (i) => i.agency?.recruiter.phone.value], ["officeEmail", (i) => i.agency?.office.email.value], ["officePhone", (i) => i.agency?.office.phone.value]];
const withAnswers = agencyDocs.filter((r) => labels[r.id]?.details), nd = (k: string, v: string) => (/phone/i.test(k) ? v.replace(/\D/g, "").replace(/^27/, "0") : v.toLowerCase().replace(/\s+/g, " ").trim());
for (const [k, read] of details) {
  const a = { correct: 0, wrong: 0, missing: 0 };
  for (const r of withAnswers) { const e = nd(k, labels[r.id].details[k] ?? ""), g = nd(k, read(r.identity) ?? ""); if (!e) a[g ? "wrong" : "correct"]++; else if (!g) a.missing++; else a[g === e ? "correct" : "wrong"]++; }
  console.log(`  ${k}: found on ${agencyDocs.filter((r) => read(r.identity)).length} of ${agencyDocs.length}${withAnswers.length ? ` | checked on ${withAnswers.length}: ${JSON.stringify(a)}` : " | not yet checked by a person"}`);
}
