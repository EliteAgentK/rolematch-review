// Not part of the suite: only runs with DEMO_WORLD set. Starts a throw-away server on the local stack with invented documents read by the candidate pipeline, and waits, so the panel can be looked at in a browser.
// DEMO_WORLD=1 npm run test:local -- test/candidate/demoWorld.test.ts, then API_TARGET=http://localhost:8840 npx vite --port 5199
import { writeFileSync } from "node:fs";
import { Document, Packer, Paragraph } from "docx";
import { expect, test } from "vitest";
import { makeWorld, sleep } from "../portalKit";

test.runIf(process.env.DEMO_WORLD)("demonstration world", async () => {
  const w = await makeWorld(8840, 1), A = w.users[0]; A.portal = (await A.get("/api/portals")).body[0].id;
  const cur = (await A.get("/api/settings")).body;
  expect((await A.req("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: cur.version, reading: { ...cur.settings.reading, candidatePipeline: true } }) })).status).toBe(200);
  const BODY = ["Skills", "Excel / Reporting / Budgeting / Audit", "Experience", "Financial Manager", "Northwind Traders | 2018-01 to Present | Permanent", "- Prepared monthly statements for the board and led the audit team across three regions in the group.", "- Reviewed budgets with each regional director every quarter and reported variances to the executive.", "Education", "BCom Accounting | University of Pretoria | Completed | 2012", "Courses", "Business Writing Certificate | Northbridge Learning | Completed | 2023"];
  const file = async (name: string, lines: string[]) => new File([new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: lines.map((l) => new Paragraph(l)) }] })))], name);
  const batch = (await A.post("/api/batches", { kind: "cv", files: 2, bytes: 40000 })).body;
  for (const f of [await file("batch-one.docx", ["Sipho Dlamini", "sipho.dlamini@mail.example", "082 555 0122", ...BODY]), await file("batch-two.docx", ["Neha Govender", "neha.govender@mail.example", "082 555 0133", "Skills", "Sales / Negotiation / Account management", "Experience", "Sales Manager", "Southwind Retail | 2019-01 to Present | Permanent", "- Led regional sales targets and negotiated annual retail contracts for three regions.", "Education", "Diploma in Marketing | Durban University of Technology | Completed | 2016"])]) expect((await A.upload(f, { batch: batch.id })).status).toBe(202);
  expect((await A.upload(await file("job.docx", ["Finance Manager", "Meridian Holdings", "Location", "Johannesburg", "Required experience", "At least five years of financial reporting experience.", "BCom Accounting or equivalent.", "Experience with Excel and Budgeting.", "Preferred experience", "Experience with Audit.", "Forecasting is an advantage.", "Responsibilities", "Prepare monthly statements for the board and lead the audit process across the group."]), { kind: "jd" })).status).toBe(202);
  for (const f of [await file("agency.docx", ["Candidate Name: Thandi Mokoena", "To arrange a meeting with this candidate or to request further information please contact:", "Consultants Name | Peter Smith", "Consultants Number | 082 555 0100", "Consultants Email | peter.smith@brightpath.example", "Brightpath Recruitment", ...BODY]), await file("direct.docx", ["Lerato Dube", "lerato.dube@mail.example", "082 555 0177", ...BODY]), await file("noname.docx", ["lm1990@mail.example", "082 555 0111", ...BODY])]) expect((await A.upload(f)).status).toBe(202);
  writeFileSync(process.env.DEMO_WORLD!, JSON.stringify({ email: A.email, password: "a-long-enough-password-1" }));
  await sleep(40 * 60 * 1000);
  await w.stop();
}, 45 * 60 * 1000);
