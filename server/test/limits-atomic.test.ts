import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// Settings limits at the same moment. Found by reading the code before the load probe: counting and then acting lets twenty see room for three.
let w: World, other: World;
const pdf = async (tag: string) => { const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica), page = d.addPage([595, 842]); [`Atomic Person ${tag}`, `atomic.${tag}@example.test`, "Senior Accountant", "Experience", "Senior Accountant, Northwind Traders, 2016 - 2024", "Prepared monthly financial statements for three business units.", "Skills", "Excel, Financial Reporting"].forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font })); return new File([await d.save() as any], `${tag}.pdf`, { type: "application/pdf" }); };
const usage = async (x: World) => (await x.users[0].get("/api/usage")).body.usage;
const setLimits = async (x: World, patch: any) => { const u = x.users[0], s = (await u.get("/api/settings")).body; const r = await u.req("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: s.version, limits: { ...s.settings.limits, ...patch } }) }); expect(r.status).toBe(200); await sleep(100); };
const settled = async (x: World, id: string) => { for (let i = 0; i < 200; i++) { const d = (await x.users[0].get(`/api/documents/${id}`)).body; if (d.status !== "processing") return d; await sleep(100); } throw new Error("still processing"); };
const held = async (x: World) => Number((await x.admin.unsafe(`select count(*)::int as n from "${x.tdb.schema}".quota_holds`))[0].n);
const room = { documentsPerDay: 5000, inProgress: 1000, matchesPerHour: 50000 };

// Allowances are what this file tests, not the per-minute upload rate, which its many uploads would otherwise reach first.
const UPLOAD_RATE_LIFTED = JSON.stringify({ upload: 100000, upload_portal: 100000 });
beforeAll(async () => { w = await makeWorld(8994, 1, { RATE_OVERRIDES: UPLOAD_RATE_LIFTED }); other = await makeWorld(8995, 1); }, 120000);
afterAll(async () => { await w?.stop(); await other?.stop(); }, 120000);

test("twenty uploads at the same moment take exactly what is left of the day's limit, with the limit's own reason", async () => {
  await setLimits(w, { ...room, documentsPerDay: (await usage(w)).documentsToday + 3 });
  const files = await Promise.all(Array.from({ length: 20 }, (_, i) => pdf(`race${i}`)));
  const all = await Promise.all(files.map((f) => w.users[0].upload(f)));
  expect(all.filter((r) => r.status < 300).length).toBe(3);
  expect(all.filter((r) => r.body?.error?.code === "QUOTA-001").length).toBe(17);
  expect(await held(w)).toBe(0);   // nothing left behind to count against tomorrow's work
  for (const r of all.filter((x) => x.status < 300)) await settled(w, r.body.id);
}, 120000);

test("documents waiting: room for one means one, however many arrive", async () => {
  await setLimits(w, { ...room, inProgress: 1 });
  const files = await Promise.all(Array.from({ length: 12 }, (_, i) => pdf(`wait${i}`)));
  const all = await Promise.all(files.map((f) => w.users[0].upload(f)));
  expect(all.filter((r) => r.status < 300).length).toBe(1);
  expect(all.filter((r) => r.body?.error?.code === "QUOTA-003").length).toBe(11);
  await settled(w, all.find((r) => r.status < 300)!.body.id);
}, 120000);

test("matches per hour: twenty at once run only what is left, and each refusal says so", async () => {
  await setLimits(w, room);
  const cv = (await w.users[0].upload(await pdf("matcher"))).body.id, job = await w.users[0].upload(await pdf("matchjob"), { kind: "jd" });
  const candidateId = (await settled(w, cv)).recordId, jobId = (await settled(w, job.body.id)).recordId;
  expect(candidateId && jobId).toBeTruthy();
  await setLimits(w, { matchesPerHour: (await usage(w)).matchesLastHour + 3 });
  const all = await Promise.all(Array.from({ length: 20 }, () => w.users[0].post("/api/matches", { candidateId, jobId })));
  expect(all.filter((r) => r.status === 200).length).toBeLessThanOrEqual(3);
  expect(all.filter((r) => r.status === 200).length).toBeGreaterThan(0);
  const others = all.filter((r) => r.status !== 200);
  expect(others.every((r) => ["QUOTA-004", "RATE-001"].includes(r.body?.error?.code))).toBe(true);   // the per-portal limit on matches running at once may answer first
  expect(await held(w)).toBe(0);
}, 120000);

test("one sequential person is not refused early: a finished upload is counted once, not twice", async () => {
  await setLimits(w, { ...room, documentsPerDay: (await usage(w)).documentsToday + 2 });
  const a = await w.users[0].upload(await pdf("seq1")), b = await w.users[0].upload(await pdf("seq2")), c = await w.users[0].upload(await pdf("seq3"));
  expect([a.status < 300, b.status < 300, c.body?.error?.code]).toEqual([true, true, "QUOTA-001"]);
  await settled(w, a.body.id); await settled(w, b.body.id);
}, 120000);

test("another organisation's limits and uploads are untouched, and a hold left by a stopped server runs out by itself", async () => {
  expect((await other.users[0].upload(await pdf("other1"))).status).toBeLessThan(300);
  const s = w.tdb.schema, [p] = await w.admin.unsafe(`select id, org_id from "${s}".portals limit 1`);
  await setLimits(w, { ...room, inProgress: 1 });
  await w.admin.unsafe(`insert into "${s}".quota_holds (org_id, portal_id, kind, units, expires_at) values ($1, $2, 'document', 1, now() + interval '1 hour')`, [p.org_id, p.id]);
  expect((await w.users[0].upload(await pdf("heldout"))).body?.error?.code).toBe("QUOTA-003");
  await w.admin.unsafe(`update "${s}".quota_holds set expires_at = now() - interval '1 second'`);
  const free = await w.users[0].upload(await pdf("freed"));
  expect(free.status).toBeLessThan(300);
  await settled(w, free.body.id);
  await setLimits(w, room);
}, 120000);

// Owner, 16 Nov 2026: "It is per portal at all times. No matter how many people are in that portal." Every portal is paid for: a portal that has
// used its whole day's uploads leaves its organisation's other portals with theirs in full, and each is told about its own portal.
test("every portal has the allowance in full: one portal at its limit leaves another portal of the same organisation untouched", async () => {
  const created = await w.users[0].post("/api/portals", { name: "Second department" });
  expect(created.status).toBe(201);
  const first = (await w.users[0].get("/api/portals")).body.find((p: any) => p.id !== created.body.id).id;
  const inPortal = (portal: string) => { const u = Object.create(Object.getPrototypeOf(w.users[0])); Object.assign(u, w.users[0], { jar: w.users[0].jar, portal }); return u as typeof w.users[0]; };
  const one = inPortal(first), two = inPortal(created.body.id);
  await setLimits(w, { ...room, documentsPerDay: (await one.get("/api/usage")).body.usage.documentsToday + 1 });
  const kept = await one.upload(await pdf("p1a"));
  expect(kept.status).toBeLessThan(300);
  const full = await one.upload(await pdf("p1b"));
  expect(full.body?.error?.code, JSON.stringify(full.body)).toBe("QUOTA-001");
  expect(full.body?.error?.message).toMatch(/^This portal has reached today's limit/);
  expect((await two.get("/api/usage")).body.usage.documentsToday).toBe(0);   // the other portal's count starts from nothing
  const theirs = await two.upload(await pdf("p2a"));
  expect(theirs.status).toBeLessThan(300);                                     // and it has its own day in full
  const settledIn = async (u: typeof one, id: string) => { for (let i = 0; i < 200; i++) { if ((await u.get(`/api/documents/${id}`)).body.status !== "processing") return; await sleep(100); } };
  await settledIn(one, kept.body.id); await settledIn(two, theirs.body.id);
  await setLimits(w, room);
}, 120000);
