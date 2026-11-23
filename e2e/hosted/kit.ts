// Shared by the checks against a running service. Settings come from the environment and are never printed:
//   E2E_BASE           the service's address
//   E2E_MAILBOX        the test mailbox, name@domain; each account in a run gets a tagged address, name+tag@domain
//   E2E_INBOX_URL      a simulated mail host (test/live/mailSink.ts), for a rehearsal; otherwise E2E_IMAP_HOST, E2E_IMAP_USER, E2E_IMAP_PASS read the real mailbox
//   E2E_CREATE_USER    a command that makes an organisation's administrator directly, given: "<org>" <email> "<name>" <password>
//   E2E_LINK_ORIGIN    a rehearsal only: where links in mail really point to, replaced with E2E_BASE
import { execSync } from "node:child_process";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
export const BASE = need("E2E_BASE").replace(/\/$/, "");
export const RUN = Date.now().toString(36);
export const FIXTURES = join(__dirname, "../../server/test/fixtures/journey");
export const fixture = (name: string) => join(FIXTURES, name);
export const PASSWORD = `pw-${RUN}-Hosted-1!x`;
const [local, domain] = need("E2E_MAILBOX").split("@");
export const address = (tag: string) => `${local}+${RUN}${tag}@${domain}`.toLowerCase();
export const CARD = (kind: "candidate" | "job") => `[aria-roledescription="selectable ${kind} card"]`;
/** A record panel's tabs, in order (the panels have tabs since 10 Nov 2026: src/components/ui/PanelTabs.tsx). */
export const panelTabs = (page: Page, kind: "candidate" | "job") => page.getByTestId(`${kind}-tabs`).getByRole("tab").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.replace("tab-", "")));
/** Opens one tab of a record panel. */
export const openTab = async (page: Page, kind: "candidate" | "job", tab: string) => { await page.getByTestId(`${kind}-tabs`).getByTestId(`tab-${tab}`).click(); await expect(page.getByTestId(`tab-panel-${tab}`)).toBeVisible(); };
/** Every section of a candidate panel, tab by tab in order, each tab opened in turn: the panel's whole shape, not only the open tab. */
export async function panelSections(page: Page, kind: "candidate" | "job" = "candidate"): Promise<string[]> {
  const out: string[] = [];
  for (const tab of await panelTabs(page, kind)) {
    await openTab(page, kind, tab);
    out.push(...await page.getByTestId(`tab-panel-${tab}`).locator('[data-testid^="section-"]:not([data-testid$="-empty"])').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.replace("section-", ""))));
  }
  return out;
}

