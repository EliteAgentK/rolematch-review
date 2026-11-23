// Invitations, two recruiters in one portal, and what must be refused. The browser shows what people meet; the direct requests show what the server does whatever a page hides.
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { address, BASE, CARD, createAdmin, fillSignup, fixture, codeIn, inviteLink, portalHeader, published, RUN, signedIn, signIn, waitForMail, PASSWORD } from "./kit";

const adminA = address("a"), adminB = address("b"), recruiter = address("r"), viewer = address("v"), stranger = address("s");
const H = { origin: BASE };
test.describe.configure({ mode: "serial" });
let ctxA: BrowserContext, ctxB: BrowserContext, ctxR: BrowserContext;
let cand = "", job = "", doc = "", match = "", inv = "", portalA = "", portalB = "", p2 = "";

const invite = async (api: APIRequestContext, email: string, role: string) => { const r = await api.post("/api/portal/invitations", { headers: H, data: { emails: [email], role } }); expect(r.status()).toBe(201); return (await r.json())[0]; };
async function join(browser: Browser, email: string, name: string, since: number) {
  const mail = await waitForMail(email, /invit/i, since), ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } }), page = await ctx.newPage();
  await page.goto(inviteLink(mail));
  await page.getByRole("link", { name: "Create account" }).or(page.getByRole("button", { name: "Create account" })).first().click();
  const t = Date.now();
  await fillSignup(page, { name });
  const code = codeIn(await waitForMail(email, /RoleMatch verification code/, t));
  await page.getByLabel(/^Verification code/).fill(code);
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await page.waitForURL(/overview/, { timeout: 60_000 }); await page.goto("/dashboard");
  return { ctx, page, link: inviteLink(mail) };
}

test.beforeAll(async ({ browser }) => {
  createAdmin(`Boundary A ${RUN}`, adminA, "Admin A"); createAdmin(`Boundary B ${RUN}`, adminB, "Admin B");
  ctxA = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } }); ctxB = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } });
  await signedIn(await ctxA.newPage(), adminA); await signedIn(await ctxB.newPage(), adminB);
  portalA = (await (await ctxA.request.get("/api/auth/me")).json()).portals[0].id; portalB = (await (await ctxB.request.get("/api/auth/me")).json()).portals[0].id;
  const up = async (name: string, kind: string) => (await (await ctxA.request.post("/api/documents", { headers: H, multipart: { kind, file: { name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: readFileSync(fixture(name)) } } })).json()).id as string;
  doc = await up("CV0501.docx", "cv");
  cand = await published(ctxA.request, doc); job = await published(ctxA.request, await up("JD0151.docx", "jd"));
  match = (await (await ctxA.request.post("/api/matches", { headers: H, data: { candidateId: cand, jobId: job } })).json()).id;
  p2 = (await (await ctxA.request.post("/api/portals", { headers: H, data: { name: `Second ${RUN}` } })).json()).id;
});
test.afterAll(async () => { await ctxA?.close(); await ctxB?.close(); await ctxR?.close(); });

test("an invitation: the invited address only, a real e-mail, one use", async ({ browser }) => {
  const t = Date.now(); const made = await invite(ctxA.request, recruiter, "recruiter"); inv = made.id;
  const joined = await join(browser, recruiter, "Recruiter R", t); ctxR = joined.ctx;
  const me = await (await ctxR.request.get("/api/auth/me")).json();
  expect(me.user.email).toBe(recruiter); expect(me.portals.map((p: any) => p.id)).toEqual([portalA]);
  const again = await (await browser.newContext({ baseURL: BASE })).newPage();
  await again.goto(joined.link);
  await expect(again.getByText(/This invitation is not valid/)).toBeVisible({ timeout: 20_000 });   // used
});

test("a withdrawn invitation stops working, and the wrong account cannot take one", async ({ browser }) => {
  const t = Date.now(); const made = await invite(ctxA.request, viewer, "hiring_manager");
  const mail = await waitForMail(viewer, /invit/i, t), link = inviteLink(mail);
  // signed in as someone else: refused with the way forward, and nothing joined
  const wrong = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } })).newPage();
  await signIn(wrong, adminB); await wrong.waitForURL(/overview/, { timeout: 60_000 });
  await wrong.goto(link);
  await expect(wrong.getByRole("button", { name: "Sign out and switch account" })).toBeVisible({ timeout: 20_000 });
  await expect(wrong.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  const portals = (await (await wrong.request.get("/api/auth/me")).json()).portals;
  expect(portals.map((p: any) => p.id)).toEqual([portalB]);
  // withdrawn
  expect((await ctxA.request.post(`/api/portal/invitations/${made.id}/revoke`, { headers: H, data: {} })).status()).toBe(200);
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.goto(link);
  await expect(page.getByText(/This invitation is not valid/)).toBeVisible({ timeout: 20_000 });
});

test("two recruiters, separate browsers, one portal: both see the same saved record and the same capacity", async () => {
  const a = await ctxA.newPage(), r = await ctxR.newPage();
  await a.goto("/dashboard"); await r.goto("/dashboard");
  // A has two portals, so the page asks which one before showing a board; R has one, and goes straight to it.
  await expect(a.getByText("Choose a portal")).toBeVisible({ timeout: 30_000 });
  await a.getByRole("listitem").filter({ hasText: "Main portal" }).click();
  for (const p of [a, r]) await expect(p.locator(CARD("candidate")).first()).toBeVisible({ timeout: 30_000 });
  const [ca, cr] = await Promise.all([ctxA.request.get("/api/capacity", { headers: H }), ctxR.request.get("/api/capacity", { headers: H })]);
  expect(await ca.json()).toEqual(await cr.json());
  const [la, lr] = await Promise.all([ctxA.request.get("/api/candidates?limit=50", { headers: H }), ctxR.request.get("/api/candidates?limit=50", { headers: H })]);
  expect((await lr.json()).items.map((c: any) => c.id).sort()).toEqual((await la.json()).items.map((c: any) => c.id).sort());
});

