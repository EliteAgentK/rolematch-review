// One recruiter's working minute in RoleMatch, for k6 (docs/ops/TRENDS_AND_LOAD.md). The same journey runs under every crowd shape (profiles.js), as
// "Why Test Twice?" (Sarah, 2023) recommends: one script of what a person does, many shapes of how many do it. Run through load/run.sh, never by hand
// against live: it needs the load target's accounts, which exist only in the PC's test database.
// Each pretend recruiter signs in once, then over and over: opens the candidate list, opens one candidate, writes a note on them, opens the jobs list,
// and one time in four (every time in a smoke run) uploads a CV and waits for it to be read. Pauses between steps are a person's, not a machine's.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { profile } from "./profiles.js";

const BASE = __ENV.BASE || "http://127.0.0.1:18799";
const { accounts, password } = JSON.parse(open(__ENV.ACCOUNTS));
// Invented CVs only (sample-documents/cvs: every person and address is made up). Each upload gets a unique comment after the PDF's end, so it is a new
// document to read, not a duplicate answered at once.
const CVS = ["cv03-lindiwe-dlamini.pdf", "cv06-aisha-patel.pdf", "cv09-kevin-naidoo.pdf"].map((f) => ({ name: f, bytes: new Uint8Array(open(`../sample-documents/cvs/${f}`, "b")) }));

export const options = profile(__ENV.PROFILE || "smoke");
// One upload in four; the smoke run always uploads, so one journey proves every step.
const UPLOAD_SHARE = (__ENV.PROFILE || "smoke") === "smoke" ? 1 : 0.25;
const cvRead = new Trend("cv_read_seconds"), cvReadOk = new Rate("cv_read_ok");
const JSON_HEADERS = { "content-type": "application/json" };
let signedIn = false;

const list = (r) => { try { const b = r.json(); return Array.isArray(b) ? b : (b.items ?? []); } catch { return []; } };
const think = (from, to) => sleep(from + Math.random() * (to - from));

function uniqueCv() {
  const cv = CVS[Math.floor(Math.random() * CVS.length)], tail = `\n% load test ${__VU}-${__ITER}-${Date.now()}\n`;
  const out = new Uint8Array(cv.bytes.length + tail.length);
  out.set(cv.bytes); for (let i = 0; i < tail.length; i++) out[cv.bytes.length + i] = tail.charCodeAt(i);
  return { name: cv.name, data: out.buffer };
}

export default function () {
  const me = accounts[(__VU - 1) % accounts.length];
  if (!signedIn) {
    const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: me.email, password }), { headers: JSON_HEADERS, tags: { name: "sign in", kind: "sign-in" } });
    signedIn = check(r, { "signed in": (x) => x.status === 200 });
    if (!signedIn) { sleep(5); return; }
    think(1, 3);
  }
  const candidates = http.get(`${BASE}/api/candidates`, { tags: { name: "candidate list", kind: "page" } });
  check(candidates, { "candidate list opens": (x) => x.status === 200 });
  if (candidates.status === 401) { signedIn = false; return; }
  think(2, 5);
  const people = list(candidates);
  if (people.length) {
    const one = people[Math.floor(Math.random() * people.length)];
    check(http.get(`${BASE}/api/candidates/${one.id}`, { tags: { name: "candidate", kind: "page" } }), { "candidate opens": (x) => x.status === 200 });
    think(3, 8);
    const note = http.put(`${BASE}/api/candidates/${one.id}`, JSON.stringify({ recruiterNotes: `Called on ${new Date().toISOString().slice(0, 16)}; interested.` }), { headers: JSON_HEADERS, tags: { name: "save note", kind: "page" } });
    check(note, { "note saves": (x) => x.status === 200 || x.status === 409 });   // 409: a colleague saved the same person a moment earlier, as in real use
    think(2, 4);
  }
  check(http.get(`${BASE}/api/jobs`, { tags: { name: "job list", kind: "page" } }), { "job list opens": (x) => x.status === 200 });
  think(2, 5);
  if (Math.random() < UPLOAD_SHARE) {
    const cv = uniqueCv(), started = Date.now();
    const up = http.post(`${BASE}/api/documents`, { kind: "cv", file: http.file(cv.data, cv.name, "application/pdf") }, { tags: { name: "upload CV", kind: "upload" } });
    const ok = check(up, { "CV accepted": (x) => x.status === 200 || x.status === 202 });
    let id = null; try { id = up.json().id; } catch { /* checked above */ }
    if (ok && id) {
      // Wait for it to be read, as the recruiter watches it in the processing list: at most 3 minutes.
      let state = "";
      while (Date.now() - started < 180_000) {
        sleep(3);
        // The processing list shows only what is not yet read (or failed): a CV that has left it has been read, as the recruiter's screen shows it.
        const doc = list(http.get(`${BASE}/api/documents`, { tags: { name: "processing list", kind: "page" } })).find((d) => d.id === id);
        state = doc ? doc.status : "published";
        if (state === "published" || state === "exception") break;
      }
      cvReadOk.add(state === "published");
      if (state === "published") cvRead.add((Date.now() - started) / 1000);
    }
  }
  think(3, 8);
}