export interface Mail { to: string; subject: string; text: string; at: number }
async function imapMail(to: string): Promise<Mail[]> {
  const client = new ImapFlow({ host: need("E2E_IMAP_HOST"), port: 993, secure: true, auth: { user: need("E2E_IMAP_USER"), pass: need("E2E_IMAP_PASS") }, logger: false });
  await client.connect();
  try {
    const out: Mail[] = [], lock = await client.getMailboxLock("INBOX");
    try {
      const ids = await client.search({ to }, { uid: true });
      for await (const m of client.fetch(ids || [], { envelope: true, source: true }, { uid: true })) out.push({ to, subject: m.envelope?.subject ?? "", text: m.source?.toString("utf8") ?? "", at: new Date(m.envelope?.date ?? 0).getTime() });
    } finally { lock.release(); }
    return out;
  } finally { await client.logout().catch(() => {}); }
}
async function sinkMail(to: string): Promise<Mail[]> {
  const all = (await (await fetch(`${process.env.E2E_INBOX_URL}/messages?to=${encodeURIComponent(to)}`)).json()) as Mail[];
  return all;
}
/** Waits for a message to this address that arrived after `since` and whose subject matches. */
export async function waitForMail(to: string, subject: RegExp, since: number, ms = 180_000): Promise<Mail> {
  const read = process.env.E2E_INBOX_URL ? sinkMail : imapMail;
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) {
    const hit = (await read(to).catch(() => [] as Mail[])).filter((m) => subject.test(m.subject) && m.at >= since - 60_000).sort((a, b) => b.at - a.at).find((m) => m.at >= since - 2000);
    if (hit) return hit;
  }
  throw new Error(`no message matching ${subject} reached ${to.replace(/^.*\+/, "+")} in ${ms / 1000} s`);
}
export const codeIn = (m: Mail) => { const c = /^(\d{6,10}) is your RoleMatch/.exec(m.subject)?.[1]; if (!c) throw new Error("no code in the subject"); return c; };
export const inviteLink = (m: Mail) => {
  const flat = m.text.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
  const raw = /https?:\/\/[^\s"'<>]*\/accept-invite\?token=[^\s"'<>]+/.exec(flat)?.[0];
  if (!raw) throw new Error("no invitation link in the message");
  return process.env.E2E_LINK_ORIGIN ? raw.replace(process.env.E2E_LINK_ORIGIN, BASE) : raw;
};

export function createAdmin(org: string, email: string, name: string) {
  execSync(`${need("E2E_CREATE_USER")} ${JSON.stringify(org)} ${email} ${JSON.stringify(name)} ${JSON.stringify(PASSWORD)}`, { stdio: "pipe" });
}
export async function dismissNotices(page: Page) {
  const notice = page.getByRole("button", { name: "Essential Only" });
  if (await notice.isVisible({ timeout: 3000 }).catch(() => false)) await notice.click();
  for (const name of ["Skip", "Skip tour", "Close"]) { const b = page.getByRole("button", { name, exact: true }).first(); if (await b.isVisible({ timeout: 800 }).catch(() => false)) await b.click().catch(() => {}); }
}
export async function signIn(page: Page, email: string, password = PASSWORD, path = "/login") {
  await page.goto(path);
  const notice = page.getByRole("button", { name: "Essential Only" }); if (await notice.isVisible({ timeout: 3000 }).catch(() => false)) await notice.click();
  await page.getByPlaceholder("you@example.com").fill(email); await page.locator('button[type="submit"]').first().click();
  await page.getByPlaceholder("Your password").fill(password); await page.locator('button[type="submit"]').last().click();
}
/** Signed in and on the board: signing in opens the Overview (10 Nov 2026), and the checks that follow are on the board. */
export async function signedIn(page: Page, email: string) { await signIn(page, email); await page.waitForURL(/overview/, { timeout: 60_000 }); await page.goto("/dashboard"); await dismissNotices(page); }
/** Fills the sign-up form. For an invitation the address is already set and there is no organisation to name. */
export async function fillSignup(page: Page, o: { name: string; org?: string; email?: string; password?: string }) {
  const notice = page.getByRole("button", { name: "Essential Only" }); if (await notice.isVisible({ timeout: 3000 }).catch(() => false)) await notice.click();
  await page.getByPlaceholder("Jordan Example").fill(o.name);
  if (o.org) await page.getByLabel(/^Organisation/).fill(o.org);
  if (o.email) await page.getByLabel(/^Work email/).fill(o.email);
  await page.getByLabel(/^Password/).fill(o.password ?? PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(o.password ?? PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
}
export async function pick(page: Page, click: () => Promise<void>, files: string | string[]) { const [c] = await Promise.all([page.waitForEvent("filechooser"), click()]); await c.setFiles(files); }
export const cvZone = (page: Page) => page.getByText(/^Upload CVs$/).first();
export const jobZone = (page: Page) => page.getByText(/^Upload job descriptions$/).first();
export const portalHeader = (id: string) => ({ "x-portal-id": id, origin: BASE });
/** Waits for a document to finish, through the API (the browser steps have already been tested by then). */
export async function published(api: APIRequestContext, id: string, ms = 480_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) {
    const d = await (await api.get(`/api/documents/${id}`, { headers: { origin: BASE } })).json();
    if (d.status === "published") return d.recordId as string;
    expect(d.status, `document stopped: ${d.errorCode}`).not.toBe("exception");
  }
  throw new Error("not published in time");
}
