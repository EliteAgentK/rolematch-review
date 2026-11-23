import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { adminDeleteUser } from "../src/supabase";
import { setupTestDb, sleep, spawnProc, type Proc, type TestDb } from "./helpers";
import { degrade, pageImages, PROFILES } from "./ocr/eval";

// Phone photos go through the same pipeline as every other document: stored privately as taken, read by OCR after cleaning, published
// only when the result can be trusted, and refused with a plain reason when it cannot.
const PORT = 8792, base = `http://localhost:${PORT}`;
const run = crypto.randomUUID().slice(0, 8);
let tdb: TestDb, server: Proc, admin: postgres.Sql, cookie = "", good: Uint8Array, bad: Uint8Array;
const hdr = () => ({ cookie, origin: "http://localhost:5173" });
async function upload(bytes: Uint8Array, name: string, type = "image/jpeg") {
  const f = new FormData(); f.append("kind", "cv"); f.append("file", new File([bytes], name, { type }));
  const res = await fetch(base + "/api/documents", { method: "POST", headers: hdr(), body: f });
  return { status: res.status, body: (await res.json()) as any };
}
async function settle(id: string) {
  for (let i = 0; i < 90; i++) { const d: any = await (await fetch(base + `/api/documents/${id}`, { headers: { cookie } })).json(); if (d.status !== "processing") return d; await sleep(1000); }
  throw new Error("never settled");
}

beforeAll(async () => {
  const pdf = new Uint8Array(readFileSync(fileURLToPath(new URL("../../sample-documents/cvs/cv03-lindiwe-dlamini.pdf", import.meta.url))));
  const page = (await pageImages(pdf))[0];
  good = new Uint8Array(await degrade(page, PROFILES.find((p) => p.id === "phone-good")!));
  bad = new Uint8Array(await degrade(page, PROFILES.find((p) => p.id === "bad")!));
  tdb = await setupTestDb({ PORT: String(PORT), SIGNUP_REQUIRE_CODE: "false", TRUST_PROXY: "true" });
  admin = postgres(process.env.DATABASE_URL!, { max: 2 });
  server = spawnProc(["tsx", "src/index.ts"], { env: tdb.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
  const res = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.7.1.1" }, body: JSON.stringify({ name: "Photo Tester", orgName: `Photo Org ${run}`, email: `ph-${run}@example.test`, password: "a-long-enough-password-1" }) });
  await res.json();
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
}, 240000);
afterAll(async () => {
  server?.kill(); await admin?.end(); await tdb?.teardown();
  const a = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await a.unsafe(`select id from auth.users where email like 'ph-${run}%@example.test'`)) await adminDeleteUser(u.id); } finally { await a.end(); }
}, 120000);

test("a phone photo of a CV is read, published, and the original photo is kept exactly as taken", async () => {
  const up = await upload(good, "IMG_2041.jpg");
  expect(up.status).toBe(202);
  const done = await settle(up.body.id);
  expect(done.status).toBe("published");
  const cand: any = (await (await fetch(base + "/api/candidates?limit=10", { headers: { cookie } })).json());
  const list = cand.items ?? cand;
  const c = list.find((x: any) => x.name === "Lindiwe Dlamini");
  expect(c, "the candidate was extracted from the photo").toBeTruthy();
  expect(c.email).toBe("lindiwe.dlamini@example.test");
  expect(c.workHistory.length).toBe(2);
  expect(c.reviewReasons?.join(" ") ?? JSON.stringify(c)).toMatch(/photo by OCR/i);          // a person is told it was read from a photo and should check it
  const orig = await fetch(base + `/api/documents/${up.body.id}/original`, { headers: { cookie } });
  expect(orig.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await orig.arrayBuffer())).toEqual(good);                          // byte for byte what was uploaded
  expect((await admin.unsafe(`select mime from "${tdb.schema}".documents where id = $1`, [up.body.id]))[0].mime).toBe("jpeg");
}, 180000);

test("a photo too poor to read is refused with a plain reason, and nothing is published from guesses", async () => {
  const up = await upload(bad, "blurry.jpg");
  expect(up.status).toBe(202);
  const done = await settle(up.body.id);
  expect(done.status).toBe("exception");
  expect(done.errorCode ?? done.error_code).toBe("PHOTO_UNREADABLE");
  expect(JSON.stringify(done)).toMatch(/blurry|dark|small/i);
}, 180000);

test("a file is judged by what it contains, not by the type the browser claims; and a name that says another format is refused with the reason", async () => {
  const noise = await upload(new Uint8Array(3000).map((_, i) => (i * 7 + 3) % 256), "cv.jpg");              // binary rubbish called a photo
  expect(noise.status).toBe(415);
  expect(JSON.stringify(noise.body)).toMatch(/PDF|Word|JPEG|PNG/);                                          // and the answer says what IS accepted
  const heic = await upload(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 1, 2, 3, 4]), "IMG_1.heic", "image/heic");
  expect(heic.status).toBe(415); expect(JSON.stringify(heic.body)).toMatch(/HEIC.*Most Compatible/);                                                                            // iPhone HEIC is not supported yet, and says so rather than failing later
  // Text named as a photo is refused at once, saying why (11 Nov 2026), rather than read as text and refused later for having no candidate in it.
  const text = await upload(new TextEncoder().encode("This is plain text that only claims to be a photograph, and it has no name in it at all."), "cv.jpg");
  expect(text.status).toBe(415);
  expect(JSON.stringify(text.body)).toMatch(/named \.jpg but is not a genuine Photo \(JPEG\)/);
});

test("older and other document formats go through the same pipeline; the original is returned exactly as uploaded on request, and shown as a page by default", async () => {
  const expected: Record<string, [string, string]> = { doc: ["application/msword", "doc"], rtf: ["application/rtf", "rtf"], odt: ["application/vnd.oasis.opendocument.text", "odt"], txt: ["text/plain; charset=utf-8", "txt"] };
  for (const [ext, [contentType, kind]] of Object.entries(expected)) {
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(`../../sample-documents/cvs/cv16-michael-chen.${ext}`, import.meta.url))));
    const up = await upload(bytes, `Michael Chen.${ext}`, "application/octet-stream");
    expect(up.status, ext).toBe(202);
    const done = await settle(up.body.id);
    expect(done.status, `${ext}: ${JSON.stringify(done)}`).toBe("published");
    const orig = await fetch(base + `/api/documents/${up.body.id}/original?as=original`, { headers: { cookie } });
    expect(orig.headers.get("content-type"), ext).toBe(contentType);
    expect(new Uint8Array(await orig.arrayBuffer()), ext).toEqual(bytes);
    // "View Original CV" (no parameter) opens in the browser: text as it is, other formats as a read-only page of the text that was read (owner, 2026-10-30)
    const view = await fetch(base + `/api/documents/${up.body.id}/original`, { headers: { cookie } });
    expect(view.headers.get("content-type"), ext).toBe(ext === "txt" ? contentType : "text/html; charset=utf-8");
    if (ext !== "txt") expect(await view.text(), ext).toContain("Michael Chen");
    expect((await admin.unsafe(`select mime from "${tdb.schema}".documents where id = $1`, [up.body.id]))[0].mime).toBe(kind);
  }
}, 240000);