test("another organisation gets nothing by changing an id or naming a portal, and no one signed out gets anything", async ({ request }) => {
  const paths = [`/api/candidates/${cand}`, `/api/jobs/${job}`, `/api/documents/${doc}`, `/api/documents/${doc}/original`];
  for (const path of paths) {
    expect((await ctxB.request.get(path, { headers: H })).status(), `other organisation: ${path}`).toBe(404);
    expect((await ctxB.request.get(path, { headers: portalHeader(portalA) })).status(), `other organisation naming the portal: ${path}`).toBeGreaterThanOrEqual(403);
    expect((await request.get(BASE + path, { headers: H })).status(), `signed out: ${path}`).toBe(401);
  }
  const writes = [
    ctxB.request.put(`/api/candidates/${cand}`, { headers: H, data: { recruiterNotes: "B was here", status: "new" } }),
    ctxB.request.delete(`/api/candidates/${cand}`, { headers: H }),
    ctxB.request.post("/api/matches", { headers: H, data: { candidateId: cand, jobId: job } }),
    ctxB.request.post(`/api/portal/invitations/${inv}/revoke`, { headers: H, data: {} }),
    ctxB.request.post(`/api/org/portals/${portalA}/admins`, { headers: H, data: { userId: "00000000-0000-4000-8000-000000000000" } }),
  ];
  for (const w of await Promise.all(writes)) expect(w.status(), w.url()).toBe(404);
  for (const path of ["/api/candidates?limit=100", "/api/jobs?limit=100", "/api/documents?limit=100", "/api/batches", "/api/history/uploads?scope=org", "/api/history/invitations?scope=org", "/api/org/people", "/api/portal/members", `/api/audit?entityId=${cand}`, `/api/model-reviews?kind=matching&subject=${match}`, `/api/model-reviews?kind=extraction&subject=${cand}`]) {
    const text = await (await ctxB.request.get(path, { headers: H })).text();
    for (const secret of [cand, job, doc, match, adminA, recruiter]) expect(text.includes(secret), `${path} shows A's data`).toBe(false);
  }
  expect((await (await ctxA.request.get(`/api/candidates/${cand}`, { headers: H })).json()).recruiterNotes ?? "").not.toContain("B was here");
});

test("inside an organisation: a member of one portal cannot reach a sibling portal, and a hiring manager sees only the shortlist and cannot change anything", async ({ browser }) => {
  // the recruiter belongs to the first portal only
  const sibling = await ctxR.request.get("/api/candidates", { headers: portalHeader(p2) });
  expect(sibling.status()).toBeGreaterThanOrEqual(403);
  const t = Date.now(); const reader = address("w"); await invite(ctxA.request, reader, "hiring_manager");
  const j = await join(browser, reader, "Hiring W", t);
  expect((await j.ctx.request.get(`/api/candidates/${cand}`, { headers: H })).status()).toBe(404);   // not shortlisted: as if it were not there
  const current = await (await ctxA.request.get(`/api/candidates/${cand}`, { headers: H })).json();
  expect((await ctxA.request.put(`/api/candidates/${cand}`, { headers: H, data: { status: "shortlisted", version: current.version } })).status()).toBe(200);
  expect((await j.ctx.request.get(`/api/candidates/${cand}`, { headers: H })).status()).toBe(200);
  const refused = await Promise.all([
    j.ctx.request.put(`/api/candidates/${cand}`, { headers: H, data: { recruiterNotes: "read-only role wrote", status: "new" } }),
    j.ctx.request.delete(`/api/candidates/${cand}`, { headers: H }),
    j.ctx.request.post("/api/portal/invitations", { headers: H, data: { emails: [stranger], role: "admin" } }),
    j.ctx.request.post("/api/portals", { headers: H, data: { name: "Hiring portal" } }),
    j.ctx.request.put("/api/settings", { headers: H, data: { version: 0 } }),
  ]);
  for (const r of refused) expect(r.status(), r.url()).toBe(403);
  await j.ctx.close();
});

test("removal takes effect on a session already open, and the removed person cannot rejoin by signing in", async ({ browser }) => {
  const r = recruiter, members = await (await ctxA.request.get("/api/portal/members", { headers: H })).json();
  const row = (members.members ?? members).find((m: any) => m.email === r);
  expect((await ctxR.request.get("/api/candidates", { headers: H })).status()).toBe(200);
  expect((await ctxA.request.delete(`/api/org/members/${row.userId ?? row.id}`, { headers: H })).status()).toBe(200);
  const after = await ctxR.request.get("/api/candidates", { headers: H });
  expect(after.status()).toBeGreaterThanOrEqual(401);
  expect((await ctxR.request.get(`/api/documents/${doc}/original`, { headers: H })).status()).toBeGreaterThanOrEqual(401);
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await signIn(page, r, PASSWORD);
  await page.waitForTimeout(3000);
  const me = await page.request.get("/api/candidates", { headers: H });
  expect(me.status()).toBeGreaterThanOrEqual(401);
});
