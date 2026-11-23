import { afterAll, beforeAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph } from "docx";
import { CVS } from "./corpus";
import { opsDetails, setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";

// The whole pipeline with NO AI configured: RoleMatch's own parser reads real Word and PDF files.
const PORT = 8793, base = `http://localhost:${PORT}`;
let tdb: TestDb;
let server: Proc;
const jar = new Map<string, string>();
const EMAIL = `r-${crypto.randomUUID().slice(0, 8)}@example.test`;
const pdf = (id: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./corpus/pdf/${id}.pdf`, import.meta.url))));
const docx = async (t: string) => new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: t.split("\n").map((l) => new Paragraph(l)) }] })));
const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "http://localhost:5173" } });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)); }
  return res;
};
const upload = async (kind: "cv" | "jd", bytes: Uint8Array, name: string) => {
  const f = new FormData(); f.append("kind", kind); f.append("file", new File([bytes], name));
  return (await call("/api/documents", { method: "POST", body: f })).json() as Promise<any>;
};
async function finish(id: string) {
  for (let i = 0; i < 100; i++) { const d: any = await (await call(`/api/documents/${id}`)).json(); if (d.status !== "processing") return d; await sleep(100); }
  throw new Error("timeout");
}

beforeAll(async () => {
  tdb = await setupTestDb({ PORT: String(PORT), ANTHROPIC_API_KEY: "" });
  await tdb.createUser("Org", EMAIL, "R", "a-long-test-password");
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  const r = await call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: "a-long-test-password" }) });
  expect(r.status).toBe(200);
}, 120000);
afterAll(async () => { server?.kill(); await tdb?.teardown(); }, 60000);

test("health reports that no AI is configured: the parser and the rules work alone", async () => {
  expect((await opsDetails(base)).ai).toEqual({ reading: "the parser alone", matching: "off: matches have no score" }); // the details are the platform operator's
});

test("real Word and PDF CVs publish through the pipeline using only the built-in parser", async () => {
  const docs = [
    await upload("cv", await docx(CVS.stacked), "stacked.docx"),
    await upload("cv", pdf("cv-twocolumn"), "twocolumn.pdf"),
    await upload("cv", pdf("cv-classic"), "classic.pdf"),
  ];
  for (const d of docs) expect((await finish(d.id)).status).toBe("published");
  const cands: any[] = ((await (await call("/api/candidates")).json()) as any).items;
  const by = (n: string) => cands.find((c) => c.name === n);
  expect(cands.map((c) => c.name).sort()).toEqual(["Ayesha Columns", "Jordan Example", "Samantha Test-Ngwenya"]);
  const ayesha = by("Ayesha Columns");
  expect(ayesha.location).toBe("Pretoria"); expect(ayesha.city).toBe("Pretoria");   // a person's place is shown as their town (places.ts)
  expect(ayesha.workHistory.map((w: any) => w.position)).toEqual(["Backend Developer", "Junior Developer"]);
  expect(ayesha.skills).toEqual(expect.arrayContaining(["Python", "Django", "PostgreSQL", "Docker"]));
  expect(Number(ayesha.experience)).toBeGreaterThanOrEqual(8); // dated roles 2018 to present
  expect(by("Samantha Test-Ngwenya").education[0].institution).toBe("University of Cape Town");
  expect(ayesha.extraction.method).toBe("rules");

  // A match with the AI switched off has no score and says so (e2e.test.ts, where a job can be read).
});

test("with no AI set up at all, a job description is refused with that reason and never read by word rules (jobs are read by the AI alone, 10 Nov 2026)", async () => {
  const job = await finish((await upload("jd", pdf("jd-sample"), "job.pdf")).id);
  expect(job.status).toBe("exception");
  expect(job.errorCode).toBe("AI_NOT_SET_UP");
  expect(job.errorMessage).toMatch(/read by the AI, which is not set up/);
  expect(((await (await call("/api/jobs")).json()) as any).items).toEqual([]);
});

test("bad files are stopped with a clear reason and never published", async () => {
  const scanned = await finish((await upload("cv", pdf("cv-scanned"), "scan.pdf")).id);
  expect(scanned.status).toBe("exception");
  expect(scanned.errorCode).toBe("NEEDS_OCR");
  const brokenPdf = await finish((await upload("cv", new TextEncoder().encode("%PDF-1.4 this is not really a pdf at all"), "broken.pdf")).id);
  expect(brokenPdf.status).toBe("exception");
  expect(brokenPdf.errorCode).toBe("UNREADABLE");
  // a zip that is cut short is not a readable Word file, so it is refused at the door (it used to be accepted and fail later)
  const brokenDocx = await upload("cv", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]), "broken.docx");
  expect(brokenDocx.error?.code).toBe("FILE-001");
  const letter = await finish((await upload("cv", await docx("hello there, this is a short note with no real content in it at all, written for a test only"), "short.docx")).id);
  expect(letter.status).toBe("exception");
  const names: any[] = ((await (await call("/api/candidates")).json()) as any).items;
  expect(names.length).toBe(3); // none of the bad files became candidates
});

test("a document with no name that reads as a CV is published and sent to a person; one that does not read as a CV is held back", async () => {
  const cvNoName = await finish((await upload("cv", await docx("Skills\nPython, Django, SQL, Git, Docker, AWS\nExperience\nDeveloper, Acme (2019 - 2022)\nBuilt many APIs with Python and Django for internal teams and customers across the business and its partners."), "noname.docx")).id);
  expect(cvNoName.status).toBe("published");
  const held = await finish((await upload("cv", await docx("Thank you for your time on the phone yesterday. Please find attached the signed form for your records, and let me know if there is anything further that you need from our side at this stage of the process."), "letter.docx")).id);
  expect(held.status).toBe("exception");
  expect(held.errorCode).toBe("IDENTITY_UNRESOLVED");
});
