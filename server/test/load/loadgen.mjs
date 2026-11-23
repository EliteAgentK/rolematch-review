// A crowd for the isolated stack: each virtual user signs in, opens the board and keeps it open the way the real page does, polling on the page's own timers, and now and then does something.
// No dependencies, so it runs on a separate machine with a portable Node. Every request has a timeout; nothing is retried, so throttling shows in the figures.
//   node loadgen.mjs --base http://host:18795 --origin http://localhost:18795 --accounts accounts.json --steps 1,10,50,100 --hold 180 --ramp 30 --out results.jsonl [--pdf CV.pdf] [--uploads 0.02] [--matches 0.1] [--only-org N] [--busy-org N]
// It refuses an address it was not told is disposable: --i-know-this-is-disposable must be given, and the accounts file must be made by test/load/seed.ts (all @load.invalid).
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i < 0 ? dflt : process.argv[i + 1]; };
const flag = (name) => process.argv.includes("--" + name);
if (!flag("i-know-this-is-disposable")) { console.error("Refusing: this is only for the disposable stack."); process.exit(2); }
const BASE = arg("base"), ORIGIN = arg("origin", BASE), OUT = arg("out"), STEPS = arg("steps", "1").split(",").map(Number), HOLD = Number(arg("hold", 180)) * 1000, RAMP = Number(arg("ramp", 30)) * 1000;
const UPLOADS = Number(arg("uploads", 0)), MATCHES = Number(arg("matches", 0.1)), BUSY = arg("busy-org"), MAX_ERRORS = Number(arg("stop-at-error-rate", 0.5)), TIMEOUT = Number(arg("timeout", 30)) * 1000;
const { password, accounts: all } = JSON.parse(readFileSync(arg("accounts"), "utf8"));
if (!all.every((a) => a.email.endsWith("@load.invalid"))) { console.error("Refusing: accounts must be the invented ones."); process.exit(2); }
const SHARD = (arg("shard", "0/1")).split("/").map(Number), TARGETS = arg("targets", BASE).split(","), sessions = arg("sessions") ? JSON.parse(readFileSync(arg("sessions"), "utf8")) : null, IN_HAND = Number(arg("client-in-hand", 100000));
// With several shards, each carries its share of people, and its own part of each step. Sessions already open let a crowd start without signing in. Several targets test more than one API server, each person staying on one.
const everyone = arg("only-org") ? all.filter((a) => a.org.endsWith(` org ${arg("only-org")}`)) : all;
const accounts = everyone.filter((_, i) => i % SHARD[1] === SHARD[0]);
const CAPACITY_EVERY = Number(arg("capacity-every", 15)) * 1000, OTHERS_EVERY = Number(arg("others-every", 30)) * 1000;   // the page's own timers while nothing is moving
const pdf = arg("pdf") ? readFileSync(arg("pdf")) : null;
// --pack <dir>: real documents from an invented pack (dir/cv, dir/jd), named as in the pack so what was read can be scored against its answer key afterwards. --everything: the whole platform, not only reading.
const WORKDAY = flag("workday"), PACE = Number(arg("pace", 1)), SIGNIN_SHARE = Number(arg("signin-share", 0.02)), PACK = arg("pack"), EVERYTHING = flag("everything"), second = arg("accounts-2") ? JSON.parse(readFileSync(arg("accounts-2"), "utf8")) : null, passwordTwo = second?.password, secondSet = new Set((second?.accounts ?? []).map((a) => a.email));
const packFiles = (kind) => (PACK ? readdirSync(join(PACK, kind)).map((f) => join(PACK, kind, f)) : []);
const cvFiles = packFiles("cv"), jdFiles = packFiles("jd");
const pickBytes = (list) => { const path = pick(list); return { name: path.split(/[\\/]/).pop(), bytes: readFileSync(path) }; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
let stopping = false, window_ = new Map(), step = 0, active = 0, inFlight = 0, down = 0, checked = 0, leaks = 0, clientWaits = 0;
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
function note(op, org, ms, status) {
  const key = op; let w = window_.get(key); if (!w) window_.set(key, (w = { times: [], status: {}, orgs: {} }));
  w.times.push(ms); w.status[status] = (w.status[status] ?? 0) + 1;
  (w.orgs[org] ??= []).push(ms);
}
class User {
  constructor(a, n) { this.index = n; this.a = a; this.cookie = sessions?.[a.email] ?? ""; this.candidates = []; this.jobs = []; this.alive = true; this.target = TARGETS[n % TARGETS.length]; }
  async call(op, path, init = {}) {
    const t0 = performance.now(); let status = "error", code = ""; inFlight++;
    try {
      while (inFlight > IN_HAND) { clientWaits++; await sleep(50); }
      const res = await fetch(this.target + path, { ...init, headers: { origin: ORIGIN, "x-forwarded-for": this.a.ip, "x-portal-id": this.a.portal, cookie: this.cookie, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT), redirect: "manual" });
      status = res.status;
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) { const jar = new Map(this.cookie ? this.cookie.split("; ").map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]) : []); for (const c of set) { const kv = c.split(";")[0], i = kv.indexOf("="); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)); } this.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; "); }
      const text = await res.text();
      if (status >= 400) { try { const e = JSON.parse(text)?.error; code = e?.code ?? ""; if (code === "RATE-001") code += `(${String(e.message).split(/\s+/).slice(0, 5).join(" ")})`; } catch { /* not ours: a proxy or a crash */ } }
      return { status, body: text };
    } catch (e) { status = e?.name === "TimeoutError" ? "timeout" : "conn-error"; return { status, body: "" }; }
    finally { inFlight--; note(op, this.a.org, performance.now() - t0, code ? `${status}:${code}` : status); }
  }
  async open() {
    await this.call("page.me", "/api/auth/me"); await this.call("page.portals", "/api/portals"); await this.call("page.settings", "/api/settings");
    const c = await this.call("board.candidates", "/api/candidates?limit=100"), j = await this.call("board.jobs", "/api/jobs?limit=100");
    try { const items = JSON.parse(c.body).items; this.candidates = items.map((x) => x.id); this.jobs = JSON.parse(j.body).items.map((x) => x.id); this.checkOwn(items); } catch { /* counted above */ }
  }
  // Every seeded candidate's address names their organisation, so an answer holding anyone else's is a separation failure. A CV uploaded during the run has the document's own address and is not covered here: check those against the database afterwards.
  checkOwn(items) { const mine = `.o${this.a.org.split(" org ")[1]}@`; for (const x of items) { checked++; if (x.email?.endsWith("@load.invalid") && !x.email.includes(mine)) { leaks++; console.log(`SEPARATION FAILURE: ${this.a.org} saw ${x.id}`); } if (this.a.role === "hiring_manager" && x.status !== "shortlisted") { leaks++; console.log(`ROLE FAILURE: a hiring manager saw status ${x.status}`); } } }
  async poll(op, path, every) { while (this.alive && !stopping) { await sleep(every * (0.9 + Math.random() * 0.2)); if (this.alive && !stopping) await this.call(op, path); } }
  async act() {
    const busy = BUSY !== undefined && this.a.org.endsWith(` org ${BUSY}`);
    while (this.alive && !stopping) {
      await sleep((busy ? 5_000 : 30_000) * (0.5 + Math.random()));
      if (!this.alive || stopping) return;
      const r = Math.random();
      if (r < 0.35) { const s = await this.call("search", `/api/candidates?limit=25&q=${pick(["accountant", "excel", "thandi", "reporting"])}`); try { this.checkOwn(JSON.parse(s.body).items); } catch { /* counted above */ } }
      else if (r < 0.6 && this.candidates.length) await this.call("open.candidate", `/api/candidates/${pick(this.candidates)}`);
      else if (r < 0.7 && this.jobs.length) await this.call("open.job", `/api/jobs/${pick(this.jobs)}`);
      else if (r < 0.8) { await this.call("team", "/api/portal/members"); await this.call("history", "/api/history/activity"); }
      else if (r < 0.8 + MATCHES && this.a.role !== "hiring_manager" && this.candidates.length && this.jobs.length) await this.call("match", "/api/matches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId: pick(this.candidates), jobId: pick(this.jobs) }) });
      else if (pdf && Math.random() < UPLOADS * (busy ? 10 : 1) && this.a.role !== "hiring_manager") {
        const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([pdf, `\n%${crypto.randomUUID()}\n`], `load-${crypto.randomUUID().slice(0, 8)}.pdf`, { type: "application/pdf" }));   // a comment after the end keeps the file valid and makes it new
        await this.call("upload", "/api/documents", { method: "POST", body: f });
      }
    }
  }
  // The whole platform, as a working day has it: people read and search, edit and match in both directions, upload CVs and job descriptions singly and in batches, sign in, and hiring managers are refused what they may not do.
  async actAll() {
    const busy = BUSY !== undefined && this.a.org.endsWith(` org ${BUSY}`), hr = this.a.role === "hiring_manager", json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    while (this.alive && !stopping) {
      await sleep((busy ? 5_000 : 30_000) * (0.5 + Math.random()));
      if (!this.alive || stopping) return;
      let x = 0; const r = Math.random(), is = (p) => r < (x += p), C = this.candidates, J = this.jobs;
      if (is(0.2)) { const s = await this.call("search", `/api/candidates?limit=25&q=${pick(["accountant", "excel", "reporting", "engineer", "project", "java"])}`); try { this.checkOwn(JSON.parse(s.body).items); } catch { /* counted above */ } }
      else if (is(0.16) && C.length) await this.call("open.candidate", `/api/candidates/${pick(C)}`);
      else if (is(0.06) && J.length) await this.call("open.job", `/api/jobs/${pick(J)}`);
      else if (is(0.05)) { await this.call("team", "/api/portal/members"); await this.call("history", "/api/history/activity"); }
      else if (is(0.03)) { await this.call("settings", "/api/settings"); await this.call("usage", "/api/usage"); }
      else if (is(0.02) && C.length && !hr) await this.call("audit.trail", `/api/audit?entityId=${pick(C)}`);
      else if (is(MATCHES) && C.length && J.length) {
        if (hr) await this.call("saved.match", `/api/matches?candidateId=${pick(C)}&jobId=${pick(J)}`);
        else await this.call("match", "/api/matches", { method: "POST", ...json({ candidateId: pick(C), jobId: pick(J) }) });
      }
      else if (is(MATCHES / 10) && !hr && C.length && J.length) await this.call(Math.random() < 0.5 ? "match.candidate-to-jobs" : "match.job-to-candidates", "/api/matches/bulk", { method: "POST", ...json(Math.random() < 0.5 ? { candidateId: pick(C) } : { jobId: pick(J) }) });
      else if (is(0.04) && C.length) await this.call("saved.match", `/api/matches?candidateId=${pick(C)}&jobId=${pick(J.length ? J : C)}`);
      else if (is(0.05) && C.length) {
        if (hr) { await this.call("hr.edit-refused", `/api/candidates/${pick(C)}`, { method: "PUT", ...json({ status: "reviewed", version: 1 }) }); continue; }
        const id = pick(C), got = await this.call("open.candidate", `/api/candidates/${id}`); let c; try { c = JSON.parse(got.body); } catch { continue; }
        if (c?.version) await this.call("edit.status", `/api/candidates/${id}`, { method: "PUT", ...json({ status: pick(["new", "shortlisted", "interviewed", "hired"]), version: c.version }) });
      }
      else if (is(UPLOADS * (busy ? 10 : 1)) && cvFiles.length) {
        if (hr) { await this.call("hr.upload-refused", "/api/documents", { method: "POST", body: this.form("cv", pickBytes(cvFiles)) }); continue; }
        await this.call("upload.cv", "/api/documents", { method: "POST", body: this.form("cv", pickBytes(cvFiles)) });
      }
      else if (is(UPLOADS / 4) && jdFiles.length && !hr) await this.call("upload.jd", "/api/documents", { method: "POST", body: this.form("jd", pickBytes(jdFiles)) });
      else if (is(UPLOADS / 10) && cvFiles.length && !hr) {
        const docs = Array.from({ length: 3 }, () => pickBytes(cvFiles)), made = await this.call("batch.create", "/api/batches", { method: "POST", ...json({ kind: "cv", files: docs.length, bytes: docs.reduce((n, d) => n + d.bytes.length, 0) }) });
        let id; try { id = JSON.parse(made.body).id; } catch { continue; }
        if (id) for (const d of docs) await this.call("batch.upload", `/api/documents?batch=${id}&name=${encodeURIComponent(d.name)}`, { method: "POST", body: this.form("cv", d) });
      }
      else if (is(0.002)) {   // someone signing in again: their own session is replaced, as a browser's would be
        const pw = secondSet.has(this.a.email) ? passwordTwo : password;
        await this.call("sign-in", "/api/auth/login", { method: "POST", ...json({ email: this.a.email, password: pw }) });
      }
    }
  }
  // ---------------------------------------------------------------- a working week beginning: people with jobs to do, not robots browsing
  // Each person has one job for the morning and keeps at it, at a person's pace: read, think, act. The page's own timers run beside it, and a batch follows the browser's own sender exactly (src/utils/batchUpload.ts).
  persona() {
    if (this.a.role === "hiring_manager") return "hiring";
    if (this.a.role === "admin") return "administrating";
    const r = this.index % 20;
    return r < 6 ? "uploading" : r < 13 ? "reviewing" : "matching";
  }
  async pause(from, to) { const end = Date.now() + (from + Math.random() * (to - from)) * 1000 * PACE; while (Date.now() < end && this.alive && !stopping) await sleep(Math.min(1000, end - Date.now())); }
  json(body) { return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }
  /** What a person sees when they open the page: every page of both lists, as the browser reads them. */
  async reload(fresh) {
    const read = async (path, op, keep) => { let cursor = null, ids = []; for (let i = 0; i < 50; i++) { const r = await this.call(op, `${path}?limit=100${fresh ? "&fresh=1" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); try { const b = JSON.parse(r.body); keep?.(b.items); ids.push(...b.items.map((x) => x.id)); cursor = b.nextCursor; } catch { break; } if (!cursor) break; } return ids; };
    this.candidates = await read("/api/candidates", "board.candidates", (items) => this.checkOwn(items)); this.jobs = await read("/api/jobs", "board.jobs");
  }
  async workday() {
    const job = this.persona();
    if (Math.random() < SIGNIN_SHARE) { const pw = secondSet.has(this.a.email) ? passwordTwo : password; await this.call("signin.monday", "/api/auth/login", { method: "POST", ...this.json({ email: this.a.email, password: pw }) }); }
    await this.call("page.me", "/api/auth/me"); await this.call("page.portals", "/api/portals"); await this.call("page.settings", "/api/settings");
    await this.reload(false);
    while (this.alive && !stopping) { try { await this[job](); } catch { /* counted where it happened */ } await this.pause(20, 90); }
  }
  /** A size someone would really send: often a few files, sometimes a folder of hundreds. */
  batchSize() { const n = Math.random(); return n < 0.25 ? 2 + Math.floor(Math.random() * 4) : n < 0.55 ? 6 + Math.floor(Math.random() * 20) : n < 0.8 ? 26 + Math.floor(Math.random() * 45) : n < 0.93 ? 71 + Math.floor(Math.random() * 130) : 201 + Math.floor(Math.random() * 200); }
  unique(path) { const b = readFileSync(path), name = path.split(/[\\/]/).pop(); return path.endsWith(".pdf") ? { name, bytes: Buffer.concat([b, Buffer.from(`\n%${crypto.randomUUID()}\n`)]) } : { name, bytes: b }; }   // a comment after a PDF's end keeps the file valid and its contents the same, and it is a new upload rather than one the portal already holds
  async uploading() {
    const kind = Math.random() < 0.9 ? "cv" : "jd", list = kind === "cv" ? cvFiles : jdFiles;
    if (!list.length) return;
    const size = kind === "jd" ? 2 + Math.floor(Math.random() * 12) : this.batchSize(), chosen = Array.from({ length: size }, () => pick(list)), t0 = performance.now();
    let id, bytes = 0; for (const f of chosen.slice(0, 40)) bytes += statSync(f).size; bytes = Math.round((bytes / Math.min(40, size)) * size);
    const made = await this.call("batch.create", "/api/batches", { method: "POST", ...this.json({ kind, files: size, bytes, skipped: [], requestKey: crypto.randomUUID() }) });
    if (made.status === 409 || made.status === 429 || made.status === 503) { await this.pause(60, 180); return; }   // the portal's slots are full or it said wait: a person tries again later
    try { id = JSON.parse(made.body).id; } catch { return; } if (!id) return;
    // The browser's sender: three lanes, and never more than eight of this batch waiting or being read at once, by the server's own count.
    let next = 0, base = 0, since = 0, sending = 0, asking = null, stoppedEarly = false; const WINDOW = 8;
    const inFlight = async () => { const r = await this.call("batch.progress", `/api/batches/${id}`); try { const c = JSON.parse(r.body).counts; return c.waiting + c.processing; } catch { return WINDOW; } };
    const refresh = () => (asking ??= inFlight().then((n) => { base = n; since = 0; }).finally(() => { asking = null; }));
    await refresh();
    const lane = async () => {
      while (next < size && this.alive && !stopping && !stoppedEarly) {
        if (base + since + sending >= WINDOW) { await refresh(); if (base + since + sending >= WINDOW) await sleep(1500); continue; }
        const path = chosen[next++], d = this.unique(path); sending++;
        try {
          for (let busy = 0; ; busy++) {
            const r = await this.call("batch.upload", `/api/documents?batch=${id}&name=${encodeURIComponent(d.name)}`, { method: "POST", body: this.form(kind, d) });
            if (r.status < 300) { since++; break; }
            if ((r.status === 429 || r.status === 503) && busy < 20) { await sleep(Math.min(60_000, 5000 * (1 + 0.25 * busy)) * (1 + Math.random() * 0.2)); continue; }
            if (r.status === 409) stoppedEarly = true;
            break;
          }
        } finally { sending--; }
      }
    };
    await Promise.all([lane(), lane(), lane()]);
    // They watch it finish, as the panel does, then read the report and clear it.
    for (let i = 0; i < 900 && this.alive && !stopping; i++) { const n = await inFlight(); if (n === 0) break; await sleep(3000); }
    if (!this.alive || stopping) return;
    note(`batch.finished ${size < 26 ? "under 26" : size < 71 ? "26 to 70" : size < 201 ? "71 to 200" : "201 to 400"} files`, this.a.org, performance.now() - t0, 200);
    await this.call("batch.report", `/api/batches/${id}/report`); await this.call("batch.ack", `/api/batches/${id}/ack`, { method: "POST" }); await this.call("batch.close", `/api/batches/${id}/close`, { method: "POST" });
    await this.reload(true);
    for (const c of this.candidates.slice(0, Math.min(4, size))) { await this.reviewOne(c); }
  }
  /** Opening one candidate: reading them takes a moment, and sometimes the original CV. Then a decision and a note. */
  async reviewOne(id) {
    const got = await this.call("open.candidate", `/api/candidates/${id}`); let c; try { c = JSON.parse(got.body); } catch { return; }
    await this.pause(15, 50);
    if (Math.random() < 0.1 && c.documentId) await this.call("open.original", `/api/documents/${c.documentId}/original`);
    if (Math.random() < 0.4 && c.version) { const r = await this.call("edit.status", `/api/candidates/${id}`, { method: "PUT", ...this.json({ status: pick(["shortlisted", "interviewed", "hired", "declined"]), version: c.version }) }); try { c.version = JSON.parse(r.body).version ?? c.version; } catch { /* counted */ } await this.pause(2, 8); }
    if (Math.random() < 0.25 && c.version) await this.call("edit.notes", `/api/candidates/${id}`, { method: "PUT", ...this.json({ recruiterNotes: `Spoke on the phone ${new Date().toISOString().slice(0, 10)}. Follow up on notice period.`, version: c.version }) });
  }
  async reviewing() {
    if (!this.candidates.length) { await this.reload(true); await this.pause(30, 60); return; }
    if (Math.random() < 0.3) { const s = await this.call("search", `/api/candidates?limit=25&q=${pick(["accountant", "excel", "reporting", "engineer", "project", "java", "nurse", "audit"])}`); try { this.checkOwn(JSON.parse(s.body).items); } catch { /* counted */ } await this.pause(5, 15); }
    const start = Math.floor(Math.random() * this.candidates.length);
    for (const id of this.candidates.slice(start, start + 3 + Math.floor(Math.random() * 6))) { if (stopping || !this.alive) return; await this.reviewOne(id); }
    if (Math.random() < 0.2) { await this.call("history", "/api/history/activity"); await this.pause(5, 20); }
  }
  async matching() {
    const C = this.candidates, J = this.jobs; if (!C.length || !J.length) { await this.reload(true); await this.pause(30, 60); return; }
    const r = Math.random();
    if (r < 0.5) { // for one job, select the people one by one: put them in the slots, press Match, read why
      const job = pick(J); await this.call("open.job", `/api/jobs/${job}`); await this.pause(10, 30);
      for (let i = 0; i < 2 + Math.floor(Math.random() * 4) && this.alive && !stopping; i++) { await this.call("match", "/api/matches", { method: "POST", ...this.json({ candidateId: pick(C), jobId: job }) }); await this.pause(20, 70); }
    } else if (r < 0.75) { await this.call("match.job-to-candidates", "/api/matches/bulk", { method: "POST", ...this.json({ jobId: pick(J) }) }); await this.pause(30, 90); }
    else { await this.call("match.candidate-to-jobs", "/api/matches/bulk", { method: "POST", ...this.json({ candidateId: pick(C) }) }); await this.pause(30, 90); }
  }
  async administrating() {
    await this.call("team", "/api/portal/members"); await this.pause(10, 40);
    await this.call("history", "/api/history/activity"); await this.pause(10, 40);
    await this.call("usage", "/api/usage"); await this.call("settings", "/api/settings"); await this.pause(20, 60);
    if (Math.random() < 0.4) await this.uploading(); else await this.reviewing();
  }
  async hiring() {
    await this.reload(true);
    for (const id of this.candidates.slice(0, 5)) { if (stopping || !this.alive) return; await this.call("hr.open", `/api/candidates/${id}`); await this.pause(20, 60); if (this.jobs.length) await this.call("hr.saved-match", `/api/matches?candidateId=${id}&jobId=${pick(this.jobs)}`); await this.pause(10, 30); }
    await this.call("hr.edit-refused", `/api/candidates/${crypto.randomUUID()}`, { method: "PUT", ...this.json({ status: "reviewed", version: 1 }) });
    await this.pause(30, 90);
  }
  form(kind, d) { const f = new FormData(); f.append("kind", kind); f.append("file", new File([d.bytes], d.name)); return f; }
  async start() {
    if (!this.cookie) {
      const r = await this.call("sign-in", "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: this.a.email, password }) });
      if (r.status !== 200) { this.signInFailed = true; return false; }
    }
    if (!WORKDAY) await this.open();
    this.loops = [this.poll("poll.capacity", "/api/capacity", CAPACITY_EVERY), this.poll("poll.batches", "/api/batches", OTHERS_EVERY), this.poll("poll.documents", "/api/documents", OTHERS_EVERY), WORKDAY ? this.workday() : EVERYTHING ? this.actAll() : this.act()];
    return true;
  }
}
// The target says what it is, and only a disposable one is accepted, each time: a typed address cannot point a crowd at live.
for (const t of TARGETS) { const r = await fetch(t + "/api/ready", { signal: AbortSignal.timeout(15_000) }).then((x) => x.json()).catch(() => ({})); if (!["bench", "rehearsal"].includes(r.environment)) { console.error(`Refusing: ${t} says it is "${r.environment ?? "nothing"}", not a disposable environment.`); process.exit(2); } }
const users = []; let next = 0;
function summarise(label) {
  const out = { at: new Date().toISOString(), label, step: STEPS[step], active, inFlight, clientWaits, shard: SHARD[0], ops: {} }; let total = 0, bad = 0;
  for (const [op, w] of window_) {
    const t = w.times.sort((a, b) => a - b); total += t.length;
    const failed = Object.entries(w.status).filter(([s]) => { const n = Number(s.split(":")[0]); return !(n >= 200 && n < 400) && !(op.endsWith("refused") && n === 403); }).reduce((n, [, c]) => n + c, 0); bad += failed;
    const orgP95 = Object.values(w.orgs).map((x) => pct(x.sort((a, b) => a - b), 0.95));
    out.ops[op] = { n: t.length, p50: Math.round(pct(t, 0.5)), p95: Math.round(pct(t, 0.95)), p99: Math.round(pct(t, 0.99)), max: Math.round(t[t.length - 1] ?? 0), status: w.status, worstTenantP95: Math.round(Math.max(0, ...orgP95)), bestTenantP95: Math.round(orgP95.length ? Math.min(...orgP95) : 0) };
  }
  out.requests = total; out.failed = bad; out.errorRate = total ? +(bad / total).toFixed(4) : 0;
  appendFileSync(OUT, JSON.stringify(out) + "\n"); window_ = new Map();
  const reads = out.ops["poll.capacity"], board = out.ops["board.candidates"];
  console.log(`${out.at.slice(11, 19)} ${label} users ${active} req ${total} err ${(out.errorRate * 100).toFixed(1)}% capacity p95 ${reads?.p95 ?? "-"} board p95 ${board?.p95 ?? "-"} inflight ${inFlight}`);
  return out;
}
writeFileSync(OUT, "");
const every = setInterval(() => summarise("window"), 30_000);
for (step = 0; step < STEPS.length && !stopping; step++) {
  const target = Math.round(STEPS[step] / SHARD[1]), adding = target - active, gap = adding > 0 ? RAMP / adding : 0;
  console.log(`--- step ${STEPS[step]} users`);
  const starting = [];
  for (let i = 0; i < adding && !stopping; i++) {
    const u = new User(accounts[next % accounts.length], next); next++; users.push(u); active++;
    starting.push(u.start().then((ok) => { if (!ok) { active--; u.alive = false; } }));
    if (gap >= 1 || i % 50 === 0) await sleep(gap >= 1 ? gap : gap * 50);
  }
  await Promise.all(starting);
  summarise("ramp-end");
  const end = Date.now() + HOLD;
  while (Date.now() < end && !stopping) {
    await sleep(5000);
    try { const r = await fetch(BASE + "/api/ready", { signal: AbortSignal.timeout(10_000) }); if (r.status >= 500) throw new Error("not ready"); down = 0; } catch { down++; if (down >= 6) { console.log("The service has stopped answering: ending the run."); stopping = true; } }
  }
  const s = summarise("step-end");
  if (s.errorRate > MAX_ERRORS) { console.log(`Error rate ${s.errorRate}: stopping before the next step.`); stopping = true; }
}
// Recovery: the crowd leaves, and how long until one person gets a normal answer quickly? This is measured from the moment the load stops.
stopping = true; clearInterval(every); await sleep(1000);
summarise("end");
if (flag("recovery")) { const left = Date.now(); let ok = 0; for (let i = 0; i < 240 && ok < 5; i++) { const t = performance.now(); const u = users.find((x) => x.cookie); const r = await fetch(TARGETS[0] + "/api/capacity", { headers: { origin: ORIGIN, "x-portal-id": u.a.portal, "x-forwarded-for": u.a.ip, cookie: u.cookie }, signal: AbortSignal.timeout(10_000) }).catch(() => null); ok = r?.ok && performance.now() - t < 500 ? ok + 1 : 0; await r?.text(); await sleep(500); } console.log(`Recovery: normal answers ${((Date.now() - left) / 1000).toFixed(1)} s after the crowd left.`); }
console.log(`Done: ${users.filter((u) => u.signInFailed).length} of ${users.length} could not sign in.`);
console.log(`Separation: ${checked} records checked, ${leaks} seen by the wrong organisation or role.`);
process.exit(0);
