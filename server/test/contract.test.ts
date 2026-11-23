import { execFileSync } from "node:child_process";
import { PANEL_LAYOUT } from "../../src/config/panels";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CV_PLAN } from "../src/cvPlan";
import { extractCandidate } from "../src/extract";
import { PARSER_VERSION } from "../src/version";
import { AS_OF, computeGolden, GOLDEN_DIR, hashOf } from "./golden/outputs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("the reading plan is fixed and mirrors the panel", () => {
  // Until 10 Nov 2026 the panel was one long column in the plan's order. It now has tabs in the owner's design (Overview, Experience, Education, Skills,
  // Notes), and the parser keeps its own fixed order: reordering how CVs are read for a change of layout would change readings for no reason. What stays
  // fixed is the plan's order, and that every step has its one place on the panel, whichever tab holds it.
  test("the parser's steps run in one fixed order, and every step has its place on the candidate panel", () => {
    // The panel's sections are its configuration's (src/config/panels.ts, PANEL_LAYOUT), drawn by CandidateDetails.tsx through PanelLayout.
    const panel = readFileSync(join(ROOT, "src/components/CandidateDetails.tsx"), "utf8"), sections = PANEL_LAYOUT.candidate.flatMap((t) => t.sections.map((x) => x.id));
    expect(CV_PLAN.map((s) => s.id)).toEqual(["identity", "summary", "skills", "education", "experience", "projects", "notable"]);
    const place: Record<string, string> = { summary: "summary", skills: "skills", education: "education", experience: "work", projects: "projects", notable: "notes" };
    for (const s of CV_PLAN.filter((x) => x.id !== "identity")) expect(sections.filter((id) => id === place[s.id]), `${s.id} has exactly one place on the panel`).toHaveLength(1);
    expect(panel).toContain('<PanelLayout kind="candidate"');
    expect(CV_PLAN[0].id).toBe("identity");                                                      // the person's name and contact details come first, as the panel's header and Overview do
  });

  test("every document reports every step in plan order, and a step that found nothing says everything it tried", async () => {
    const samples = ["cvs/cv01-thandi-mokoena.docx", "cvs/cv16-michael-chen.txt", "cvs/cv10-emma-fourie.docx"];
    for (const rel of samples) {
      const { readDocument } = await import("../src/parse"), { sniff } = await import("../src/formats");
      const bytes = new Uint8Array(readFileSync(join(ROOT, "sample-documents", rel)));
      const e: any = await extractCandidate((await readDocument(bytes, sniff(bytes)!)).text, { asOf: AS_OF });
      expect(e.meta.sections.map((s: any) => s.step), rel).toEqual(CV_PLAN.map((s) => s.id));
      for (const s of e.meta.sections) {
        expect(s.tried.length, `${rel} ${s.step}`).toBeGreaterThan(0);
        if (s.status === "found") { expect(s.via, `${rel} ${s.step}`).toBeTruthy(); expect(s.count).toBeGreaterThan(0); expect(s.tried[s.tried.length - 1]).toBe(s.via); }
        else expect(s.via).toBe("");
      }
    }
  });

  test("a CV with no Education heading still has its qualifications found: the reader looks elsewhere before giving up", async () => {
    const cv = `Lerato Zulu\nlerato.zulu@example.test | 071 555 0103\nExperience\nClerk, City Council (Feb 2015 - Present)\nFiled records.\nMy Learning Journey\nBCom Law, University of Johannesburg, 2012 - 2014\nSkills\nFiling, Excel, Data entry`;
    const e: any = await extractCandidate(cv, { asOf: AS_OF });
    expect(e.record.education.map((x: any) => x.degree)).toEqual(["BCom Law"]);
    const step = e.meta.sections.find((s: any) => s.step === "education");
    expect(step.status).toBe("found"); expect(step.via).toMatch(/anywhere in the document/); expect(step.tried.length).toBe(3); // the heading was tried first, then the other places, in order
  });

  test("a CV with no qualifications at all says so, with what was checked, and is not made to look complete", async () => {
    const cv = `Zodwa Mthembu\nzodwa@example.test | 071 555 0104\nExperience\nCleaner, Sunrise Hotel (Jan 2010 - Present)\nCleaned rooms.\nSkills\nCleaning, Teamwork, Time management`;
    const e: any = await extractCandidate(cv, { asOf: AS_OF });
    expect(e.record.education).toEqual([]);
    expect(e.meta.sections.find((s: any) => s.step === "education")).toMatchObject({ status: "not_found", count: 0 });
    expect(e.meta.sections.find((s: any) => s.step === "education").tried.length).toBe(3);   // heading, outside the work history, anywhere in the document
  });
});

