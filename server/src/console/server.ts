// The owner's console (docs/database/18_CONSOLE_V0.md): its own small server, from the same image as live, on 127.0.0.1 only. The internet reaches it
// through the named tunnel at console.rolematch.co.za; its own sign-in has two steps, the password and a code e-mailed to the owner (slice 2).
//   node src/console/server.js          CONSOLE_PORT (18790), CONSOLE_HOST_STATUS (/status/host.json); the API's PORT and OPS_TOKEN from live's settings
// It changes nothing of live's data: it reads counts and states, and writes only its own sessions and the acknowledgement of its own alerts.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CODE_MS, checkCode, endSession, formToken, sameToken, sendCode, sessionFor, signIn, startSession } from "./auth";
import { health, host } from "./sources";
import { acknowledge, asConsole, getEvent, listEvents, mute, needsYou, type Severity } from "./store";
import { ActionRefused, company, deleteCompany, deletePerson, deletePortal, openSupport, recentActions, setAllowance, setBlocked, signOutEverywhere, supportLog } from "./actions";
import { orgCapUsd } from "../ai/claude";
import { buildToday } from "./today";
import { personPage, portalPage, setRate, trendsPage, activityPage, aiPage, alertPage, alertsPage, backupsPage, codePage, CSS, CSS_VERSION, databasePage, FONT_FACES, loginPage, organisationsPage, peoplePage, portalsPage, schemaPage, todayPage } from "./view";
import { shapeOrganisations, shapePeriod, usd } from "./insights";
import { periodOf } from "./period";
import { trip, type Summary } from "./trip";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeDatabase, migrationFiles, whereIs } from "./database";
import { rangeOf, readTrends } from "./trends";

const PORT = Number(process.env.CONSOLE_PORT ?? 18790), BIND = process.env.CONSOLE_BIND ?? "127.0.0.1";
const DIST = fileURLToPath(new URL("../../../dist", import.meta.url));
/** The site's own type in the website's build: Sora for text, Outfit for headings and numbers (names carry a build hash, so they are found, not named). */
const FONTS: Record<string, string> = (() => { try { const all = readdirSync(join(DIST, "assets")); const pick = (re: RegExp) => all.find((f) => re.test(f));
  return Object.fromEntries(([["Sora:400", /^sora-latin-400-normal-.*\.woff2$/], ["Sora:500", /^sora-latin-500-normal-.*\.woff2$/], ["Sora:600", /^sora-latin-600-normal-.*\.woff2$/],
    ["Outfit:600", /^outfit-latin-600-normal-.*\.woff2$/], ["Outfit:700", /^outfit-latin-700-normal-.*\.woff2$/]] as const).map(([k, re]) => [k, pick(re)]).filter(([, f]) => f)); } catch { return {}; } })();
function file(res: ServerResponse, at: string, type: string) {
  try { const b = readFileSync(at); res.setHeader("Cache-Control", "public, max-age=604800"); res.statusCode = 200; res.setHeader("Content-Type", type); res.end(b); } catch { send(res, 404, ""); }
}
const local = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
const cookieName = (req: IncomingMessage, kind: "session" | "pending" = "session") => `${local(req.headers.host ?? "") ? "" : "__Host-"}${kind === "session" ? "rmc" : "rmp"}`;

function headers(res: ServerResponse, req: IncomingMessage) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("X-Frame-Options", "DENY"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "same-origin");   // not no-referrer: with it, browsers send "Origin: null" on this console's own forms and sameOrigin refuses every sign-in (R163)
  // no-transform: Cloudflare otherwise rewrites every e-mail address into "[email protected]" with a script to restore it, which this console's policy
  // (no script, ever) blocks; the owner saw the Portals page's administrators that way (12 Nov 2026).
  res.setHeader("Cache-Control", "no-store, no-transform"); res.setHeader("Cross-Origin-Opener-Policy", "same-origin"); res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (!local(req.headers.host ?? "")) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}
