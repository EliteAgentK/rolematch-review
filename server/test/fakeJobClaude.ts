// A stand-in for Claude for the whole test run, on this machine only: job descriptions are read by Claude alone (src/jobReader.ts), so every test that uploads a
// job needs an answer to the job reader's two questions (and the department question, for candidates). Nothing leaves the machine and nothing is paid. It answers only those two questions (the facts, and
// one label per numbered line) with a plain, predictable reading; any other question is refused, so a test that reaches the AI for anything else finds out.
// This is a test double, not a reader: the product has no word rules for jobs. It is started once by test/globalSetup.ts and given to every test server.
import { createServer, type Server } from "node:http";
import { DEPARTMENT_ENUM } from "../src/jobReader";

export const FAKE_CLAUDE_PORT = Number(process.env.FAKE_CLAUDE_PORT ?? 18901);
export const FAKE_CLAUDE_URL = `http://127.0.0.1:${FAKE_CLAUDE_PORT}`;
export const FAKE_CLAUDE_KEY = "sk-ant-test-not-a-real-key";

const NAME_OF_DOCUMENT = /^(job description|position description|vacancy|job advert|role profile|position profile|job specification)$/i;
const SECTION: [RegExp, string][] = [
  [/prefer|advantag|desirab|bonus|nice to have|a plus/i, "preferred"], [/requir|qualif|essential|minimum|must|what you need|skills|experience|criteria/i, "requirement"],
  [/respons|duties|accountab|what you will do|key result/i, "responsibility"], [/about the role|purpose|overview|summary|the role/i, "summary"], [/competenc/i, "competency"],
];
const isHeading = (l: string) => l.length <= 60 && !/[.;]$/.test(l) && !/^[-•*]/.test(l) && l.split(/\s+/).length <= 8;

// ---- the CV reader's double
const CV_SECTIONS: [RegExp, string][] = [[/^(work |professional |employment )?(experience|history)|^employment|^career/i, "experience"], [/^(education|qualifications|academic)/i, "education"], [/^(certificat|courses|training|licen)/i, "certificate"],
  [/^(skills|technical skills|competenc|tools)/i, "skill"], [/^languages/i, "language"], [/^(summary|profile|objective|about)/i, "summary"], [/^(projects)/i, "project"], [/^(awards|achievements|publications|volunteer)/i, "notable"], [/^(references|referees)/i, "referee"]];
const cvHeading = (t: string) => (t.length <= 40 && !/[.,;|@\d]/.test(t) ? CV_SECTIONS.find(([re]) => re.test(t))?.[1] ?? "" : "");
const ROLE_LINE = /^(.+?)\s*[,|]\s*(.+?)\s*[,|]\s*((?:\p{L}+ )?(?:19|20)\d{2})\s*[-–]\s*(Present|Current|(?:\p{L}+ )?(?:19|20)\d{2})\s*$/iu;
const emptyReading = () => ({ headline: "", roles: [] as { title: string; employer: string; start: string; end: string; lines: number[] }[], education: [] as object[], certifications: [] as string[], skills: [] as string[], languages: [] as string[], location: "", agency: { name: "", recruiter: "", recruiterEmail: "", recruiterPhone: "" } });