describe("the reader behaves the same every time", () => {
  test("the frozen outputs still match: any change in behaviour is deliberate, versioned and reviewed", async () => {
    const manifest = JSON.parse(readFileSync(join(GOLDEN_DIR, "MANIFEST.json"), "utf8"));
    const live = await computeGolden();
    const frozenDir = join(GOLDEN_DIR, "files");
    const frozen = Object.fromEntries(readdirSync(frozenDir).map((f) => [f, readFileSync(join(frozenDir, f), "utf8")]));
    expect(Object.keys(live).sort(), "the set of documents").toEqual(Object.keys(frozen).sort());
    // Frozen on macOS. OCR of these photos differs on Linux, sometimes for the better ("tindiwe.diamini@" on macOS, "lindiwe.dlamini@" on Linux; CI runs of 2026-11-03), so off macOS they are held
    // to the name being read rather than to an exact match. Named one by one: a difference in any other document fails. Production runs on Linux, so these need freezing there. Register R43.
    const OCR_VARIES_BY_PLATFORM = new Set(["photo-phone-good.json", "photo-phone-poor.json"]);
    const comparable = (name: string, json: string) => (process.platform !== "darwin" && OCR_VARIES_BY_PLATFORM.has(name) ? JSON.stringify({ name: JSON.parse(json).record?.name }) : json);
    for (const name of Object.keys(live)) expect(comparable(name, live[name]), `${name}: the reader now produces something different. If that is intended, bump PARSER_VERSION in src/version.ts, say why in EXTRACTION_CONTRACT.md, then run npm run golden:update and review the diff`).toBe(comparable(name, frozen[name]));
    expect(hashOf(frozen)).toBe(manifest.outputsHash);
    expect(manifest.parserVersion, "the frozen outputs were made by a different parser version: run npm run golden:update").toBe(PARSER_VERSION);
  }, 300000);

  test("the answer does not depend on the process: a fresh process produces byte-identical output", () => {
    const sample = join(ROOT, "sample-documents/cvs/cv16-michael-chen.doc");
    const run = () => execFileSync(process.execPath, ["--import", "tsx", join(GOLDEN_DIR, "oneshot.ts"), sample], { cwd: join(ROOT, "server"), encoding: "utf8" }).trim();
    expect(run()).toBe(run());
    const frozen = JSON.parse(readFileSync(join(GOLDEN_DIR, "files/cv-cv16-michael-chen.doc.json"), "utf8"));
    expect(JSON.parse(run()).record).toEqual(frozen.record);                                    // and it is the frozen answer
  }, 120000);

  test("every extracted record says which version of the reader and which day it used", async () => {
    const e: any = await extractCandidate("Test Person\ntest@example.test\nSkills\nExcel, Word, Filing, Typing", { asOf: AS_OF });
    expect(e.meta.parserVersion).toBe(PARSER_VERSION);
    expect(e.meta.asOf).toBe("2026-10-21");
  });

  test("the contract document exists and names the same version and steps the code uses", () => {
    const path = join(ROOT, "docs/parser/EXTRACTION_CONTRACT.md");
    expect(existsSync(path)).toBe(true);
    const doc = readFileSync(path, "utf8");
    expect(doc).toContain(`Current parser version: **${PARSER_VERSION}**`);
    for (const step of CV_PLAN) expect(doc, step.label).toContain(step.label);
  });
});

describe("what a status may claim", () => {
  test("no entry says it was finished, or not, without the words or year that support it", async () => {
    const dir = join(GOLDEN_DIR, "files");
    for (const f of readdirSync(dir).filter((x) => x.startsWith("cv-"))) {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")).record;
      for (const e of rec.education ?? []) {
        expect(["completed", "in_progress", "not_completed", "not_stated"], f).toContain(e.status);
        if (e.status !== "not_stated") expect(e.statusEvidence, `${f}: ${e.degree}`).not.toBe("");
        else expect(e.statusEvidence, `${f}: ${e.degree}`).toBe("");
        expect(["degree", "diploma", "school", "certificate", "other"], f).toContain(e.type);
      }
    }
  });
});

// Job descriptions no longer follow the word-rule plan: Claude labels every line (src/jobReader.ts; test/job-reader.test.ts).