const send = (res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") => { res.statusCode = status; res.setHeader("Content-Type", type); res.end(body); };
const go = (res: ServerResponse, to: string) => { res.statusCode = 303; res.setHeader("Location", to); res.end(); };
const cookie = (req: IncomingMessage, name: string) => (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];
function setCookie(req: IncomingMessage, res: ServerResponse, value: string, maxAgeSec: number, kind: "session" | "pending" = "session") {
  const secure = !local(req.headers.host ?? ""), before = res.getHeader("Set-Cookie");
  const line = `${cookieName(req, kind)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
  res.setHeader("Set-Cookie", [...(Array.isArray(before) ? before : before ? [String(before)] : []), line]);
}
async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let size = 0; const parts: Buffer[] = [];
  for await (const c of req) { size += (c as Buffer).length; if (size > 8192) throw Object.assign(new Error("too large"), { status: 413 }); parts.push(c as Buffer); }
  return new URLSearchParams(Buffer.concat(parts).toString("utf8"));
}
/** A change must come from a page of this console: the browser's Origin must name this host. With the same-site cookie and the form token, that is two walls. */
const sameOrigin = (req: IncomingMessage) => { try { return new URL(req.headers.origin ?? "").host === req.headers.host; } catch { return false; } };
const client = (ua = "") => `${/iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "other"} · ${/Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "browser"}`;

/** Who is asking: Cloudflare's tunnel is the only way in from outside (the console listens on 127.0.0.1), so the address it reports is the visitor's. */
const visitor = (req: IncomingMessage) => String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown").slice(0, 64);
/** Flooding (owner, 12 Nov 2026: "no entries, no flooding, rate limits necessary"): at most PAGE_LIMIT requests a minute from one address, and SIGN_IN_LIMIT
 *  sign-in forms a minute, before anything else is done, so a flood costs a counter here and nothing in the database. The five-wrong-tries lock still holds
 *  behind it. Counts live in memory, bounded: past BOUND addresses the oldest minute's counts are dropped. */
export const PAGE_LIMIT = 240, SIGN_IN_LIMIT = 10;
const BOUND = 20_000, counts = new Map<string, { n: number; minute: number }>();
export function tooFast(key: string, limit: number, now = Date.now()) {
  const minute = Math.floor(now / 60_000), c = counts.get(key);
  if (!c || c.minute !== minute) {
    if (counts.size >= BOUND) for (const [k, v] of counts) if (v.minute !== minute) counts.delete(k);
    if (counts.size >= BOUND) counts.clear();
    counts.set(key, { n: 1, minute }); return false;
  }
  return ++c.n > limit;
}
/** A session cookie as this console makes them (32 random bytes, base64url): anything else is not one, and is not looked up. */
const wellFormed = (sid: string | undefined): sid is string => !!sid && /^[A-Za-z0-9_-]{43}$/.test(sid);

export async function handle(req: IncomingMessage, res: ServerResponse) {
  headers(res, req);
  const who = visitor(req), signInForm = req.method === "POST" && /^\/login(\/code)?$/.test(new URL(req.url ?? "/", "http://console").pathname);
  if (req.url !== "/healthz" && (tooFast(`all:${who}`, PAGE_LIMIT) || (signInForm && tooFast(`signin:${who}`, SIGN_IN_LIMIT)))) {
    res.setHeader("Retry-After", "60"); return send(res, 429, loginPage("Too many requests from this address. Wait a minute and try again.", "bad"));
  }
  const url = new URL(req.url ?? "/", "http://console"), path = url.pathname, method = req.method ?? "GET";
  if (path === "/console.css") { res.setHeader("Cache-Control", url.searchParams.get("v") === CSS_VERSION ? "public, max-age=604800, immutable" : "no-cache"); return send(res, 200, FONT_FACES(FONTS) + CSS, "text/css; charset=utf-8"); }
  // The logo and the site's own type, from the website's build in this same image: nothing is fetched from another site.
  if (path === "/logo-light.png" || path === "/logo-dark.png") return file(res, join(DIST, path.slice(1)), "image/png");
  const fontFile = /^\/fonts\/([\w.-]+\.woff2)$/.exec(path)?.[1];
  if (fontFile && Object.values(FONTS).includes(fontFile)) return file(res, join(DIST, "assets", fontFile), "font/woff2");
  if (path === "/healthz") return send(res, 200, "ok", "text/plain");
  if (method === "POST" && !sameOrigin(req)) return send(res, 403, loginPage("That change did not come from this console, so it was refused.", "bad"));

  if (path === "/login") {
    if (method === "GET") return send(res, 200, loginPage(url.searchParams.has("ended") ? "You were signed out." : ""));
    if (method !== "POST") return send(res, 405, "");
    const f = await form(req), r = await signIn(f.get("email") ?? "", f.get("password") ?? "");
    if (!r.ok) {
      const msg = r.reason === "locked" ? `Too many wrong passwords. Sign-in is paused for about ${Math.ceil((r.waitSec ?? 900) / 60)} minutes.`
        : r.reason === "not set" ? "The owner's password has not been set yet. Set it at the PC's terminal: deploy/pc/console-password.sh" : "That e-mail and password do not match.";
      return send(res, r.reason === "locked" ? 429 : 401, loginPage(msg, "bad"));
    }
    // The right password is the first step: the second is the code e-mailed to the owner's own address, entered in this same browser.
    const c = await sendCode(r.email);
    if (!c.ok) return send(res, c.reason === "wait" ? 429 : 503, loginPage(c.reason === "wait" ? "A code was e-mailed less than a minute ago. Use that one, or wait a minute and sign in again." : "The sign-in code could not be e-mailed, so sign-in cannot finish. Try again in a few minutes.", "bad"));
    setCookie(req, res, c.pending, CODE_MS / 1000, "pending");
    return go(res, "/login/code");
  }
  if (path === "/login/code") {
    const pending = cookie(req, cookieName(req, "pending"));
    if (method === "GET") return pending ? send(res, 200, codePage()) : go(res, "/login");
    if (method !== "POST") return send(res, 405, "");
    // The same form sent twice (a double click, Enter and a click): the first one signed this browser in and used the code, so the second goes straight
    // in rather than saying the code was wrong (owner, 11 Nov 2026: "I'm putting in the right code but it's not letting me go in").
    if (await sessionFor(cookie(req, cookieName(req)))) return go(res, "/");
    const f = await form(req), r = await checkCode(pending, f.get("code") ?? "");
    if (!r.ok) return r.reason === "locked"
      ? send(res, 429, loginPage(`Too many wrong tries. Sign-in is paused for about ${Math.ceil((r.waitSec ?? 900) / 60)} minutes.`, "bad"))
      : send(res, 401, codePage("That code is not right, has been used, or is older than 10 minutes. A new one comes with signing in again.", "bad"));
    setCookie(req, res, "", 0, "pending");
    setCookie(req, res, await startSession(client(req.headers["user-agent"]), r.email), 8 * 3600);
    return go(res, "/");
  }

  // A page: its session, alerts and numbers come in one trip (trip.ts). A change (POST) checks the session on its own, as before.
  // Every page that counts what happened reads the period the owner chose (?p=, period.ts; owner, 12 Nov 2026: "for every section").
  const WANTS: Record<string, Summary[]> = { "/": ["overview", "organisations", "period"], "/organisations": ["organisations", "period"], "/portals": ["portals", "period"], "/activity": ["period"],
    "/people": ["people", "period"], "/ai": ["period"], "/database": ["database"], "/schema": ["schema"], "/backups": ["overview"], "/alerts": ["period"], "/trends": [] };
  // One person's or one portal's page reads the same summary as its list.
  // A person's page reads that one person (console_person, migration 057), never a list that might not hold them (code review, 16 Nov 2026, D-M3).
  if (/^\/people\/[0-9a-f-]{36}$/.test(path)) WANTS[path] = [];
  if (/^\/portals\/[0-9a-f-]{36}$/.test(path)) WANTS[path] = ["portals", "period"];
  const sid = cookie(req, cookieName(req)), pageTrip = method === "GET" && (WANTS[path] || /^\/alerts\/\d+$/.test(path));
  // Nobody signed in: straight to sign-in, with nothing read from the database (12 Nov 2026: a page asked without a session used to fetch its numbers first).
  if (!wellFormed(sid)) return method === "GET" ? go(res, "/login") : send(res, 401, loginPage("Your session ended. Sign in again.", "warn"));
  let t: Awaited<ReturnType<typeof trip>> | null = null, why = "";
  const per = periodOf(url.searchParams.get("p"));
  // A page that reloads itself (view.ts: every 10 seconds, Portals every 5) is not the owner using the console, so it does not keep the session alive:
  // left open on a laptop, it used to stay signed in for the full 8 hours, and the 15-minute idle limit never came (code review, 16 Nov 2026, D-M2).
  // The browser says which is which: a navigation a person started carries Sec-Fetch-User, the page's own refresh does not. A browser that sends no
  // fetch metadata at all is taken at its word, as before, so the console never signs out someone who is using it.
  const byPerson = !(method === "GET" && req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-user"] !== "?1");
  const listPage = Math.min(Math.max(Math.floor(Number(url.searchParams.get("page") ?? 1)) || 1, 1), 1000);
  if (pageTrip) { try { t = await trip(sid, WANTS[path] ?? [], Date.now(), per, byPerson, listPage); } catch (e: any) { why = `the database did not answer (${String(e?.code ?? e?.message ?? e).slice(0, 100)})`; } }
  const session = pageTrip ? (t ? t.session : await sessionFor(sid, byPerson)) : await sessionFor(sid, byPerson);
  if (pageTrip && t && !t.session && sid) void endSession(sid).catch(() => {});
  if (!session || !sid) return method === "GET" ? go(res, "/login") : send(res, 401, loginPage("Your session ended. Sign in again.", "warn"));
  const token = formToken(sid), by = (session as any).owner_email ?? null;   // which of the two accounts (migration 052)
  if (method === "POST") {
    const f = await form(req);
    if (!sameToken(f.get("t") ?? "", token)) return send(res, 403, loginPage("That form was out of date, so nothing changed.", "bad"));
    if (path === "/logout") { await endSession(sid); setCookie(req, res, "", 0); return go(res, "/login?ended"); }
    const m = /^\/alerts\/(\d+)\/(ack|mute)$/.exec(path);
    if (m) { m[2] === "ack" ? await acknowledge(Number(m[1])) : await mute(Number(m[1]), Number(f.get("minutes") ?? 60)); return go(res, `/alerts/${m[1]}`); }
    // The owner's actions (actions.ts). A refusal (a name not typed exactly, a reason missing) shows the page again with what to do; nothing changed.
    const alerts = needsYou(await listEventsQuiet()).length;
    const pa = /^\/people\/([0-9a-f-]{36})\/(signout|block|allow|delete)$/.exec(path);
    if (pa) {
      const person = await personById(pa[1]); if (!person) return send(res, 404, loginPage("No such person.", "warn"));
      try {
        if (pa[2] === "signout") { const k = await signOutEverywhere(person, by); return go(res, `/people/${pa[1]}?done=signout&n=${k}`); }
        if (pa[2] === "block" || pa[2] === "allow") { await setBlocked(person, pa[2] === "block", by); return go(res, `/people/${pa[1]}?done=${pa[2]}`); }
        await deletePerson(person, f.get("confirm") ?? "", by); return go(res, "/people?done=deleted");
      } catch (e) { if (e instanceof ActionRefused) return send(res, 400, personPage(person, token, alerts, { message: e.message, tone: "bad", actions: await recentActions(person.id) })); throw e; }
    }
    const po = /^\/portals\/([0-9a-f-]{36})\/(support|delete)$/.exec(path);
    if (po) {
      const portal = await portalById(po[1]); if (!portal) return send(res, 404, loginPage("No such portal.", "warn"));
      try {
        if (po[2] === "support") { await openSupport(portal, f.get("reason") ?? "", by); return go(res, `/portals/${po[1]}?done=support`); }
        await deletePortal(portal, f.get("confirm") ?? "", f.get("why") ?? "", by); return go(res, "/portals?done=portal-deleted");
      } catch (e) { if (e instanceof ActionRefused) return send(res, 400, await portalView(portal, token, alerts, e.message, "bad")); throw e; }
    }
    const co = /^\/companies\/([0-9a-f-]{36})\/(allowance|delete)$/.exec(path);
    if (co) {
      const c = await company(co[1]), back = url.searchParams.get("portal") ?? "", portal = /^[0-9a-f-]{36}$/.test(back) ? await portalById(back) : null;
      if (!c) return send(res, 404, loginPage("No such company.", "warn"));
      try {
        if (co[2] === "allowance") { await setAllowance(c, f.get("usd") ?? "", by); return go(res, portal ? `/portals/${portal.id}?done=allowance` : "/portals"); }
        await deleteCompany(c, f.get("confirm") ?? "", f.get("why") ?? "", by); return go(res, "/portals?done=company-deleted");
      } catch (e) { if (e instanceof ActionRefused) return portal ? send(res, 400, await portalView(portal, token, alerts, e.message, "bad")) : send(res, 400, loginPage(e.message, "bad")); throw e; }
    }
    return send(res, 404, "");
  }
  if (method !== "GET") return send(res, 405, "");
  await todaysRate();
  const events = t?.events ?? [], open = needsYou(events).length, d = t?.data ?? {};
  const pd = d.period ?? null, since = pd?.since ?? null;
  const read = (k: Summary) => (d[k] !== undefined && d[k] !== null ? { ok: true as const, value: d[k], ageSec: 0 } : { ok: false as const, why: why || "no answer" });
  if (path === "/" || path === "/backups") {
    const h = path === "/" ? await health() : { ok: false as const, why: "not asked" };
    const today = buildToday(path === "/" ? h : await health(), host(), read("overview"), events);
    if (path === "/backups") return send(res, 200, backupsPage(today, token, open));
    return send(res, 200, todayPage(today, token, open, { activity: pd ? shapePeriod(pd, per) : null, organisations: d.organisations ? shapeOrganisations(d.organisations) : null,
      aiUsd: pd?.ai ? usd(Number(pd.ai.microUsd ?? 0)) : null, ai: pd?.ai ?? null, where: whereIs(), why, period: per, byOrg: pd?.byOrg ?? null, since: pd?.since ?? null }));
  }
  const GONE: Record<string, string> = { deleted: "The account is deleted.", "portal-deleted": "The portal is deleted; its original files are removed within a minute.", "company-deleted": "The company is deleted; its files are removed within a minute." };
  if (path === "/portals") return send(res, 200, portalsPage(Array.isArray(d.portals) ? d.portals : null, why, token, open, GONE[url.searchParams.get("done") ?? ""], per, pd?.byPortal ?? null, since));
  if (path === "/organisations") return send(res, 200, organisationsPage(d.organisations ? shapeOrganisations(d.organisations) : null, why, token, open, per, pd?.byOrg ?? null, since));
  if (path === "/activity") return send(res, 200, activityPage(pd ? shapePeriod(pd, per) : null, why, token, open, per, since));
  if (path === "/people") return send(res, 200, peoplePage(d.people ?? null, why, token, open, GONE[url.searchParams.get("done") ?? ""], per, pd, since));
  if (path === "/ai") return send(res, 200, aiPage(pd?.ai ?? null, why, pd ? shapePeriod(pd, per) : null, token, open, per, since));
  if (path === "/trends") { const r = rangeOf(url.searchParams.get("r")); return send(res, 200, trendsPage(await readTrends(r), r, token, open)); }
  if (path === "/schema") return send(res, 200, schemaPage(d.schema ?? null, why, token, open));
  if (path === "/alerts") {
    const only = (["urgent", "today", "info"] as const).find((x) => x === url.searchParams.get("only")) as Severity | undefined;
    return send(res, 200, alertsPage(only ? events.filter((e) => e.severity === only) : events, token, open, only, per, since));
  }
  if (path === "/database") return send(res, 200, databasePage(judgeDatabase(read("database"), migrationFiles()), token, open));
  const DONE: Record<string, string> = { signout: `Signed out of ${url.searchParams.get("n") ?? "every"} session(s), on every device.`, block: "Sign-in blocked, and they were signed out.",
    allow: "Sign-in allowed again.", support: "The log is open for an hour, and the company sees that support looked.", allowance: "Allowance set; it applies within 30 seconds." };
  const doneMsg = DONE[url.searchParams.get("done") ?? ""];
  const pp = /^\/people\/([0-9a-f-]{36})$/.exec(path);
  if (pp) {
    const x = await personById(pp[1]);
    return x ? send(res, 200, personPage(x, token, open, { message: doneMsg, actions: await recentActions(x.id) })) : send(res, 404, loginPage("No such person.", "warn"));
  }
  const pt = /^\/portals\/([0-9a-f-]{36})$/.exec(path);
  if (pt) {
    const p = (Array.isArray(d.portals) ? d.portals : []).find((y: any) => y.id === pt[1]);
    return p ? send(res, 200, await portalView(p, token, open, doneMsg, "good", per, pd?.byPortal?.[p.id] ?? null)) : send(res, 404, loginPage("No such portal.", "warn"));
  }
  const a = /^\/alerts\/(\d+)$/.exec(path);
  if (a) { const e = await getEvent(Number(a[1])); return e ? send(res, 200, alertPage(e, token, open)) : send(res, 404, loginPage("No such alert.", "warn")); }
  return send(res, 404, loginPage("No such page.", "warn"));
}

export function start(port = PORT, bind = BIND) {
  const server = createServer((req, res) => {
    handle(req, res).catch((e: any) => {
      console.error(JSON.stringify({ level: "error", event: "console.request_failed", path: (req.url ?? "").split("?")[0], error: String(e?.message ?? e).slice(0, 200) }));
      if (!res.headersSent) send(res, e?.status ?? 500, loginPage("Something went wrong on the console. Try again.", "bad")); else res.end();
    });
  });
  server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  return new Promise<typeof server>((ok) => server.listen(port, bind, () => { console.log(JSON.stringify({ event: "console.started", port, bind })); ok(server); }));
}

if (import.meta.main) await start();

/** Today's rand per dollar for the console's rand estimates (view.ts setRate), read at most every 10 minutes; a database without rates yet (before
 *  migration 048) or a failed read leaves the last one known, or none, and the page shows dollars alone. */
let rateAt = 0;
async function todaysRate() {
  if (Date.now() - rateAt < 10 * 60_000) return;
  rateAt = Date.now();
  await asConsole((q) => q`select usd_zar, published::text as published from fx_rates order by day desc limit 1`)
    .then((r: any[]) => { if (r[0]) setRate({ usdZar: Number(r[0].usd_zar), published: String(r[0].published).slice(0, 10) }); })
    .catch(() => { /* no rates kept yet: dollars alone */ });
}

/** One person or one portal, read fresh from the console's own summaries (never from a form). A person is read by id, whoever they are: looking them up
 *  in the People list found only the first 1,000 accounts (code review, 16 Nov 2026, D-M3). */
const personById = (id: string) => asConsole((q) => q`select console_person(${id}::uuid) as v`).then((r: any[]) => r[0]?.v ?? null);
const portalById = (id: string) => asConsole((q) => q`select console_portals() as v`).then((r: any[]) => (r[0]?.v ?? []).find((x: any) => x.id === id) ?? null);
const listEventsQuiet = () => listEvents().catch(() => []);
async function portalView(p: any, token: string, alerts: number, message?: string, tone: "good" | "bad" = "good", period = periodOf(null), inPeriod: any = null) {
  const [co, log, actions] = await Promise.all([p.orgId ? company(p.orgId) : null, supportLog(p.id), recentActions(p.id)]);
  return portalPage(p, co, token, alerts, { message, tone, log, actions, defaultAllowance: orgCapUsd(), period, inPeriod });
}