/** The double's reading of numbered lines: the first real line is the title, "Label: value" lines are facts, a heading sets what the lines under it are. */
export function jobAnswer(system: string, user: string): object {
  const lines = [...user.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2].trim() }));
  const only = user.match(/Label only these lines, which were left out: ([\d, ]+)\./)?.[1].split(",").map((x) => Number(x.trim()));
  const first = lines.find((l) => !NAME_OF_DOCUMENT.test(l.text));
  // Matching, as live runs it (the rehearsal matches with the AI on, so the Overview's strongest matches can be clicked like the owner does): the job is
  // briefed into requirements that each quote one of its own lines, then a candidate is scored against them. A stand-in answer: it shows the path works,
  // it judges nobody.
  if (/briefing yourself on ONE job/.test(system)) {
    const own = user.split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter((l) => l.split(/\s+/).length >= 2 && l.length <= 150).slice(1, 4);
    return { role: "A stand-in brief.", seniority: "senior", industry: "general", requirements: own.map((l) => ({ requirement: l, kind: "skill", mandatory: false, importance: "important", quote: l, fair: true, fairness: "" })) };
  }
  if (/assessing ONE candidate against ONE job/.test(system)) {
    const ids = [...user.matchAll(/^(r\d+) \[/gm)].map((m) => m[1]);
    return { requirements: ids.map((id) => ({ id, state: "not_demonstrated", supportIds: [], counterIds: [], inferred: false, reason: "A stand-in answer.", explanation: "" })), career: { seniority: "matches", industry: "same", recency: "current", note: "" },
      score: 40, confidence: "Low", confidenceReasons: ["A stand-in answer."], strengths: [], gaps: ids.slice(0, 1), actions: [], summary: "A stand-in answer from the rehearsal's Claude." };   // nothing shown, so a low score: a higher one is refused by the answer's checks (code review, 16 Nov 2026, C-M6)
  }
  if (system.includes("Give the job's facts")) {
    const fact = (re: RegExp) => { const l = lines.find((x) => re.test(x.text)); const v = l?.text.replace(re, "").trim(); return l && v ? { line: l.n, value: v } : { line: 0, value: "" }; };
    return { title: first ? { line: first.n, value: first.text } : { line: 0, value: "" }, company: fact(/^(company|employer)\s*:\s*/i), department: fact(/^department\s*:\s*/i),
      location: fact(/^location\s*:\s*/i), workArrangement: fact(/^work(ing)? (arrangement|model)\s*:\s*/i), employmentType: fact(/^employment( type)?\s*:\s*/i),
      remuneration: fact(/^(salary|remuneration|pay)\s*:\s*/i), reportsTo: fact(/^reports to\s*:\s*/i), otherFacts: [], writtenSummary: "", skills: [] };
  }
  if (system.includes("Label every line") && system.includes("job description")) {
    let part = "extra", heading = 0;
    const out = lines.map((l) => {
      if (l === first || NAME_OF_DOCUMENT.test(l.text)) return { n: l.n, part: l === first ? "fact" : "skip", item: l.n, heading: 0 };
      if (/^[^:]{2,30}:\s*\S/.test(l.text) && part === "extra" && !heading) return { n: l.n, part: "fact", item: l.n, heading: 0 };
      if (isHeading(l.text)) { const s = SECTION.find(([re]) => re.test(l.text)); part = s ? s[1] : "extra"; heading = l.n; return { n: l.n, part: "heading", item: l.n, heading: 0 }; }
      return { n: l.n, part, item: l.n, heading };
    });
    return { lines: only ? out.filter((x) => only.includes(x.n)) : out };
  }
  // The department question (src/department.ts): a plain choice from the words of the headline, so a test can see a candidate placed.
  if (system.includes("You place one candidate in the department") || system.includes("You place one job in the department")) {
    const pick = /engineer|developer|software|technolog|\bit\b/i.test(user) ? "Technology" : /account|financ|payroll|audit/i.test(user) ? "Finance" : "Other";
    return { group: [DEPARTMENT_ENUM.find((d) => d.startsWith(`${pick}:`))] };
  }
  // A CV, read by Claude alone since 10 Nov 2026 (src/cvReader.ts): the reading, the person's own details, the summary and a label for every line. A plain,
  // predictable double for invented documents: a job is a line "Title, Employer, 2016 - 2024" (or with "|"), a heading sets what the lines under it are.
  if (/one part of the CV/.test(system)) return emptyReading();   // a second look at a part: the double has nothing to add
  if (/write a short career summary/.test(system)) return { profile: "", written: [] };
  if (/each written in capital letters/.test(system)) return { written: [] };   // how capitals are normally written: the double leaves them as they are
  if (/Give the person this CV is about/.test(system)) {
    // An e-mail that a narrow column wrapped onto the next line ("…@candidate.exam" / "ple") is read whole, as a person reading the CV would.
    const at = lines.findIndex((l) => /@/.test(l.text)), found = lines[at]?.text.match(/[^\s|,;]+@[^\s|,;]+/)?.[0] ?? "", tail = lines[at + 1]?.text ?? "";
    const email = found + (found && lines[at].text.trim() === found && /^[a-z]{1,6}$/.test(tail) ? tail : ""), phone = lines.map((l) => l.text.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0] ?? "").find((x) => x.replace(/\D/g, "").length >= 9) ?? "";
    // The person's name: a line that is only a name, or one after a label ("Candidate Name: Aisha Agency"), as an agency's form gives it.
    const asName = (t: string) => t.replace(/^(?:candidate(?:'s)? name|name(?: and surname)?|full name)\s*[:|]\s*/i, "");
    const name = lines.map((l) => asName(l.text)).find((t) => /^[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’-]*){1,3}$/u.test(t) && !cvHeading(t)) ?? "";
    return { name, email, phone, location: "" };
  }
  if (/You label the lines of one CV/.test(system)) {
    let section = "other"; const runs: { from: number; to: number; label: string }[] = [];
    for (const l of lines) {
      const h = cvHeading(l.text);
      const label = h ? "heading" : /@/.test(l.text) || l.n === lines[0]?.n ? "personal" : section === "experience" ? (ROLE_LINE.test(l.text) ? "job_title" : "duty") : section;
      if (h) section = h;
      const last = runs[runs.length - 1];
      if (last && last.label === label && last.to === l.n - 1) last.to = l.n; else runs.push({ from: l.n, to: l.n, label });
    }
    return { runs: only ? runs.flatMap((r) => only.filter((n) => n >= r.from && n <= r.to).map((n) => ({ from: n, to: n, label: r.label }))) : runs };
  }
  if (/You read one CV, given as numbered lines, and list what it says/.test(system)) {
    let section = "other"; const r = emptyReading();
    for (const l of lines) {
      const h = cvHeading(l.text); if (h) { section = h; continue; }
      const m = l.text.match(ROLE_LINE);
      if (m && section !== "education" && section !== "certificate") { r.roles.push({ title: m[1].trim(), employer: m[2].trim(), start: m[3].trim(), end: m[4].trim(), lines: [l.n] }); continue; }
      if (section === "education") r.education.push({ qualification: l.text.split(",")[0].trim(), institution: (l.text.split(",")[1] ?? "").trim(), year: l.text.match(/(?:19|20)\d{2}/)?.[0] ?? "", status: /(?:19|20)\d{2}/.test(l.text) ? "completed" : "not_stated", statusWords: l.text.match(/(?:19|20)\d{2}/)?.[0] ?? "", lines: [l.n] });
      else if (section === "certificate") r.certifications.push(l.text);
      else if (section === "skill") r.skills.push(...l.text.split(/[,;|]/).map((x) => x.trim()).filter(Boolean));
      else if (section === "language") r.languages.push(...l.text.split(/[,;|]/).map((x) => x.trim()).filter(Boolean));
    }
    r.headline = r.roles[0]?.title ?? "";
    // An agency's cover details ("Consultants Name | Peter Smith"), as an agency's form gives them: its name, its consultant and how to reach them.
    const field = (re: RegExp) => lines.map((l) => l.text.match(re)?.[1]?.trim()).find(Boolean) ?? "";
    const recruiter = field(/^consultants?(?:'s)? name\s*[:|]\s*(.+)$/i);
    if (recruiter) (r as any).agency = { name: lines.find((l) => /\b(recruit\w*|staffing|personnel)\b/i.test(l.text) && !/consultant|contact/i.test(l.text))?.text ?? "", recruiter,
      recruiterEmail: field(/^consultants?(?:'s)? e-?mail\s*[:|]\s*(.+)$/i), recruiterPhone: field(/^consultants?(?:'s)? (?:number|phone|tel\w*)\s*[:|]\s*(.+)$/i) };
    return r;
  }
  throw new Error("the test Claude answers only the job reader's, the CV reader's, the department and the matching questions");
}

export function startFakeJobClaude(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const b = JSON.parse(body || "{}"), system = (b.system ?? []).map((s: any) => s.text ?? s).join("\n"), user = String(b.messages?.[0]?.content ?? "");
        const text = JSON.stringify(jobAnswer(system, user));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: b.model ?? "claude-haiku-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: Math.ceil(user.length / 4), output_tokens: Math.ceil(text.length / 4) } }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: String((e as Error).message) } }));
      }
    });
  });
  return new Promise((ok, fail) => { server.once("error", fail); server.listen(FAKE_CLAUDE_PORT, "127.0.0.1", () => ok(server)); });
}
