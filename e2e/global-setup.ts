// Creates one throw-away organisation with known records, once per run, and saves the signed-in browser state for the tests.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request, type FullConfig } from "@playwright/test";
import { assertSafeToTest } from "./mailSafety";
import { Document, HeadingLevel, Packer, Paragraph } from "../server/node_modules/docx";

const SAMPLES = join(__dirname, "../sample-documents");

const docx = async (lines: string[], headings: string[]) =>
  Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: lines.map((l, i) => new Paragraph(i === 0 ? { text: l, heading: HeadingLevel.TITLE } : headings.includes(l) ? { text: l, heading: HeadingLevel.HEADING_2 } : { text: l })) }] })));

/** A CV whose name and occupation are long, with many skills: the hard case for a compact card. */
export const LONG_NAME = "Maria-Magdalena van der Westhuizen-Oosthuizen";
export const LONG_ROLE = "Principal Software Architect, Technical Lead";
export const LONG_JOB = "Principal Software Engineer, Platform Reliability";
export const LONG_COMPANY = "Meridian Digital Solutions International (Pty) Ltd";

const longCv = () => docx([
  LONG_NAME, LONG_ROLE, "maria.vdw@example.test | 082 555 0199 | Stellenbosch, Western Cape, South Africa",
  "Summary", "Software architect with twelve years of experience leading platform teams.",
  "Skills", "TypeScript, JavaScript, React, Node.js, PostgreSQL, Docker, Kubernetes, AWS, Python, Terraform, GraphQL, Redis, Kafka, Jest",
  "Experience", `${LONG_ROLE}, Boland Software (Jan 2019 - Present)`,
  ...Array.from({ length: 14 }, (_, i) => `Led platform initiative ${i + 1}: designed and delivered services in TypeScript and Node.js on AWS with Docker and Kubernetes, mentoring a team of engineers.`),
  "Senior Developer, Cape Systems (Jan 2013 - Dec 2018)",
  ...Array.from({ length: 8 }, (_, i) => `Built feature ${i + 1} in React and PostgreSQL with automated tests in Jest.`),
  "Education", "BSc Computer Science, Stellenbosch University, 2012",
], ["Summary", "Skills", "Experience", "Education"]);

const longJob = () => docx([
  LONG_JOB, `Company: ${LONG_COMPANY}`, "Location: Johannesburg, South Africa", "Employment type: Full-time", "Department: Engineering",
  "About the role", "Own the reliability of our platform and data infrastructure.",
  "Requirements", "At least five years of professional software development experience.", "Strong experience with TypeScript and JavaScript.", "Production experience with React and Node.js.", "Experience with PostgreSQL and Redis.", "Hands-on experience with Docker, Kubernetes and Terraform on AWS.", "Experience with Kafka or GraphQL.",
], ["About the role", "Requirements"]);

/**
 * The settings the account-creating script runs with: the local Supabase stack's, and nothing from server/.env, which points at a hosted project.
 * 16 Nov 2026: this script ran with server/.env and created a test organisation in the old hosted project while the browser tested the local server.
 * A server not on this machine is tested with playwright.hosted.config.ts, which creates its account its own way.
 */
function localStackEnv(base: string): NodeJS.ProcessEnv {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(base)) throw new Error(`${base} is not on this machine: use playwright.hosted.config.ts`);
  const s = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { cwd: join(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const local = (u?: string) => !!u && /^(?:https?|postgres(?:ql)?):\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(u);
  const key = s.SERVICE_ROLE_KEY ?? s.SECRET_KEY;
  if (!local(s.API_URL) || !local(s.DB_URL) || !key) throw new Error("The local Supabase stack's addresses are not all on this machine: refusing to create the test account.");
  const empty = join(tmpdir(), `rolematch-e2e-${process.pid}.env`); writeFileSync(empty, "");
  return { ...process.env, ROLEMATCH_ENV_FILE: empty, SUPABASE_URL: s.API_URL, DATABASE_URL: s.DB_URL, SUPABASE_SERVICE_ROLE_KEY: key, ANTHROPIC_API_KEY: "" };
}

export default async function globalSetup(config: FullConfig) {
  const base = config.projects[0].use.baseURL ?? "http://localhost:8787";
  const safety = await assertSafeToTest(base);   // before anything is created: real sending must be off or restricted to approved recipients
  console.log(`Mail safety of ${base}: sending ${safety.sending}`);
  const api = await request.newContext({ baseURL: base, extraHTTPHeaders: { origin: base } });
  const run = Date.now().toString(36);
  const email = `pw-${run}@example.test`, password = `pw-${run}-Flow-1!x`;
  // The account is created directly, as an administrator would, so test runs never use up the public sign-up limit (5 an hour from one
  // address, there to stop bots). The server's own tests cover sign-up itself.
  execFileSync(process.execPath, ["--import", "tsx", "src/scripts/createUser.ts", `Playwright ${run}`, email, "Playwright Tester", password], { cwd: join(__dirname, "../server"), stdio: "pipe", env: localStackEnv(base) });
  const res = await api.post("/api/auth/login", { data: { email, password } });
  if (!res.ok()) throw new Error(`signing in the test account failed (${res.status()}): is the server running?`);
  const upload = async (kind: "cv" | "jd", name: string, buffer: Buffer) => {
    const mimeType = name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const r = await api.post("/api/documents", { multipart: { kind, file: { name, mimeType, buffer } } });
    if (!r.ok()) throw new Error(`upload ${name} failed: ${r.status()}`);
  };
  await upload("cv", "long-name.docx", await longCv());
  for (const f of ["cv01-thandi-mokoena.docx", "cv02-ruan-van-der-merwe.docx", "cv04-michael-chen.docx", "cv08-zanele-khumalo.docx"]) await upload("cv", f, readFileSync(join(SAMPLES, "cvs", f)));
  await upload("jd", "long-job.docx", await longJob());
  for (const f of ["job01-senior-developer.docx", "job02-data-analyst.docx", "job05-sales-rep.docx", "job09-devops-engineer.docx"]) await upload("jd", f, readFileSync(join(SAMPLES, "jobs", f)));
  // wait until every document has finished processing
  for (let i = 0; i < 120; i++) {
    const docs: any[] = await (await api.get("/api/documents")).json();
    if (docs.some((d) => d.status === "exception")) throw new Error("a seed document was rejected: " + JSON.stringify(docs.filter((d) => d.status === "exception").map((d) => [d.fileName, d.errorCode])));
    if (!docs.some((d) => d.status === "processing")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const cands: any = await (await api.get("/api/candidates?limit=100")).json();
  const jobs: any = await (await api.get("/api/jobs?limit=100")).json();
  if (cands.total !== 5 || jobs.total !== 5) throw new Error(`expected 5 candidates and 5 jobs, got ${cands.total} and ${jobs.total}`);
  await api.storageState({ path: join(__dirname, ".auth.json") });
  writeFileSync(join(__dirname, ".seed.json"), JSON.stringify({ email, run }));
  await api.dispose();
}
