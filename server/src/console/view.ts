// The console's pages, drawn on the server as plain HTML and one stylesheet: no script, nothing from another site, nothing private cached.
// The look is the one the owner chose on 11 Nov 2026: D, the control room in glass (docs/database/23_CONSOLE_PLAN.md; design canvas "RoleMatch Console
// looks"). Its rules: colour means one thing each (blue the platform and its counts, cyan jobs, teal matches, green healthy and moving forward, amber
// needs you, orange AI and money, red only when something is down); the background's glow follows the platform's state; on a laptop the Overview is one
// screen with nothing to scroll or squashed, and other pages scroll only where a long list needs it (owner, 12 Nov 2026); no big headline, one quiet line
// says how things are; the phone has its own composition, the Overview in tabs, never the laptop page cut down. The colours, glass, glow and type are
// tokens (the first lines of CSS below), so the customer Overview can take this look as a skin if the owner asks (owner, 12 Nov 2026).
// Charts are SVG drawn here; movement is CSS only, and stops for anyone whose device asks for less motion. Every colour has a word beside it.
import type { DatabaseView } from "./database";
import type { Activity, Organisation } from "./insights";
import type { Line, Today, Tone } from "./today";
import type { OwnerEvent, Severity } from "./store";
import { RANGES, type TrendChart, type TrendRange, type Trends, type Unit } from "./trends";
import { createHash } from "node:crypto";
import { ago } from "./today";
import { choices, DEFAULT_PERIOD, periodOf, withPeriod, type Period } from "./period";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const WORD: Record<Tone, string> = { good: "Good", warn: "Look", bad: "Problem", unknown: "Unknown" };
const SEV: Record<Severity, string> = { urgent: "Urgent", today: "Today", info: "Info" };
const sevTone = (s: Severity): Tone => (s === "urgent" ? "bad" : s === "today" ? "warn" : "good");
const TZ = "Africa/Johannesburg";
const at = (d: Date | string | null) => (d ? new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "");
const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : "");
const secondsSince = (d: Date | string) => Math.round((Date.now() - new Date(d).getTime()) / 1000);
const n = (v: number) => Math.round(v).toLocaleString("en-ZA");
const usd = (v: number) => `$${v < 10 ? v.toFixed(2) : n(v)}`;
/** Rand per dollar today (fx_rates, migration 048), set by the console server before a page is drawn; null while none is kept. The console is in dollars,
 *  as the AI is bought; beside a dollar total, an estimate in rand at today's real rate (owner, 12 Nov 2026: "we can only estimate based on the current
 *  exchange rate today"). Never a fixed rate. */
let RATE: { usdZar: number; published: string } | null = null;
export const setRate = (r: { usdZar: number; published: string } | null) => { RATE = r; };
const zar = (v: number) => (RATE ? `about R${n(v * RATE.usdZar)} at R${RATE.usdZar.toFixed(2)}/$` : "");
const bytes = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

// ---- the frame -------------------------------------------------------------------------------------------------------------------------------------

/** Line icons, one per place, drawn in the text's colour. */
const ICON: Record<string, string> = {
  today: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  organisations: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M3 21h18"/>',
  portals: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  trends: '<path d="M3 20h18M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-2.5-5.1"/>',
  ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  alerts: '<path d="M12 3.5l9 16.5H3z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  schema: '<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><path d="M6.5 9v4.5a2 2 0 0 0 2 2H14"/>',
  backups: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.4 2.4L15.5 10"/>',
  out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/>',
};
const svg = (name: string) => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[name] ?? ""}</svg>`;

/** The console's places, grouped as the owner reads them. One list draws the laptop's rail and the phone's menu. */
const NAV = [
  { group: "", items: [["today", "/", "Overview"], ["organisations", "/organisations", "Organisations"], ["portals", "/portals", "Portals"]] },
  { group: "Platform", items: [["activity", "/activity", "Activity"], ["trends", "/trends", "Trends"], ["people", "/people", "People and sign-in"], ["ai", "/ai", "AI"], ["alerts", "/alerts", "Alerts"]] },
  { group: "Data", items: [["database", "/database", "Database"], ["schema", "/schema", "Schema"], ["backups", "/backups", "Backups and files"]] },
] as const;
export type Tab = (typeof NAV)[number]["items"][number][0];
const TITLE: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map(([id, , label]) => [id, label])));
/** The phone's bar: the five places the owner opens most; everything else is in its menu. */
const PHONE_BAR: Tab[] = ["today", "portals", "people", "ai", "alerts"];
/** "RoleMatch" with the four letters of "Role" in their own colours, as the brand writes it. */
const wordmark = `<span class="wm"><b class="w1">R</b><b class="w2">o</b><b class="w3">l</b><b class="w4">e</b>Match</span>`;

/** Johannesburg's time when the page was drawn, kept turning by the stylesheet alone (the console sends no script): the hours and the minutes are each a
 *  column of figures that steps on once an hour and once a minute, started where the clock already is. Out of the way, beside the refresh. */
function clock(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0), h = g("hour") % 24, m = g("minute"), s = g("second");
  const column = (count: number) => Array.from({ length: count }, (_, i) => `<i>${String(i).padStart(2, "0")}</i>`).join("");
  const date = new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(now);
  return `<span class="clock" role="timer" aria-label="Johannesburg time when this page opened: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}" title="Johannesburg time">`
    + `<span class="hh" aria-hidden="true"><span style="animation-delay:-${h * 3600 + m * 60 + s}s">${column(24)}</span></span><span class="colon" aria-hidden="true">:</span>`
    + `<span class="mm" aria-hidden="true"><span style="animation-delay:-${m * 60 + s}s">${column(60)}</span></span><small>${esc(date)}</small></span>`;
}

/** refresh: reload the page every so many seconds (no script: the console sends none), for pages whose figures must keep up as they change.
 *  tone and state: how the platform is, for the quiet line at the top and the glow behind everything; a page that does not know says what the alerts say. */
const CONSOLE_REFRESH_SEC = 10;
export function page(title: string, body: string, o: { tab?: Tab; token?: string; alerts?: number; where?: string; checked?: string; refresh?: number; tone?: Tone; state?: string; fit?: boolean; form?: boolean; period?: Period; choose?: boolean; since?: string | null } = {}) {
  // Every page keeps itself current (owner, 12 Nov 2026: "I keep having to press refresh ... it was 8:47 and it said checked 8:46"): every 10 seconds,
  // Portals every 5. Not Schema (it changes only with a release, and a reload would close the table being read), and never a page with a form to fill in.
  const refresh = o.refresh ?? (o.tab && o.tab !== "schema" && !o.form ? CONSOLE_REFRESH_SEC : undefined);
  const tone: Tone = o.tone ?? (o.alerts ? "warn" : "good");
  const state = o.state ?? (o.alerts ? `${o.alerts} ${o.alerts === 1 ? "alert needs" : "alerts need"} you` : "No open alerts");
  const per = o.period ?? periodOf(DEFAULT_PERIOD);
  const link = ([id, href, label]: readonly string[]) => `<a href="${esc(withPeriod(href, per))}" ${o.tab === id ? 'aria-current="page"' : ""} title="${esc(label)}"><i aria-hidden="true">${svg(id)}</i><span>${esc(label)}</span>${id === "alerts" && o.alerts ? `<b class="count" aria-label="${o.alerts} open">${o.alerts}</b>` : ""}</a>`;
  const groups = NAV.map((g) => `${g.group ? `<p class="group">${g.group}</p>` : ""}${g.items.map(link).join("")}`).join("");
  const phoneBar = (NAV.flatMap((g) => [...g.items]) as readonly (readonly string[])[]).filter(([id]) => PHONE_BAR.includes(id as Tab)).map(link).join("");
  const shell = o.tab ? `
  <div class="orbs" aria-hidden="true"><i class="o1"></i><i class="o2"></i><i class="glow"></i></div>
  <nav class="rail" aria-label="Console"><a class="mark" href="${esc(withPeriod("/", per))}" aria-label="RoleMatch console">${wordmark.replace("Match", "")}</a>${groups}
    <form method="post" action="/logout" class="out"><input type="hidden" name="t" value="${esc(o.token)}"><button class="link" title="Sign out" aria-label="Sign out">${svg("out")}</button></form></nav>
  <header class="top"><p class="crumb">${wordmark}<span class="dim">Console</span><span class="sep" aria-hidden="true">/</span><b>${esc(TITLE[o.tab] ?? title)}</b></p>
    <p class="state ${tone}" role="status">${dot(tone)}${esc(state)}</p>${o.choose ? periodSwitch(per, o.since) : ""}
    <p class="live">${o.where ? `<span class="chip-mono">${esc(o.where)}</span>` : ""}${o.checked ? `<span class="muted">checked ${esc(o.checked)}</span>` : ""}${clock()}<a class="btn ghost small" href="">Refresh</a></p></header>
  <nav class="dock" aria-label="Console">${phoneBar}<details class="more"><summary aria-label="Everything else"><span>More</span></summary><div class="sheet">${groups}
    <form method="post" action="/logout"><input type="hidden" name="t" value="${esc(o.token)}"><button class="link">Sign out</button></form></div></details></nav>` : "";
  return `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">${refresh ? `<meta http-equiv="refresh" content="${Math.max(2, Math.round(refresh))}">` : ""}<meta name="color-scheme" content="dark"><title>${esc(title)} · RoleMatch Console</title>
<link rel="stylesheet" href="/console.css?v=${CSS_VERSION}"></head><body class="${o.tab ? `app state-${tone}` : "plain"}">${shell}<main id="main"${o.fit ? ' class="fit"' : ""}>${body}</main></body></html>`;
}

/** The period switch (owner, 12 Nov 2026): 24 hours, 7 days, 30 days, 3 months, and each month since the platform began, in a list that opens.
 *  Links only (the console sends no script); the choice travels with every link of the console until it is changed. */
function periodSwitch(p: Period, since?: string | null) {
  const c = choices(since ?? null), on = (k: string) => (k === p.key ? ' aria-current="true"' : "");
  const month = c.months.find((m) => m.key === p.key);
  return `<nav class="periods" aria-label="Period: ${esc(p.label)}">${c.recent.map((x) => `<a href="?p=${x.key}"${on(x.key)}>${esc(x.label)}</a>`).join("")}`
    + `<details class="months"><summary${month ? ' aria-current="true"' : ""}>${esc(month ? month.label : "Month")}</summary><div>${c.months.map((x) => `<a href="?p=${x.key}"${on(x.key)}>${esc(x.label)}</a>`).join("")}</div></details></nav>`;
}
/** "in the last 7 days", "in November 2026". */
const during = (p: Period) => (p.month ? `in ${p.label}` : `in the ${p.label.toLowerCase()}`);
const inPeriod = (d: Date | string | null | undefined, p: Period) => !!d && new Date(d) >= p.from && new Date(d) < p.to;
const byHour = (p: Period) => (p.step === "hour" ? "hour by hour" : "day by day");

// ---- pieces ----------------------------------------------------------------------------------------------------------------------------------------

/** The symbol beside each kind of number, the same on every page. */
const KIND: Record<string, string> = { cvs: "▤", jobs: "▣", matches: "⇄", shortlisted: "★", people: "◉", aiMicroUsd: "✦" };
const dot = (t: Tone) => `<span class="dot ${t}" aria-hidden="true"></span><span class="sr">${WORD[t]}:</span>`;
const pill = (t: Tone, word: string) => `<span class="pill ${t}">${dot(t)}${esc(word)}</span>`;
/** No big headline (owner, 11 Nov 2026: "this is just for me"): the page's name is in the top line; here, its heading for screen readers and one quiet line. */
const head = (title: string, line: string, extra = "") => `<div class="head"><h1 class="sr">${esc(title)}</h1><p class="lede">${esc(line)}</p>${extra}</div>`;
const card = (title: string, body: string, o: { line?: string; wide?: boolean; id?: string; cls?: string; sec?: string; tone?: string } = {}) =>
  `<section class="card${o.wide ? " wide" : ""}${o.cls ? ` ${o.cls}` : ""}"${o.id ? ` id="${o.id}"` : ""}${o.sec ? ` data-sec="${o.sec}"` : ""} aria-label="${esc(title)}"><header><h2${o.tone ? ` class="${o.tone}"` : ""}>${esc(title)}</h2>${o.line ? `<p>${esc(o.line)}</p>` : ""}</header><div class="body">${body}</div></section>`;
const empty = (words: string) => `<p class="empty">${esc(words)}</p>`;

/** A small trend line under a number: the last 30 days, its area softly filled in the metric's colour. */
export function spark(values: number[], colour: string, w = 120, h = 30) {
  if (!values.length) return "";
  const max = Math.max(1, ...values), step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`);
  return `<svg class="spark ${colour}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${h} ${pts.join(" ")} ${w},${h}"/><polyline points="${pts.join(" ")}"/></svg>`;
}
/** A larger chart for a page: each series a line with its area, the dates under it, the highest value beside it; a day's numbers on hover. Drawn at the
 *  width it is usually shown, so its words read at the size of the page's own (12 Nov 2026: they were too small to read). */
export function area(dates: string[], series: { label: string; colour: string; values: number[] }[], h = 200, o: { labels?: string[]; unit?: "hour" | "day" } = {}) {
  // The drawing stretches to fill its box, so its words are not in it (they would stretch too): the dates sit under it and the highest value in its key,
  // as the page's own text, always crisp (12 Nov 2026: they were stretched and too small to read). A day's figures show on hover.
  const w = 640, padT = 6, padB = 2, max = Math.max(1, ...series.flatMap((s) => s.values)), len = Math.max(1, dates.length - 1);
  const x = (i: number) => (i / len) * w, y = (v: number) => h - padB - (v / max) * (h - padB - padT);
  const lines = series.map((s) => { const p = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `<g class="${s.colour}"><polygon points="${x(0)},${h} ${p} ${x(s.values.length - 1)},${h}"/><polyline points="${p}"/></g>`; }).join("");
  const grid = [0.5, 1].map((f) => `<line x1="0" x2="${w}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/>`).join("");
  const label = (i: number) => (o.labels ? o.labels[i] ?? "" : dates[i] ? new Date(`${dates[i]}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: TZ }) : "");
  const hover = dates.map((d, i) => `<rect x="${(x(i) - w / len / 2).toFixed(1)}" y="0" width="${(w / len).toFixed(1)}" height="${h}"><title>${esc(label(i))}: ${series.map((s) => `${s.label} ${n(s.values[i] ?? 0)}`).join(", ")}</title></rect>`).join("");
  const key = `<ul class="key">${series.map((s) => `<li class="${s.colour}"><span aria-hidden="true"></span>${esc(s.label)}</li>`).join("")}<li class="top">highest ${n(max)} in ${o.unit === "hour" ? "an hour" : "a day"}</li></ul>`;
  return `${key}<svg class="area" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map((s) => s.label).join(", "))}, ${o.unit === "hour" ? "hour by hour" : "day by day"}"><g class="grid">${grid}</g>${lines}<g class="hover">${hover}</g></svg>`
    + `<p class="axis" aria-hidden="true"><span>${esc(label(0))}</span><span>${esc(label(Math.round(len / 2)))}</span><span>${esc(label(len))}</span></p>`;
}
/** A number with what it is, how it changed, and its trend. */
const kpi = (label: string, value: string, o: { colour?: string; change?: string; series?: number[]; sub?: string; href?: string; icon?: string } = {}) => {
  const up = o.change?.startsWith("up"), down = o.change?.startsWith("down");
  const inner = `<p class="label"><i class="tile ${o.colour ?? "r"}" aria-hidden="true">${o.icon ?? "◆"}</i>${esc(label)}</p><p class="num ${o.colour ?? "r"}">${esc(value)}</p>
    <p class="sub">${o.change ? `<span class="chg${up ? " up" : down ? " down" : ""}">${up ? "↗" : down ? "↘" : "→"} ${esc(o.change)}</span>` : ""}${o.sub ? `<span>${esc(o.sub)}</span>` : ""}</p>${o.series ? spark(o.series, o.colour ?? "r") : ""}`;
  return o.href ? `<a class="kpi ${o.colour ?? "r"}" href="${o.href}">${inner}</a>` : `<div class="kpi ${o.colour ?? "r"}">${inner}</div>`;
};
/** Things ranked by size, each a bar in proportion to the largest. */
const bars = (rows: { name: string; value: number; shown: string }[], colour = "r") => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.length ? `<ul class="bars ${colour}">${rows.map((r) => `<li><span class="name" title="${esc(r.name)}">${esc(r.name)}</span><span class="bar"><i style="--w:${Math.max(2, (r.value / max) * 100).toFixed(1)}%"></i></span><b>${esc(r.shown)}</b></li>`).join("")}</ul>` : empty("Nothing yet.");
};
const rowsOf = (ls: Line[]) => `<dl class="lines">${ls.map((l) => `<div class="row">${dot(l.tone)}<dt>${esc(l.label)}</dt><dd>${esc(l.value)}${l.why ? `<small>${esc(l.why)}</small>` : ""}</dd></div>`).join("")}</dl>`;
const status = (tone: Tone, headline: string, detail: string, extra = "") => `<section class="status ${tone}" role="status"><span class="big">${dot(tone)}${esc(headline)}</span><p>${esc(detail)}</p>${extra}</section>`;
const unknownCard = (title: string, why: string) => card(title, empty(`Cannot be shown just now: ${why}.`));
const purpose = (name: string) => (name === "extraction" ? "Reading CVs and jobs" : name === "matching" ? "Matching" : name === "evaluation" ? "Measuring accuracy" : name);

// ---- Overview --------------------------------------------------------------------------------------------------------------------------------------
// One screen on a laptop, always (owner, 12 Nov 2026: "definitely not an overview page" to scroll): the numbers, then the platform's health beside what
// needs the owner, then the month's work, AI spend by company, and the busiest companies. On a phone, the same in three tabs (no script: the tabs are
// radio buttons and the stylesheet shows the chosen part).

export function todayPage(t: Today, token: string, alerts: number, more: { activity?: Activity | null; organisations?: Organisation[] | null; where?: string; aiUsd?: number | null; ai?: any | null; why?: string; period?: Period; byOrg?: Record<string, any> | null; since?: string | null } = {}) {
  const a = more.activity, m = (k: string) => a?.metrics.find((x) => x.key === k), p = more.period ?? periodOf(null);
  const kpis = a ? `<div class="kpis six" data-sec="now">${(["cvs", "jobs", "matches", "shortlisted"] as const).map((k) => { const x = m(k)!; return kpi(`${x.label} · ${p.short}`, n(x.total), { colour: x.colour, change: x.change, series: x.series, href: withPeriod("/activity", p), icon: KIND[k] }); }).join("")}
    ${kpi(`AI · ${p.short}`, more.aiUsd === null || more.aiUsd === undefined ? "unknown" : usd(more.aiUsd), { colour: "o", icon: "✦", sub: more.aiUsd ? zar(more.aiUsd) : "", series: m("aiMicroUsd")?.series, href: withPeriod("/ai", p) })}
    ${kpi("Organisations", more.organisations ? n(more.organisations.length) : "unknown", { colour: "r", icon: "▦", sub: more.organisations ? `${n(more.organisations.reduce((s, o) => s + o.people, 0))} people` : "", href: withPeriod("/organisations", p) })}</div>` : "";
  const health = card("Live health", `<div class="svcs">${t.lines.map((l) => `<div class="svc" title="${esc(l.why ?? l.value)}">${dot(l.tone)}<span><b>${esc(l.label)}</b><small>${esc(l.value)}</small></span></div>`).join("")}</div>`,
    { id: "health", sec: "health", line: "Every part of live, checked as this page opened.", cls: "health" });
  const needsList = t.needs.length ? `<ul class="list">${t.needs.map((x) => `<li>${dot(x.tone)}<a href="${esc(x.href)}">${esc(x.title)}</a></li>`).join("")}</ul>` : `<p class="calm">${dot("good")}Nothing needs you.</p>`;
  // Under what needs the owner, what was wrong and is put right: never a notice (owner, 12 Nov 2026: "the console's password was set ... so what?").
  const fixed = resolvedOf(t.latest).filter((e) => inPeriod(e.cleared_at, p)).slice(0, 5);
  const latest = `<p class="minor">Resolved</p><ul class="feed">${fixed.length ? fixed.map((e) => `<li><time>${esc(at(e.first_at))}</time><a href="/alerts/${e.id}">${esc(e.title)}</a><span class="tag good">${esc(lasted(e))}</span></li>`).join("") : `<li class="muted">Nothing went wrong ${esc(during(p))}.</li>`}</ul>`;
  const needs = card(t.needs.length ? `${t.needs.length} ${t.needs.length === 1 ? "needs" : "need"} you` : "Needs you", needsList + latest, { sec: "now", cls: "needs", tone: t.needs.length ? "warn" : undefined });
  const chart = a ? card("Activity", area(a.dates, (["cvs", "matches", "shortlisted"] as const).map((k) => ({ label: m(k)!.label, colour: m(k)!.colour, values: m(k)!.series })), 180, { labels: a.labels, unit: a.step }), { line: `${p.label}, ${byHour(p)}.`, sec: "act", cls: "chart" }) : more.why ? unknownCard("Activity", more.why) : "";
  const byCompany = more.ai?.byOrganisation ? card(`AI by company · ${p.short}`, bars((more.ai.byOrganisation as any[]).slice(0, 6).map((r) => ({ name: r.name, value: Number(r.microUsd ?? 0), shown: usd(Number(r.microUsd ?? 0) / 1e6) })), "o") + `<a class="more" href="${esc(withPeriod("/portals", p))}">Each portal →</a>`, { sec: "act", tone: "o" }) : "";
  const added = (o: Organisation) => Number(more.byOrg?.[o.id ?? ""]?.cvs ?? 0);
  const orgs = more.organisations ? card("Busiest companies", bars([...more.organisations].sort((x, y) => added(y) - added(x) || y.cvs - x.cvs).slice(0, 6).map((o) => ({ name: o.name, value: added(o), shown: `${n(added(o))} ${added(o) === 1 ? "CV" : "CVs"}` })), "r") + `<a class="more" href="${esc(withPeriod("/organisations", p))}">Every company →</a>`, { sec: "act", line: `By CVs read ${during(p)}.` }) : "";
  const tabs = `<input type="radio" name="ov" id="ov-now" class="sr" checked><input type="radio" name="ov" id="ov-health" class="sr"><input type="radio" name="ov" id="ov-act" class="sr">
  <nav class="ovtabs" aria-label="Overview"><label for="ov-now">Now</label><label for="ov-health">Health</label><label for="ov-act">Work</label></nav>`;
  return page("Overview", `<h1 class="sr">Your platform, at a glance</h1>${tabs}<div class="ovw">${kpis}<div class="ovw-mid">${health}${needs}</div><div class="ovw-low">${chart}${byCompany}${orgs}</div></div>`,
    { tab: "today", token, alerts, where: more.where, tone: t.tone, state: t.headline, fit: true, period: p, choose: true, since: more.since, checked: new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) });
}

// ---- Organisations ---------------------------------------------------------------------------------------------------------------------------------

export function organisationsPage(list: Organisation[] | null, why: string, token: string, alerts: number, p: Period = periodOf(null), byOrg: Record<string, any> | null = null, since: string | null = null) {
  const frame = { tab: "organisations" as Tab, token, alerts, period: p, choose: true, since };
  if (!list) return page("Organisations", `${head("Organisations", "Every company on RoleMatch.")}${unknownCard("Organisations", why)}`, frame);
  const inP = (o: Organisation, k: string) => Number(byOrg?.[o.id ?? ""]?.[k] ?? 0), sumP = (k: string) => list.reduce((s, o) => s + inP(o, k), 0);
  const sum = (k: keyof Organisation) => list.reduce((s, o) => s + Number(o[k] ?? 0), 0), maxCv = Math.max(1, ...list.map((o) => o.cvs));
  const kpis = `<div class="kpis">${kpi("Organisations", n(list.length), { colour: "r", icon: "▦" })}${kpi("People", n(sum("people")), { colour: "r", icon: "◉" })}${kpi(`CVs read · ${p.short}`, n(sumP("cvs")), { colour: "r", icon: "▤", sub: `${n(sum("cvs"))} in all` })}${kpi(`AI · ${p.short}`, usd(sumP("aiMicroUsd") / 1e6), { colour: "o", icon: "✦", sub: zar(sumP("aiMicroUsd") / 1e6) })}</div>`;
  const rows = list.map((o) => `<tr><th scope="row"><b>${esc(o.name)}</b><small>since ${esc(day(o.since))}</small></th><td class="num">${n(o.portals)}</td><td class="num">${n(o.people)}</td>
    <td class="num cv"><span class="mini" style="--w:${((o.cvs / maxCv) * 100).toFixed(1)}%"></span>${n(o.cvs)}</td><td class="num">${n(o.jobs)}</td><td class="num">${n(inP(o, "cvs"))}</td><td class="num">${n(inP(o, "matches"))}</td><td class="num money">${usd(inP(o, "aiMicroUsd") / 1e6)}</td>
    <td>${o.lastActivity ? `<span title="${esc(at(o.lastActivity))}">${esc(ago(secondsSince(o.lastActivity)))}</span>` : '<span class="muted">nothing yet</span>'}</td></tr>`).join("");
  return page("Organisations", `${head("Organisations", `Every company on RoleMatch: its portals, people, CVs and jobs, and what it did ${during(p)}.`)}${kpis}
  ${card("Every organisation", list.length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">Organisation</th><th scope="col" class="num">Portals</th><th scope="col" class="num">People</th><th scope="col" class="num">CVs</th><th scope="col" class="num">Jobs</th><th scope="col" class="num">CVs read · ${esc(p.short)}</th><th scope="col" class="num">Matches · ${esc(p.short)}</th><th scope="col" class="num">AI · ${esc(p.short)}</th><th scope="col">Last activity</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No organisations yet."), { wide: true, line: "Most recently active first. CVs and jobs: everything they hold." })}`, frame);
}

// ---- Portals ------------------------------------------------------------------------------------------------------------------------------------------
// Owner, 11 Nov 2026: "a page for me to see all the portals that have been created and the email of the administrator, as well as how much usage that
// portal has been using ... continuously, at all times". Each portal read on its own (console_portals(), migration 046): counts, costs and e-mail
// addresses, never what is inside a portal. Until each company has its own AI key, every portal draws on RoleMatch's own credits.

export interface PortalRow { id: string; name: string; company: string; since: string; createdBy: string | null; admins: string[]; people: number; cvs: number; jobs: number; matches: number;
  aiCallsMonth: number; aiMicroUsdMonth: number; aiCallsAll: number; aiMicroUsdAll: number; byPurposeMonth: Record<string, number>; lastActivity: string | null; history: { at: string; action: string; by: string | null }[];
  orgId?: string; lastSeen?: string | null; activeNow?: number }
/** When someone last used RoleMatch, as Instagram says it (owner, 12 Nov 2026): "Active now" within 5 minutes; after that, the time stands where they
 *  stopped ("last active 2 h ago") until they come back (migration 049). */
const ACTIVE_MS = 5 * 60_000;
const lastActive = (seen: string | null | undefined, nowCount = 0) => (nowCount > 0 || (seen && Date.now() - new Date(seen).getTime() < ACTIVE_MS))
  ? `<span class="now">${dot("good")}Active now${nowCount > 1 ? ` · ${nowCount}` : ""}</span>`
  : seen ? `<span title="${esc(at(seen))}">${esc(ago(secondsSince(seen)))}</span>` : '<span class="muted">not yet</span>';
const CHANGE: Record<string, string> = { "portal.created": "Portal created", "portal.admin_appointed": "Administrator appointed", "portal.member_role_changed": "A role changed", "portal.member_left": "Someone left", "portal.member_removed": "Someone was removed" };
const PORTALS_REFRESH_SEC = 5;

export function portalsPage(list: PortalRow[] | null, why: string, token: string, alerts: number, message?: string, p: Period = periodOf(null), byPortal: Record<string, any> | null = null, since: string | null = null) {
  const per = p;   // the period; inside the lists below, p is each portal
  const line = "Every portal: who runs it, and what it has used. Each is kept apart from every other; this page shows counts, costs and administrators only.";
  const frame = { tab: "portals" as Tab, token, alerts, refresh: PORTALS_REFRESH_SEC, period: p, choose: true, since };
  if (!list) return page("Portals", `${head("Portals", line)}${unknownCard("Portals", why)}`, frame);
  const inP = (x: PortalRow, k: string) => Number(byPortal?.[x.id]?.[k] ?? 0), sumP = (k: string) => list.reduce((a, x) => a + inP(x, k), 0);
  // Money to the cent, always: usage is billed from these figures, so they are never rounded to whole dollars as the other pages' totals are.
  const cents = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sum = (k: keyof PortalRow) => list.reduce((a, p) => a + Number(p[k] ?? 0), 0), dollars = (micro: number) => "$" + cents.format(micro / 1_000_000);
  const kpis = `<div class="kpis">${kpi("Portals", n(list.length), { colour: "r", icon: "▣" })}${kpi(`AI calls · ${p.short}`, n(sumP("aiCalls")), { colour: "o", icon: "✦", sub: `${n(sum("aiCallsAll"))} in all` })}
    ${kpi(`AI cost · ${p.short}`, dollars(sumP("aiMicroUsd")), { colour: "o", icon: "$", sub: `${dollars(sum("aiMicroUsdAll"))} in all` })}${kpi("People in portals", n(sum("people")), { colour: "r", icon: "◉", sub: `${n(sum("activeNow"))} active now` })}</div>`;
  const rows = list.map((x) => { const p = x; return `<tr><th scope="row"><b><a href="${esc(withPeriod(`/portals/${p.id}`, per))}">${esc(p.name)}</a></b><small>${esc(p.company)}</small></th>
    <td>${p.admins.length ? p.admins.map((e) => `<span class="mono">${esc(e)}</span>`).join("<br>") : '<span class="muted">no administrator</span>'}</td>
    <td><small>${esc(day(p.since))}${p.createdBy ? ` · ${esc(p.createdBy)}` : ""}</small></td>
    <td class="num">${n(p.people)}</td><td class="num">${n(p.cvs)}</td><td class="num">${n(p.jobs)}</td><td class="num">${n(p.matches)}</td>
    <td class="num">${n(inP(p, "cvs"))}</td><td class="num">${n(inP(p, "aiCalls"))}</td><td class="num money"><b>${dollars(inP(p, "aiMicroUsd"))}</b><small>${dollars(p.aiMicroUsdAll)} in all</small></td>
    <td>${lastActive(p.lastSeen, p.activeNow)}</td></tr>`; }).join("");
  // On a phone each portal is a card of its own (its own composition, never the table squeezed sideways).
  const phone = `<ul class="pcards">${list.map((p) => `<li><p class="pc-top"><b>${esc(p.name)}</b><span class="money">${dollars(inP(p, "aiMicroUsd"))}</span></p><p class="pc-co">${esc(p.company)}</p>
    <p class="mono pc-admin">${p.admins.length ? p.admins.map(esc).join(", ") : "no administrator"}</p><p class="pc-n">${n(p.people)} people · ${n(p.cvs)} CVs · ${n(p.jobs)} jobs · ${n(p.matches)} matches · ${n(inP(p, "aiCalls"))} AI calls ${esc(during(per))}</p><p class="pc-n">Last active: ${lastActive(p.lastSeen, p.activeNow)}</p></li>`).join("")}</ul>`;
  const changes = list.flatMap((p) => p.history.map((h) => ({ ...h, portal: p.name, company: p.company }))).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 12);
  const history = changes.length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">When</th><th scope="col">Portal</th><th scope="col">What changed</th><th scope="col">By</th></tr></thead><tbody>${changes
    .map((c) => `<tr><td>${esc(at(c.at))}</td><td>${esc(c.portal)}<small>${esc(c.company)}</small></td><td>${esc(CHANGE[c.action] ?? c.action)}</td><td>${c.by ? `<span class="mono">${esc(c.by)}</span>` : '<span class="muted">RoleMatch</span>'}</td></tr>`).join("")}</tbody></table></div>` : empty("No changes of who runs a portal yet.");
  return page("Portals", `${head("Portals", line)}${note(message)}${kpis}
  ${card("Every portal", list.length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">Portal</th><th scope="col">Administrator</th><th scope="col">Created</th><th scope="col" class="num">People</th><th scope="col" class="num">CVs</th><th scope="col" class="num">Jobs</th><th scope="col" class="num">Matches</th><th scope="col" class="num">CVs read · ${esc(per.short)}</th><th scope="col" class="num">AI calls · ${esc(per.short)}</th><th scope="col" class="num">AI cost · ${esc(per.short)}</th><th scope="col">Last active</th></tr></thead><tbody>${rows}</tbody></table></div>${phone}` : empty("No portals yet."), { wide: true, cls: "portals", line: `Updated every ${PORTALS_REFRESH_SEC} seconds. People, CVs, jobs and matches: everything each portal holds. Every portal uses RoleMatch's own AI credits until each company has its own key.` })}
  ${card("Who runs each portal: the latest changes", history, { wide: true })}`, frame);
}

// ---- Activity --------------------------------------------------------------------------------------------------------------------------------------

export function activityPage(a: Activity | null, why: string, token: string, alerts: number, p: Period = periodOf(null), since: string | null = null) {
  const frame = { tab: "activity" as Tab, token, alerts, period: p, choose: true, since };
  if (!a) return page("Activity", `${head("Activity", "What happened on RoleMatch.")}${unknownCard("Activity", why)}`, frame);
  const shown = (k: string, v: number) => (k === "aiMicroUsd" ? usd(v / 1_000_000) : n(v));
  const kpis = `<div class="kpis six">${a.metrics.map((m) => kpi(`${m.label}`, shown(m.key, m.total), { colour: m.colour, change: m.change, series: m.series, icon: KIND[m.key] })).join("")}</div>`;
  const charts = a.metrics.map((m) => card(m.label, area(a.dates, [{ label: m.label, colour: m.colour, values: m.key === "aiMicroUsd" ? m.series.map((v) => v / 1_000_000) : m.series }], 150, { labels: a.labels, unit: a.step }), { line: `${shown(m.key, m.total)} ${during(p)} · ${m.change}`, cls: "chart" })).join("");
  return page("Activity", `${head("Activity", `${p.label}, ${byHour(p)}, each against ${p.beforeLabel}.`)}${kpis}<div class="grid three">${charts}</div>`, frame);
}

// ---- People and sign-in ----------------------------------------------------------------------------------------------------------------------------

export function peoplePage(p: any | null, why: string, token: string, alerts: number, message?: string, per: Period = periodOf(null), inP: any = null, since: string | null = null) {
  const frame = { tab: "people" as Tab, token, alerts, period: per, choose: true, since };
  if (!p) return page("People and sign-in", `${head("People and sign-in", "Every account on RoleMatch.")}${unknownCard("People", why)}`, frame);
  // Each sign-in is recorded from the move onto our own sign-in (12 Nov 2026); a period that starts before then is counted from that day, and says so.
  const recordedFrom = inP?.signInsSince ? new Date(inP.signInsSince) : null, partial = !recordedFrom || recordedFrom > per.from;
  const people: any[] = Array.isArray(p.people) ? p.people : [];
  const kpis = `<div class="kpis six">${kpi("Accounts", n(p.accounts), { colour: "r", icon: "◉", sub: `${n(p.confirmed)} confirmed` })}${kpi(`Signed in · ${per.short}`, inP ? n(Number(inP.people?.signedIn ?? 0)) : "unknown", { colour: "e", icon: "↗", sub: inP ? (partial ? `recorded from ${recordedFrom ? day(recordedFrom) : "the next sign-in"}` : `${n(Number(inP.people?.signIns ?? 0))} sign-ins`) : "" })}
    ${kpi("Never signed in", n(p.neverSignedIn), { colour: "r", icon: "○" })}${kpi("Active now", n(p.activeNow ?? 0), { colour: "e", icon: "●", sub: "in the last 5 minutes" })}
    ${kpi("Invitations open", n(p.invitationsOpen), { colour: "r", icon: "✉", sub: `${n(p.invitationsLapsed)} lapsed` })}${kpi(`Joined · ${per.short}`, inP ? n(Number(inP.people?.joined ?? 0)) : "unknown", { colour: "e", icon: "✓", sub: inP ? `${n(Number(inP.people?.invitationsAccepted ?? 0))} by invitation` : "" })}</div>`;
  const rows = people.map((x) => `<tr${x.left ? ' class="left"' : ""}><th scope="row"><b>${x.id ? `<a href="/people/${esc(x.id)}">${esc(x.name)}</a>` : esc(x.name)}</b><small>${esc(x.email ?? "")}${x.blocked ? " · sign-in blocked" : ""}</small></th><td>${esc(x.organisation)}</td><td><span class="tag">${esc(x.role === "viewer" ? "hiring manager" : x.role)}</span></td><td class="num">${n(x.portals)}</td>
    <td>${esc(day(x.joined))}</td><td>${lastActive(x.lastSeen)}</td><td>${x.lastSignIn ?`<span title="${esc(at(x.lastSignIn))}">${esc(ago(secondsSince(x.lastSignIn)))}</span>` : '<span class="muted">never</span>'}</td>
    <td>${x.left ? pill("unknown", "left") : x.confirmed ? pill("good", "confirmed") : pill("warn", "not confirmed")}</td></tr>`).join("");
  // Everyone, a page at a time (migration 057): the list used to stop at 1,000 accounts, and those past it could not be found (code review, 16 Nov 2026, D-M3).
  const total = Number(p.total ?? people.length), size = Number(p.pageSize ?? (people.length || 1)), pageNo = Number(p.page ?? 1), pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (pageNo - 1) * size + 1 : 0, to = Math.min(total, (pageNo - 1) * size + people.length);
  const pager = pages > 1 ? `<p class="pager">${pageNo > 1 ? `<a class="btn ghost small" href="${esc(withPeriod(`/people?page=${pageNo - 1}`, per))}">‹ More recently active</a>` : ""}<span class="muted">${n(from)} to ${n(to)} of ${n(total)}</span>${pageNo < pages ? `<a class="btn ghost small" href="${esc(withPeriod(`/people?page=${pageNo + 1}`, per))}">Less recently active ›</a>` : ""}</p>` : "";
  return page("People and sign-in", `${head("People and sign-in", "Every account on RoleMatch: who they are, where they work, and when they last signed in. Passwords and codes are never shown, anywhere.")}${note(message)}${kpis}
  ${card("Every account", people.length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">Person</th><th scope="col">Organisation</th><th scope="col">Role</th><th scope="col" class="num">Portals</th><th scope="col">Joined</th><th scope="col">Last active</th><th scope="col">Last signed in</th><th scope="col">Account</th></tr></thead><tbody>${rows}</tbody></table></div>${pager}` : empty(pageNo > 1 ? "No accounts on this page." : "No accounts yet."), { wide: true, line: `Most recently active first${pages > 1 ? `, ${n(size)} to a page` : ""}. Active now: used RoleMatch in the last 5 minutes.` })}`, frame);
}

// ---- AI --------------------------------------------------------------------------------------------------------------------------------------------

export function aiPage(ai: any | null, why: string, activity: Activity | null, token: string, alerts: number, p: Period = periodOf(null), since: string | null = null) {
  const frame = { tab: "ai" as Tab, token, alerts, period: p, choose: true, since };
  if (!ai) return page("AI", `${head("AI", "What the AI does for RoleMatch and what it costs.")}${unknownCard("AI", why)}`, frame);
  const total = Number(ai.microUsd ?? 0) / 1e6, o = ai.outcomes ?? {}, calls = Number(ai.calls ?? 0), spend = activity?.metrics.find((m) => m.key === "aiMicroUsd");
  const kpis = `<div class="kpis">${kpi(`Spent · ${p.short}`, usd(total), { colour: "o", icon: "$", sub: zar(total), series: spend?.series })}${kpi("Questions asked", n(calls), { colour: "o", icon: "✦", sub: `${n(Number(o.answered ?? 0))} answered` })}
    ${kpi("Not answered", n(Number(o.refused ?? 0) + Number(o.failed ?? 0)), { colour: Number(o.failed ?? 0) ? "w" : "r", icon: "!", sub: `${n(Number(o.refused ?? 0))} refused · ${n(Number(o.failed ?? 0))} failed` })}${kpi("Words read and written", `${n((Number(ai.inputTokens ?? 0) + Number(ai.outputTokens ?? 0)) / 1000)}k`, { colour: "r", icon: "≡", sub: "tokens, in thousands" })}</div>`;
  const list = (rows: any[]) => bars((rows ?? []).map((r) => ({ name: purpose(r.name), value: Number(r.microUsd ?? 0), shown: `${usd(Number(r.microUsd ?? 0) / 1e6)} · ${n(Number(r.calls ?? 0))}` })), "o");
  return page("AI", `${head("AI", `${p.label}: what the AI was asked to do, for whom, and what it cost. Counted from the provider's own token counts.`)}${kpis}
  <div class="grid three">${card("By purpose", list(ai.byPurpose))}${card("By organisation", list(ai.byOrganisation))}${card("By model", list(ai.byModel), { line: "Shown here only: no RoleMatch user ever sees which model is used." })}</div>`, frame);
}

// ---- Alerts ----------------------------------------------------------------------------------------------------------------------------------------

/** A problem put right: it was not a notice, and it has cleared; most recently resolved first. */
const resolvedOf = (list: OwnerEvent[]) => list.filter((e) => e.cleared_at && e.severity !== "info").sort((a, b) => (String(a.cleared_at) < String(b.cleared_at) ? 1 : -1));
/** How long a problem lasted, from when it was first seen to when it was resolved. */
function lasted(e: OwnerEvent) {
  const s = Math.max(0, Math.round((new Date(e.cleared_at!).getTime() - new Date(e.first_at).getTime()) / 1000));
  return `resolved · lasted ${s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`}`;
}
/** Three kinds, apart (owner, 12 Nov 2026: "we need a resolved history ... things that are informational, I don't think really need me ... things that need
 *  me are things that are urgent, things that are failing, things that are live"): what needs the owner now; what was wrong and was put right, with how
 *  long it lasted; and notices, kept for the record. Only the first ever turns the console amber or red. */
export function alertsPage(list: OwnerEvent[], token: string, alerts: number, _only?: Severity, p: Period = periodOf(null), since: string | null = null) {
  // What needs the owner is always shown, whenever it began; what was resolved, and notices, are the chosen period's.
  const now = new Date(), open = list.filter((e) => !e.cleared_at && e.severity !== "info"), fixed = resolvedOf(list).filter((e) => inPeriod(e.cleared_at, p)), notices = list.filter((e) => e.severity === "info" && inPeriod(e.last_at, p));
  const item = (e: OwnerEvent, meta: string, tone: Tone) => `<li class="alert${e.cleared_at ? " cleared" : ""}"><a href="/alerts/${e.id}">${dot(tone)}<span class="what">${esc(e.title)}${e.times > 1 ? ` <b>×${e.times}</b>` : ""}</span><span class="meta">${meta}</span></a></li>`;
  const needs = open.length ? `<ul class="alerts">${open.map((e) => item(e, `${esc(SEV[e.severity])} · since ${esc(at(e.first_at))}${e.acknowledged_at ? " · acknowledged" : e.muted_until && new Date(e.muted_until) > now ? ` · muted until ${esc(at(e.muted_until))}` : ""}`, sevTone(e.severity))).join("")}</ul>`
    : `<p class="calm">${dot("good")}Nothing needs you.</p>`;
  const history = fixed.length ? `<ul class="alerts">${fixed.map((e) => item(e, `${esc(at(e.first_at))} → ${esc(at(e.cleared_at))} · back to normal · ${esc(lasted(e).replace("resolved · ", ""))}`, "good")).join("")}</ul>` : empty(`Nothing went wrong ${during(p)}.`);
  const told = notices.length ? `<ul class="alerts">${notices.map((e) => item(e, `${esc(e.source)} · ${esc(at(e.last_at))}`, "unknown")).join("")}</ul>` : empty(`No notices ${during(p)}.`);
  return page("Alerts", `${head("Alerts", "What needs you now; what went wrong and was put right, with how long it lasted; and notices, kept for the record. Only what needs you turns the console amber or red.")}
  ${card(open.length ? `${open.length} ${open.length === 1 ? "needs" : "need"} you` : "Needs you", needs, { wide: true, tone: open.length ? "warn" : undefined })}
  <div class="grid two">${card(`Resolved · ${p.short}`, history, { line: "From when it started to when it was right again." })}${card(`Notices · ${p.short}`, told, { line: "For the record. They never need you." })}</div>`, { tab: "alerts", token, alerts, period: p, choose: true, since });
}

export function alertPage(e: OwnerEvent, token: string, alerts: number) {
  const open = !e.cleared_at;
  const actions = open ? `<div class="actions">
    ${e.acknowledged_at ? `<p class="muted">Acknowledged ${esc(at(e.acknowledged_at))}.</p>` : `<form method="post" action="/alerts/${e.id}/ack"><input type="hidden" name="t" value="${esc(token)}"><button class="btn">Acknowledge</button></form>`}
    <form method="post" action="/alerts/${e.id}/mute"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="minutes" value="60"><button class="btn secondary">Mute for 1 hour</button></form></div>` : "";
  return page(e.title, `<p class="back"><a href="/alerts">‹ Alerts</a></p>
  <article class="card wide"><p class="sev ${sevTone(e.severity)}">${dot(e.cleared_at ? "good" : sevTone(e.severity))}${esc(SEV[e.severity])} · ${esc(e.source)}</p><h1 class="title">${esc(e.title)}</h1>
  <p class="meta">First ${esc(at(e.first_at))} · last ${esc(at(e.last_at))}${e.times > 1 ? ` · ${e.times} times` : ""}${e.cleared_at ? ` · back to normal ${esc(at(e.cleared_at))} (${esc(ago(secondsSince(e.cleared_at)))})` : ""}</p>
  ${e.meaning ? `<h2>What it means</h2><p>${esc(e.meaning)}</p>` : ""}${e.action ? `<h2>What to do</h2><p>${esc(e.action)}</p>` : ""}${actions}</article>`, { tab: "alerts", token, alerts });
}

// ---- Database --------------------------------------------------------------------------------------------------------------------------------------

export function databasePage(v: DatabaseView, token: string, alerts: number) {
  const tables = v.tables.length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">Table</th><th scope="col">Size</th><th scope="col" class="num">Rows</th><th scope="col">Upkeep</th></tr></thead><tbody>${v.tables.map((t) =>
    `<tr><th scope="row"><a href="/schema#${esc(t.name)}">${esc(t.name)}</a></th><td>${esc(t.size)}</td><td class="num">${t.rows.toLocaleString("en-ZA")}</td><td>${dot(t.tone)} ${esc(t.upkeep)}${t.tone === "warn" ? ` <small class="muted">· ${t.dead.toLocaleString("en-ZA")} old row versions waiting</small>` : ""}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No tables to show.");
  const changes = v.pending.length ? `<p class="note warn">${dot("warn")} Waiting to be applied: ${v.pending.map(esc).join(", ")}</p>` : v.latest ? `<p class="muted">Latest change applied: <code>${esc(v.latest)}</code></p>` : "";
  return page("Database", `${head("Database", "How live's database is doing right now, in plain words.")}
  ${status(v.tone, v.headline, v.detail, `<p class="where">Live's data is on: <b>${esc(v.where)}</b></p>`)}
  <div class="grid two">${card("Right now", rowsOf(v.lines) + changes)}${card("Largest tables", tables + `<p class="muted">Upkeep is PostgreSQL clearing away old versions of changed rows. It runs by itself.</p>`, { line: "Select a table to see its columns." })}</div>`, { tab: "database", token, alerts, where: v.where });
}

// ---- Schema ----------------------------------------------------------------------------------------------------------------------------------------

export function schemaPage(tables: any[] | null, why: string, token: string, alerts: number) {
  if (!tables) return page("Schema", `${head("Schema", "Every table of the platform's own.")}${unknownCard("Schema", why)}`, { tab: "schema", token, alerts });
  const guarded = tables.filter((t) => t.rowSecurity).length, rows = tables.reduce((s, t) => s + Number(t.rows ?? 0), 0), size = tables.reduce((s, t) => s + Number(t.bytes ?? 0), 0);
  const kpis = `<div class="kpis">${kpi("Tables", n(tables.length), { colour: "r", icon: "⌗" })}${kpi("Guarded by row security", `${guarded} of ${tables.length}`, { colour: guarded === tables.length ? "e" : "w", icon: "◈", sub: guarded === tables.length ? "every table" : `${tables.length - guarded} without` })}${kpi("Rows", n(rows), { colour: "r", icon: "≡" })}${kpi("Size on disk", bytes(size), { colour: "r", icon: "◫" })}</div>`;
  const index = `<nav class="toc" aria-label="Tables">${tables.map((t) => `<a href="#${esc(t.name)}">${esc(t.name)}</a>`).join("")}</nav>`;
  const one = (t: any) => `<details class="table" id="${esc(t.name)}"><summary><b>${esc(t.name)}</b><span class="meta">${n(Number(t.rows ?? 0))} rows · ${bytes(Number(t.bytes ?? 0))} · ${(t.columns ?? []).length} columns</span>
    ${t.rowSecurity ? pill("good", Number(t.policies) ? `row security · ${t.policies} ${Number(t.policies) === 1 ? "rule" : "rules"}` : "row security · platform only") : pill("warn", "no row security")}</summary>
    <table class="data cols"><thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Empty allowed</th></tr></thead><tbody>${(t.columns ?? []).map((c: any) =>
      `<tr><th scope="row"><code>${esc(c.name)}</code>${c.key ? ' <span class="tag">key</span>' : ""}${c.hasDefault ? ' <span class="tag soft">default</span>' : ""}</th><td><code>${esc(c.type)}</code></td><td>${c.nullable ? "yes" : "no"}</td></tr>`).join("")}</tbody></table>
    ${(t.links ?? []).length ? `<p class="links">Links to ${(t.links as any[]).map((l) => `<a href="#${esc(l.to)}">${esc(l.to)}</a> <span class="muted">(${esc(l.columns)})</span>`).join(", ")}</p>` : ""}<p class="muted">${n(Number(t.indexes ?? 0))} ${Number(t.indexes) === 1 ? "index" : "indexes"}</p></details>`;
  return page("Schema", `${head("Schema", "Every table of the platform's own: its columns and their types, what it links to, and the rules that keep each organisation's rows to itself. Names and types only, never a value.")}${kpis}
  <div class="schema">${index}<div>${tables.map(one).join("")}</div></div>`, { tab: "schema", token, alerts });
}

// ---- Backups and files -----------------------------------------------------------------------------------------------------------------------------

export function backupsPage(t: Today, token: string, alerts: number) {
  const pick = (labels: string[]) => t.lines.filter((l) => labels.some((x) => l.label.startsWith(x)));
  const safety = pick(["Last backup", "Own database", "Copy on the Mac", "Restore drill"]), disk = pick(["Disk"]);
  const bad = safety.some((l) => l.tone === "bad"), unknown = safety.some((l) => l.tone === "unknown");
  const tone: Tone = bad ? "bad" : unknown ? "unknown" : safety.some((l) => l.tone === "warn") ? "warn" : "good";
  return page("Backups and files", `${head("Backups and files", "How RoleMatch's records, accounts and original CVs are kept safe, and where the copies are.")}
  ${status(tone, tone === "good" ? "Everything is backed up" : tone === "bad" ? "A backup needs you" : tone === "warn" ? "A backup needs a look" : "Some of it cannot be seen", "Every night and before every release: records and accounts as encrypted dumps, original files into the encrypted vault, 14 nights kept, and a copy taken to the Mac.")}
  <div class="grid two">${card("Copies", rowsOf(safety), { line: "Each copy and when it was last made." })}${card("The PC", rowsOf(disk), { line: "Where live and its copies are kept." })}</div>`, { tab: "backups", token, alerts });
}

// ---- Trends (docs/ops/TRENDS_AND_LOAD.md) ---------------------------------------------------------------------------------------------------------

const UNIT: Record<Unit, (v: number) => string> = {
  seconds: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(1)} s`),
  minutes: (v) => (v < 1 ? `${Math.round(v * 60)} s` : `${v < 10 ? v.toFixed(1) : n(v)} min`),
  count: (v) => n(v), per_minute: (v) => `${v < 10 ? v.toFixed(1) : n(v)} a minute`, percent: (v) => `${Math.round(v)}%`, megabytes: (v) => `${n(v)} MB`,
};
/** One trend chart: each series a line with its area, broken where there is no number (a gap is never drawn as zero); the moment's figures on hover. */
function trendLine(times: number[], c: TrendChart, r: TrendRange, h = 150) {
  const fmt = UNIT[c.unit], all = c.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (!all.length) return empty(c.why ? `Cannot be shown just now: ${c.why}.` : "No numbers for this period yet.");
  const w = 640, padT = 6, max = c.unit === "percent" ? 100 : Math.max(...all) || 1, len = Math.max(1, times.length - 1);
  const x = (i: number) => (i / len) * w, y = (v: number) => h - 2 - (v / max) * (h - 2 - padT);
  const when = (t: number) => new Date(t).toLocaleString("en-ZA", r === "24h" ? { hour: "2-digit", minute: "2-digit", timeZone: TZ } : { day: "numeric", month: "short", ...(r === "7d" ? { hour: "2-digit" } : {}), timeZone: TZ });
  const lines = c.series.map((s) => {
    const runs: [number, number][][] = []; let run: [number, number][] = [];
    s.values.forEach((v, i) => { if (v === null) { if (run.length) runs.push(run); run = []; } else run.push([x(i), y(v)]); });
    if (run.length) runs.push(run);
    return `<g class="${s.colour}">${runs.map((p) => { const pts = p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
      return `<polygon points="${p[0][0].toFixed(1)},${h} ${pts} ${p[p.length - 1][0].toFixed(1)},${h}"/><polyline points="${pts}"/>`; }).join("")}</g>`;
  }).join("");
  const grid = [0.5, 1].map((f) => `<line x1="0" x2="${w}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/>`).join("");
  const hover = times.map((t, i) => `<rect x="${(x(i) - w / len / 2).toFixed(1)}" y="0" width="${(w / len).toFixed(1)}" height="${h}"><title>${esc(when(t))}: ${c.series.map((s) => `${s.label} ${s.values[i] === null ? "no number" : fmt(s.values[i]!)}`).join(", ")}</title></rect>`).join("");
  const key = `<ul class="key">${c.series.map((s) => `<li class="${s.colour}"><span aria-hidden="true"></span>${esc(s.label)}</li>`).join("")}<li class="top">highest ${esc(fmt(Math.max(...all)))}</li></ul>`;
  return `${key}<svg class="area" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(c.title)} over the last ${esc(RANGES[r].label)}"><g class="grid">${grid}</g>${lines}<g class="hover">${hover}</g></svg>`
    + `<p class="axis" aria-hidden="true"><span>${esc(when(times[0]))}</span><span>${esc(when(times[Math.round(len / 2)]))}</span><span>${esc(when(times[len]))}</span></p>`;
}
/** The latest number a chart has, for its heading ("now 240 ms"). */
const latest = (c: TrendChart) => { const v = c.series[0]?.values.findLast((x) => x !== null); return v === undefined || v === null ? "" : ` Now ${UNIT[c.unit](v)}.`; };

export function trendsPage(t: Trends, r: TrendRange, token: string, alerts: number) {
  const ranges = `<nav class="periods" aria-label="Period: ${esc(RANGES[r].label)}">${(Object.keys(RANGES) as TrendRange[]).map((k) => `<a href="?r=${k}"${k === r ? ' aria-current="true"' : ""}>${esc(RANGES[k].label)}</a>`).join("")}</nav>`;
  const intro = head("Trends", "How RoleMatch and the PC have been doing over time, read every 15 seconds and kept 90 days. Numbers only: nothing about any company or person.", ranges);
  if (!t.ok) return page("Trends", `${intro}${unknownCard("Trends", t.why)}`, { tab: "trends", token, alerts, refresh: 60 });
  const warnings = t.warnings.length
    ? `<ul class="feed">${t.warnings.map((w) => `<li>${dot(w.severity === "urgent" ? "bad" : "warn")}<span><b>${esc(w.title)}</b>${w.since ? ` <small class="muted">since ${esc(at(w.since))}</small>` : ""}<br>${esc(w.meaning)}${w.action ? `<br><small>What to do: ${esc(w.action)}</small>` : ""}</span></li>`).join("")}</ul>`
    : `<p class="muted">${dot("good")} Nothing is drifting: the disk, memory, speed and errors are within their limits.</p>`;
  const charts = t.charts.map((c) => card(c.title, trendLine(t.times, c, r), { line: `${c.line}${latest(c)}` })).join("");
  return page("Trends", `${intro}${card("Warnings", warnings, { line: "Slow changes worth knowing about before anyone notices. Each is also e-mailed to you and listed under Alerts." })}<div class="grid two">${charts}</div>`,
    { tab: "trends", token, alerts, refresh: 60, tone: t.warnings.some((w) => w.severity === "urgent") ? "bad" : t.warnings.length || alerts ? "warn" : "good" });
}

// ---- One person, one portal: what the owner can do (docs/architecture/PLAN_CONSOLE_OPERATIONS.md) ---------------------------------------------------
// Owner, 12 Nov 2026: "I should have full autonomy of everything ... if I want to delete users, I should be able to". Each action is a form with the
// session's token; whatever removes something asks for the name typed exactly, and says first what will go. These pages never reload by themselves.

const note = (message?: string, tone: Tone = "good") => (message ? `<p class="note ${tone}" role="status">${esc(message)}</p>` : "");
const done = (rows: any[]) => rows.length ? `<ul class="feed">${rows.map((r) => `<li><time>${esc(at(r.at))}</time><span>${esc(String(r.action).replace(/^\w+\./, "").replace(/_/g, " "))}${r.by_email ? ` <small class="muted">by ${esc(r.by_email)}</small>` : ""}</span></li>`).join("")}</ul>` : empty("Nothing done here from the console yet.");
const form = (action: string, token: string, inner: string, button: string, cls = "") => `<form method="post" action="${action}" class="act"><input type="hidden" name="t" value="${esc(token)}">${inner}<button class="btn ${cls}">${esc(button)}</button></form>`;

export function personPage(x: any, token: string, alerts: number, o: { message?: string; tone?: Tone; actions?: any[] } = {}) {
  const facts: Line[] = [
    { label: "E-mail", value: x.email ?? "", tone: "good" }, { label: "Company", value: x.organisation, tone: "good" }, { label: "Role", value: x.role === "viewer" ? "hiring manager" : x.role, tone: "good" },
    { label: "Portals", value: String(x.portals ?? 0), tone: "good" }, { label: "Joined", value: day(x.joined), tone: "good" },
    { label: "Last active", value: x.lastSeen && Date.now() - new Date(x.lastSeen).getTime() < ACTIVE_MS ? "active now" : x.lastSeen ? ago(secondsSince(x.lastSeen)) : "not yet", tone: "good" },
    { label: "Last signed in", value: x.lastSignIn ? ago(secondsSince(x.lastSignIn)) : "never", tone: "good" },
    { label: "Sign-in", value: x.blocked ? "blocked" : x.confirmed ? "allowed" : "not confirmed yet", tone: x.blocked ? "bad" : x.confirmed ? "good" : "warn" },
  ];
  const id = esc(x.id);
  const acts = `<div class="acts">
    ${form(`/people/${id}/signout`, token, `<p>Ends every session of theirs at once, on every device. They can sign in again.</p>`, "Sign them out everywhere", "secondary")}
    ${x.blocked ? form(`/people/${id}/allow`, token, `<p>Lets them sign in again.</p>`, "Allow sign-in", "secondary") : form(`/people/${id}/block`, token, `<p>Signs them out and refuses their sign-in until you allow it again. Nothing of theirs is removed.</p>`, "Block sign-in", "secondary")}
    ${form(`/people/${id}/delete`, token, `<p>Removes their account for good. What they added stays with their portal, credited to no one. Type their e-mail, <b>${esc(x.email)}</b>, to confirm.</p><label>E-mail<input name="confirm" autocomplete="off" required></label>`, "Delete account", "danger")}</div>`;
  return page(x.name, `<p class="back"><a href="/people">‹ People</a></p>${head(x.name, `${x.email ?? ""} · ${x.organisation}`)}${note(o.message, o.tone)}
  <div class="grid two">${card(x.name, rowsOf(facts))}${card("What you can do", acts, { cls: "danger-zone" })}</div>${card("Done here from the console", done(o.actions ?? []), { wide: true })}`, { tab: "people", token, alerts, form: true });
}

export function portalPage(p: PortalRow, co: any | null, token: string, alerts: number, o: { message?: string; tone?: Tone; log?: any | null; actions?: any[]; defaultAllowance?: number; period?: Period; inPeriod?: any | null } = {}) {
  const per = o.period ?? periodOf(null), ip = o.inPeriod;
  const cents = (micro: number) => "$" + (micro / 1e6).toFixed(2), id = esc(p.id), org = esc(p.orgId ?? "");
  const facts: Line[] = [
    { label: "Company", value: p.company, tone: "good" }, { label: "Administrators", value: p.admins.join(", ") || "none", tone: p.admins.length ? "good" : "warn" },
    { label: "Created", value: `${day(p.since)}${p.createdBy ? ` by ${p.createdBy}` : ""}`, tone: "good" }, { label: "People", value: String(p.people), tone: "good" },
    { label: "Records", value: `${n(p.cvs)} CVs · ${n(p.jobs)} jobs · ${n(p.matches)} matches`, tone: "good" },
    ...(ip ? [{ label: per.label, value: `${n(Number(ip.cvs ?? 0))} CVs · ${n(Number(ip.jobs ?? 0))} jobs · ${n(Number(ip.matches ?? 0))} matches read; AI ${cents(Number(ip.aiMicroUsd ?? 0))} · ${n(Number(ip.aiCalls ?? 0))} calls`, tone: Number(ip.failed ?? 0) ? "warn" as Tone : "good" as Tone, why: Number(ip.failed ?? 0) ? `${n(Number(ip.failed))} documents could not be read` : undefined }] : []),
    { label: "AI this month", value: `${cents(p.aiMicroUsdMonth)} · ${n(p.aiCallsMonth)} calls (${cents(p.aiMicroUsdAll)} in all)`, tone: "good" },
    { label: "Last active", value: (p.activeNow ?? 0) > 0 ? "active now" : p.lastSeen ? ago(secondsSince(p.lastSeen)) : "not yet", tone: "good" },
  ];
  const allowance = co ? `<p>${esc(co.name)}: <b>${co.allowanceUsd == null ? `$${o.defaultAllowance ?? 5} (the platform's)` : `$${Number(co.allowanceUsd).toFixed(2)}`}</b> a month · <b>${cents(Number(co.spentMonthMicroUsd ?? 0))}</b> used this month.</p>
    ${form(`/companies/${org}/allowance?portal=${id}`, token, `<label><span>New monthly allowance, in dollars, or the word <i>default</i></span><input name="usd" inputmode="decimal" autocomplete="off" required maxlength="9"></label>`, "Set allowance", "secondary")}` : empty("The company could not be read.");
  const log = o.log;
  const support = log ? `<p class="note good">Open until ${esc(at(log.until))}. ${esc(p.company)} sees in their own log that RoleMatch support looked, when, and why.</p>
    <p class="minor">Documents</p>${(log.documents ?? []).length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">File</th><th scope="col">What</th><th scope="col">State</th><th scope="col">Uploaded</th><th scope="col">By</th></tr></thead><tbody>${(log.documents as any[]).map((d) =>
      `<tr><td>${esc(d.name)}</td><td>${d.kind === "jd" ? "job" : "CV"}</td><td>${esc(d.status)}${d.error ? ` <small class="muted">${esc(d.error)}</small>` : ""}</td><td>${esc(at(d.at))}</td><td class="mono">${esc(d.by ?? "")}</td></tr>`).join("")}</tbody></table></div>` : empty("No documents.")}
    <p class="minor">What happened</p>${(log.events ?? []).length ? `<div class="scroll"><table class="data"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th></tr></thead><tbody>${(log.events as any[]).map((e) =>
      `<tr><td>${esc(at(e.at))}</td><td class="mono">${esc(e.who)}</td><td>${esc(String(e.action).replace(/\./g, " · ").replace(/_/g, " "))}${e.detail?.jobTitle ? ` <small class="muted">${esc(e.detail.jobTitle)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("Nothing recorded.")}`
    : form(`/portals/${id}/support`, token, `<p>Opens this portal's log (its documents and who did what, never a CV's text) for one hour. ${esc(p.company)} sees in their own log that RoleMatch support looked, when, and why.</p><label>Why you are looking<input name="reason" autocomplete="off" required minlength="8" maxlength="500" placeholder="e.g. they asked where a CV went"></label>`, "Open the log for an hour", "secondary");
  const dangers = `<div class="acts">
    ${form(`/portals/${id}/delete`, token, `<p>Removes this portal and everything in it for good: ${n(p.cvs)} CVs, ${n(p.jobs)} jobs, ${n(p.matches)} matches, ${n(p.people)} people's places in it, and its original files. Its AI use is kept for the bill. Type the company's name, <b>${esc(p.company)}</b>, to confirm.</p>
      <label>Company name<input name="confirm" autocomplete="off" required></label><label>Why<input name="why" autocomplete="off" required minlength="4" maxlength="300"></label>`, "Delete this portal", "danger")}
    ${co ? form(`/companies/${org}/delete?portal=${id}`, token, `<p>Removes ${esc(co.name)} completely: its ${n(Number(co.portals ?? 0))} ${Number(co.portals) === 1 ? "portal" : "portals"} and everything in them, its ${n(Number(co.people ?? 0))} people's accounts, and its settings. Its AI use is kept for the bill. Type <b>${esc(co.name)}</b> to confirm.</p>
      <label>Company name<input name="confirm" autocomplete="off" required></label><label>Why<input name="why" autocomplete="off" required minlength="4" maxlength="300"></label>`, "Delete the whole company", "danger") : ""}</div>`;
  return page(`${p.name} · ${p.company}`, `<p class="back"><a href="${esc(withPeriod("/portals", per))}">‹ Portals</a></p>${head(p.name, p.company)}${note(o.message, o.tone)}
  <div class="grid two">${card(`${p.name} · ${p.company}`, rowsOf(facts))}${card("AI allowance", allowance, { tone: "o" })}</div>
  ${card("Support access", support, { wide: true, line: "For when a company asks what happened, for example where a CV went." })}
  <div class="grid two">${card("Remove", dangers, { cls: "danger-zone" })}${card("Done here from the console", done(o.actions ?? []))}</div>`, { tab: "portals", token, alerts, form: true, period: per });
}

// ---- signing in ------------------------------------------------------------------------------------------------------------------------------------

const signInFrame = (body: string) => `<div class="orbs" aria-hidden="true"><i class="o1"></i><i class="o2"></i><i class="glow"></i></div><section class="login"><p class="brand">${wordmark}<span>Console</span></p>${body}</section>`;
export function loginPage(message = "", tone: Tone = "warn") {
  return page("Sign in", signInFrame(`<h1>Sign in</h1>
  ${message ? `<p class="note ${tone}" role="alert">${esc(message)}</p>` : ""}
  <form method="post" action="/login"><label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="200"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button class="btn wide">Sign in</button></form>`));
}

export function codePage(message = "", tone: Tone = "warn") {
  return page("Sign-in code", signInFrame(`<h1>Check your e-mail</h1>
  ${message ? `<p class="note ${tone}" role="alert">${esc(message)}</p>` : ""}
  <p class="soft">A 6-digit code has been e-mailed to the console's owner. It works once, for 10 minutes, in this browser.</p>
  <form method="post" action="/login/code"><label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required maxlength="7" class="code"></label><button class="btn wide">Continue</button></form>
  <p class="muted"><a href="/login">Start again</a></p>`));
}

// ---- the one stylesheet ----------------------------------------------------------------------------------------------------------------------------

/** The site's own type, served by the console from the website's build (so nothing is fetched from another site). */
export const FONT_FACES = (files: Record<string, string>) => Object.entries(files).map(([key, file]) => { const [family, weight] = key.split(":");
  return `@font-face{font-family:${family};font-weight:${weight};font-style:normal;font-display:swap;src:url(/fonts/${file}) format("woff2")}`; }).join("\n");

export const CSS = `
/* the look's tokens: a skin another page can take */
:root{color-scheme:dark;
--bg:#04050A;--ink:#EEF2F8;--soft:#C9D3E1;--muted:#A9B4C6;--faint:#7E8AA0;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.15);--tile:rgba(255,255,255,.045);
--glass:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.028));--glass-edge:rgba(255,255,255,.2);--blur:blur(22px) saturate(140%);
--blue:#5CC0FF;--cyan:#8ED2FF;--teal:#3FD6D0;--green:#43E59A;--amber:#FFB547;--orange:#FF8A57;--orange2:#FFB48C;--red:#FF5C6C;--grey:#8C97A8;
--good:var(--green);--warn:var(--amber);--bad:var(--red);--unknown:var(--grey);--w1:#5CC0FF;--w2:#FF8A57;--w3:#48E39C;--w4:#FFD15C;
--r:18px;--r2:14px;--out:cubic-bezier(.16,1,.3,1);
font:13.5px/1.5 Sora,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);overflow-x:hidden}
h1,h2,.num,.big,.wm,.clock{font-family:Outfit,Sora,system-ui,sans-serif;letter-spacing:-.01em}a{color:#9FD8FF;text-decoration:none}a:hover{color:#D6EEFF}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:6px}.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
code,.mono,.chip-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-feature-settings:"zero" 1}code{font-size:12px;color:var(--soft)}
.wm b{font-weight:600}.w1{color:var(--w1)}.w2{color:var(--w2)}.w3{color:var(--w3)}.w4{color:var(--w4)}.wm{font-weight:600;color:var(--ink)}
/* the room: one field of RoleMatch blue is its light; the small glow is the platform's state */
.orbs{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}.orbs i{position:absolute;border-radius:50%;filter:blur(90px)}
.orbs .o1{width:760px;height:760px;left:-240px;top:-340px;background:#1A62B0;opacity:.5}.orbs .o2{width:640px;height:640px;right:-240px;bottom:-280px;background:#173E8C;opacity:.45}
.orbs .glow{width:360px;height:360px;left:30%;top:-150px;background:var(--green);opacity:.16;transition:background 1s}
.state-warn .orbs .glow{background:var(--amber);opacity:.2}.state-bad .orbs .glow{background:var(--red);opacity:.24}.state-unknown .orbs .glow{background:var(--grey);opacity:.14}
/* the frame: a rail of places, a quiet top line, the page */
.app{display:grid;grid-template-columns:68px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);gap:12px 14px;height:100vh;padding:12px 14px}
.app>*:not(.orbs){position:relative;z-index:1}.app>main,.app>.top{grid-column:2;min-width:0}
.rail,.card,.kpi,.status,.login,details.table{background:var(--glass);border:1px solid var(--line2);border-top-color:var(--glass-edge);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);box-shadow:0 20px 50px -26px rgba(0,0,0,.7)}
.app>.rail{z-index:30}.rail{grid-row:1/3;border-radius:22px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:14px 0}
.rail .mark{font-size:17px;margin-bottom:10px;text-decoration:none}
.rail a:not(.mark),.rail .link{position:relative;width:42px;height:40px;border-radius:12px;display:grid;place-items:center;color:var(--muted);border:1px solid transparent;transition:background .2s,color .2s}
.rail a:not(.mark):hover,.rail .link:hover{background:rgba(255,255,255,.06);color:#fff}
.rail a[aria-current]{background:rgba(92,192,255,.14);border-color:rgba(92,192,255,.32);color:#fff}
.rail i{font-style:normal;display:grid}.rail a:not(.mark) span{position:absolute;left:52px;top:50%;transform:translate(-4px,-50%);padding:5px 10px;border-radius:8px;background:#0B1424;border:1px solid var(--line2);color:var(--ink);font-size:12px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s,transform .2s var(--out);z-index:5}
.rail a:not(.mark):hover span,.rail a:not(.mark):focus-visible span{opacity:1;transform:translate(0,-50%)}
.rail .group{width:28px;height:1px;margin:8px 0;background:var(--line2);overflow:hidden;color:transparent;font-size:0}
.rail .out{margin-top:auto}.count{position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--amber);color:#1A1203;font:700 10px/16px Sora,sans-serif;text-align:center}
.top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:2px 4px 0}.top p{margin:0;display:flex;align-items:center;gap:10px}
.crumb{font-size:14px;min-width:0}.crumb .dim{color:var(--muted);font-weight:300}.crumb .sep{color:var(--faint)}.crumb b{font-weight:500}
.state{font-size:13px;color:#8FF0C2}.state.warn{color:var(--amber)}.state.bad{color:#FF97A1}.state.unknown{color:var(--muted)}
.live{margin-left:auto!important;flex-wrap:wrap;justify-content:flex-end}.live .muted{font-size:12px}
.periods{display:flex;align-items:center;gap:2px;padding:3px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--line2);font-size:12.5px}
.periods a,.periods summary{padding:5px 11px;border-radius:9px;color:var(--muted);text-decoration:none;white-space:nowrap;cursor:pointer;transition:background .2s,color .2s}
.periods a:hover,.periods summary:hover{color:var(--ink);background:rgba(255,255,255,.05)}
.periods [aria-current="true"]{color:#04111F;background:var(--blue);font-weight:600}
.periods .months{position:relative}.periods summary{list-style:none}.periods summary::-webkit-details-marker{display:none}.periods summary::after{content:" ▾";font-size:10px}
.periods .months>div{position:absolute;right:0;top:calc(100% + 6px);z-index:20;display:grid;gap:2px;min-width:130px;padding:6px;border-radius:12px;background:rgba(12,18,30,.97);border:1px solid var(--line2);box-shadow:0 18px 40px -20px rgba(0,0,0,.8)}
.chip-mono{font-size:11.5px;color:#D6DEEA;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--line2)}
.clock{display:inline-flex;align-items:center;gap:1px;padding:4px 11px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.03);font-size:13px;font-weight:600;color:var(--soft);font-variant-numeric:tabular-nums}
.clock .hh,.clock .mm{display:inline-block;height:1.25em;line-height:1.25em;overflow:hidden}.clock .hh>span,.clock .mm>span{display:flex;flex-direction:column}.clock i{font-style:normal;height:1.25em}
.clock .hh>span{animation:clock-h 86400s steps(24) infinite}.clock .mm>span{animation:clock-m 3600s steps(60) infinite}.clock .colon{animation:breathe 2s ease-in-out infinite}
.clock small{margin-left:8px;padding-left:8px;border-left:1px solid var(--line2);font:500 11px Sora,sans-serif;color:var(--muted)}
@keyframes clock-h{to{transform:translateY(-100%)}}@keyframes clock-m{to{transform:translateY(-100%)}}@keyframes breathe{50%{opacity:.3}}
main{min-width:0;min-height:0;overflow:auto;padding:0 2px 24px;scrollbar-width:thin}main.fit{overflow:hidden;padding-bottom:0}
.head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 12px;flex-wrap:wrap}.lede{margin:0;color:var(--muted);max-width:820px;font-size:12.5px}
/* pieces */
.card,.kpi,.status{border-radius:var(--r);animation:rise .6s var(--out) both;min-width:0}
.card{display:flex;flex-direction:column;padding:14px 18px;min-height:0;overflow:hidden}.card>header{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 10px;flex-wrap:wrap}
.card h2{margin:0;font:400 10.5px Sora,sans-serif;letter-spacing:.15em;text-transform:uppercase;color:var(--muted)}.card h2.warn{color:var(--amber)}.card h2.o{color:var(--orange2)}
.card>header p{margin:0;color:var(--faint);font-size:12px}.card>.body{min-height:0;flex:1 1 auto;overflow:auto;scrollbar-width:thin}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;align-items:start}.grid.two{grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}.grid.three{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.card.wide{grid-column:1/-1;margin-bottom:14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:0 0 14px}.kpis.six{grid-template-columns:repeat(6,minmax(0,1fr))}
.kpi{position:relative;display:block;padding:12px 15px 10px;border-radius:var(--r2);color:var(--ink);text-decoration:none!important;overflow:hidden;transition:transform .25s var(--out),border-color .25s}
a.kpi:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--c) 45%,transparent)}
.kpi .label{margin:0;display:flex;align-items:center;gap:7px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .num{margin:5px 0 1px;font-size:23px;font-weight:600;line-height:1.1;background:linear-gradient(180deg,#fff,#B9C6D8);-webkit-background-clip:text;background-clip:text;color:transparent}
.kpi .num.o{background-image:linear-gradient(180deg,#fff,var(--orange2))}.kpi.o .label{color:var(--orange2)}
.kpi .sub{margin:0;display:flex;gap:8px;flex-wrap:wrap;color:var(--faint);font-size:11.5px;min-height:17px}.chg.up{color:var(--green)}.chg.down{color:#FF97A1}
.tile{width:20px;height:20px;border-radius:6px;display:inline-grid;place-items:center;font-style:normal;font-size:10.5px;letter-spacing:0;color:var(--c);background:color-mix(in srgb,var(--c) 18%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 40%,transparent);flex:none}
.r{--c:var(--blue)}.l{--c:var(--cyan)}.c{--c:var(--teal)}.e{--c:var(--green)}.o{--c:var(--orange)}.w{--c:var(--amber)}
.spark{display:block;width:100%;height:26px;margin-top:6px}.spark polyline,.area polyline{fill:none;stroke:var(--c);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke;stroke-dasharray:1600;stroke-dashoffset:1600;animation:draw 1.4s var(--out) .15s forwards}
.spark polygon,.area polygon{fill:color-mix(in srgb,var(--c) 14%,transparent);opacity:0;animation:fade .9s ease .5s forwards}
.area{width:100%;height:180px;display:block}.chart .area{height:100%;min-height:110px;flex:1}.chart>.body{display:flex;flex-direction:column}
.area .grid line{stroke:var(--line);stroke-dasharray:3 5;vector-effect:non-scaling-stroke}.axis{display:flex;justify-content:space-between;margin:4px 0 0;font-size:11px;color:var(--faint)}.key .top{margin-left:auto;color:var(--faint)}.key .top::before{content:none}.area .hover rect{fill:transparent}.area .hover rect:hover{fill:rgba(255,255,255,.04)}
.key{list-style:none;display:flex;gap:14px;flex-wrap:wrap;margin:0 0 6px;padding:0;color:var(--soft);font-size:11.5px}.key span{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:6px;box-shadow:0 0 8px var(--c)}
.status{display:block;padding:14px 18px;margin:0 0 14px;border-left:3px solid var(--unknown)}.status.good{border-left-color:var(--good)}.status.warn{border-left-color:var(--warn)}.status.bad{border-left-color:var(--bad)}
.status .big{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:600}.status p{margin:4px 0 0;color:var(--soft)}.where b{color:var(--ink)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;background:var(--unknown)}
.dot.good{background:var(--good);box-shadow:0 0 9px 2px rgba(67,229,154,.45)}.dot.warn{background:var(--warn);box-shadow:0 0 9px 2px rgba(255,181,71,.45)}.dot.bad{background:var(--bad);box-shadow:0 0 9px 2px rgba(255,92,108,.5);animation:pulse 2s ease infinite}
.pill{display:inline-flex;align-items:center;gap:7px;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);font-size:11.5px;color:var(--soft);white-space:nowrap}
.tag{font-size:11px;border-radius:6px;padding:1px 7px;background:var(--tile);border:1px solid var(--line2);color:var(--soft);white-space:nowrap}.tag.good{color:var(--green)}.tag.soft{opacity:.7}
.lines{margin:0}.row{display:grid;grid-template-columns:auto minmax(7rem,38%) 1fr;gap:10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}
dt{color:var(--soft)}dd{margin:0}dd small{display:block;color:var(--faint);font-size:11.5px}
.list,.feed,.alerts{list-style:none;margin:0;padding:0}.list li{display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px}
.feed li{display:grid;grid-template-columns:6.6rem 1fr auto;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--line);font-size:12.5px;font-weight:300}.feed li:first-child{border-top:0}.feed li.muted{display:block}
.feed a{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.minor{margin:12px 0 4px;font-size:10.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--faint)}
.calm{display:flex;align-items:center;gap:10px;margin:2px 0;color:#8FF0C2}.now{display:inline-flex;align-items:center;gap:7px;color:#8FF0C2;white-space:nowrap}
time,.meta,.muted{color:var(--faint);font-size:12px}.more{display:inline-block;margin-top:8px;font-size:12px}.empty{color:var(--faint);margin:4px 0}.soft{color:var(--soft)}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:9px}.bars li{display:grid;grid-template-columns:minmax(0,36%) 1fr auto;gap:12px;align-items:center;font-size:12.5px;font-weight:300}
.bars .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--soft)}.bars .bar{height:5px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.bars .bar i{display:block;height:100%;width:var(--w);border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 65%,transparent),var(--c));transform-origin:left;animation:grow .9s var(--out) both}
.bars.o .bar i{background:linear-gradient(90deg,var(--orange),var(--orange2))}.bars b{font:500 12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}
.svcs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.svc{display:flex;gap:9px;align-items:center;padding:8px 11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);min-width:0}
.svc>span:last-child{min-width:0}.svc b{display:block;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.svc small{display:block;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scroll{overflow:auto;margin:0 -18px;padding:0 18px}table.data{width:100%;border-collapse:collapse;font-size:13px}
.data th,.data td{padding:9px 11px;text-align:left;border-top:1px solid var(--line);vertical-align:middle;white-space:nowrap}.data thead th{border-top:0;color:var(--faint);font-weight:400;font-size:10.5px;text-transform:uppercase;letter-spacing:.12em;position:sticky;top:0;background:#0A101C;z-index:1}
.data tbody tr{transition:background .15s}.data tbody tr:hover{background:rgba(255,255,255,.035)}.data tbody th{font-weight:400}.data th b{font-weight:500;display:block}.data th small{color:var(--faint);font-size:11.5px}
.mono{font-size:.92em}.data td small,.data td b+small{display:block;color:var(--faint);font-size:.82em}.data .num{text-align:right}.num{font-variant-numeric:tabular-nums}.data .money b{color:var(--orange2)}
.mini{display:inline-block;vertical-align:middle;margin-right:8px;width:56px;height:5px;border-radius:9px;background:linear-gradient(90deg,var(--blue) var(--w),rgba(255,255,255,.08) 0)}
tr.left{opacity:.55}
.alerts li{border-top:1px solid var(--line)}.alerts li:first-child{border-top:0}.alerts li a{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;align-items:center;padding:11px 4px;color:var(--ink);text-decoration:none}
.alerts li a:hover{background:rgba(255,255,255,.035)}.alerts .meta{grid-column:2}.alerts .cleared{opacity:.6}
.sev{display:flex;gap:8px;align-items:center;font-weight:500;margin:0;font-size:12.5px}.sev.bad{color:#FF97A1}.sev.warn{color:var(--amber)}.back{margin:0 0 10px}
article.card h1.title{margin:8px 0 6px;font-size:20px;font-weight:600}article.card h2{margin:16px 0 4px}article.card p{color:var(--soft)}
.schema{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start}.toc{position:sticky;top:0;display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 120px);overflow:auto;padding-right:6px}
.toc a{padding:5px 10px;border-radius:7px;color:var(--soft);font-size:12.5px}.toc a:hover{background:rgba(255,255,255,.05)}
details.table{border-radius:var(--r2);margin:0 0 10px;overflow:hidden;scroll-margin-top:20px}
details.table summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;cursor:pointer;list-style:none}details.table summary::-webkit-details-marker{display:none}
details.table summary::before{content:"›";color:var(--faint);transition:transform .25s var(--out)}details[open].table summary::before{transform:rotate(90deg)}details.table summary .pill{margin-left:auto}
details.table summary:hover{background:rgba(255,255,255,.035)}details.table .cols{margin:0 16px;width:calc(100% - 32px)}details.table p{margin:10px 16px 12px}
details.table:target{border-color:rgba(92,192,255,.5);box-shadow:0 0 0 3px rgba(92,192,255,.15)}
/* buttons: RoleMatch blue at rest, the teal sweeping across on hover (owner-approved) */
.btn{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:11px;padding:9px 18px;color:#04131F;text-decoration:none!important;display:inline-block;
background:linear-gradient(90deg,#3FD6D0 50%,var(--blue) 50%) right/200% 100% no-repeat;transition:background-position .35s var(--out)}
.btn:hover,.btn:focus-visible{background-position:left}.btn.secondary,.btn.ghost{color:var(--ink);background:linear-gradient(90deg,rgba(63,214,208,.9) 50%,rgba(255,255,255,.04) 50%) right/200% 100% no-repeat;box-shadow:inset 0 0 0 1px var(--line2)}
.btn.secondary:hover,.btn.ghost:hover,.btn.secondary:focus-visible,.btn.ghost:focus-visible{background-position:left;color:#04131F}.btn.small{padding:5px 12px;font-size:12px}.btn.wide{width:100%}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.actions form{margin:0}button.link{background:none;border:0;font:inherit;color:var(--muted);cursor:pointer;padding:0}button.link:hover{color:var(--ink)}
.note{padding:10px 12px;border-radius:10px;border-left:3px solid var(--warn);background:rgba(255,255,255,.04);color:var(--ink)}main>.note{margin:0 0 12px}
/* the owner's actions: each a small form; whatever removes something in red, and asks for the name first */
.acts{display:grid;gap:12px}.act{display:grid;gap:8px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid var(--line)}.act p{margin:0;color:var(--soft);font-size:12.5px}
.act label{display:grid;gap:5px;font-size:12px;color:var(--muted)}.act input{font:inherit;padding:9px 11px;border-radius:10px;border:1px solid var(--line2);background:rgba(255,255,255,.04);color:var(--ink)}
.act input:focus{outline:0;border-color:var(--blue);box-shadow:0 0 0 3px rgba(92,192,255,.18)}.act .btn{justify-self:start}
.btn.danger{color:#fff;background:linear-gradient(90deg,#ff7a86 50%,#C9303D 50%) right/200% 100% no-repeat}.btn.danger:hover,.btn.danger:focus-visible{background-position:left;color:#2A0509}
.danger-zone .act:has(.danger){border-color:rgba(255,92,108,.3);background:rgba(255,92,108,.05)}.note.bad{border-left-color:var(--bad)}.note.good{border-left-color:var(--good)}
/* the Overview: one screen on a laptop */
.ovtabs{display:none}.ovw{height:100%;display:grid;grid-template-rows:auto minmax(0,1.05fr) minmax(0,1fr);gap:12px}.ovw>.kpis{margin:0}
.ovw-mid{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:12px;min-height:0}.ovw-low{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:12px;min-height:0}
.ovw .card{height:100%}.needs .body{display:flex;flex-direction:column}
/* signing in */
body.plain{display:grid;place-items:center;padding:20px}.login{position:relative;z-index:1;width:min(400px,100%);padding:26px;border-radius:22px;animation:rise .6s var(--out) both}
.login .brand{margin:0 0 18px;display:flex;align-items:center;gap:10px;font-size:18px}.login .brand span{font-weight:300;color:var(--muted);padding-left:10px;border-left:1px solid var(--line2);font-size:14px}
.login h1{margin:0 0 14px;font-size:22px;font-weight:600}.login label{display:block;margin:0 0 14px;font-weight:500;color:var(--soft);font-size:13px}
.login input{display:block;width:100%;font:inherit;margin-top:6px;padding:11px 12px;border-radius:11px;border:1px solid var(--line2);background:rgba(255,255,255,.04);color:var(--ink);transition:border-color .2s,box-shadow .2s}
.login input:focus{outline:0;border-color:var(--blue);box-shadow:0 0 0 3px rgba(92,192,255,.18)}.login input.code{font:600 22px/1 Outfit,Sora,sans-serif;letter-spacing:.35em;text-align:center}
.dock{display:none}.pcards{display:none}
/* movement: quiet, and none at all when the device asks (the clock still keeps time) */
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes fade{to{opacity:1}}@keyframes draw{to{stroke-dashoffset:0}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes pulse{50%{box-shadow:0 0 0 6px rgba(255,92,108,0)}}
.kpis>*:nth-child(2){animation-delay:.04s}.kpis>*:nth-child(3){animation-delay:.08s}.kpis>*:nth-child(4){animation-delay:.12s}.kpis>*:nth-child(5){animation-delay:.16s}.kpis>*:nth-child(6){animation-delay:.2s}
@media (prefers-reduced-motion:reduce){.card,.kpi,.status,.login,.spark polyline,.area polyline,.spark polygon,.area polygon,.bars .bar i,.dot.bad,.clock .colon{animation:none!important}.spark polyline,.area polyline{stroke-dashoffset:0}.spark polygon,.area polygon{opacity:1}*{transition:none!important}}
/* a laptop's shorter screen: everything a little tighter, still one screen */
@media (max-height:820px) and (min-width:861px){.app{padding:10px 12px;gap:10px 12px}.kpi{padding:10px 13px 8px}.kpi .num{font-size:20px}.spark{height:20px;margin-top:4px}.card{padding:12px 15px}.svc{padding:6px 10px}.ovw,.ovw-mid,.ovw-low{gap:10px}.kpis{gap:10px}}
@media (max-width:1180px) and (min-width:861px){.svcs{grid-template-columns:repeat(3,minmax(0,1fr))}.kpis.six{grid-template-columns:repeat(3,minmax(0,1fr))}.ovw{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr)}}
/* a phone: its own composition, a bar of places at the bottom, the Overview in tabs */
@media (max-width:860px){.periods{flex-wrap:wrap;width:100%}.periods a,.periods summary{padding:6px 10px}}
@media (max-width:860px){
.app{display:block;height:auto;min-height:100vh;padding:12px 12px 84px}.rail{display:none}
.top{gap:8px;margin-bottom:10px}.crumb .dim,.crumb .sep{display:none}.live{width:100%;justify-content:space-between;margin-left:0!important}.live .chip-mono{display:none}.clock small{display:none}
main,main.fit{overflow:visible;padding:0}.head{margin-bottom:10px}
.app>.dock{display:flex;position:fixed;left:10px;right:10px;bottom:10px;z-index:10;justify-content:space-around;padding:6px;border-radius:20px;background:rgba(12,18,30,.78);border:1px solid var(--line2);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
.dock>a,.dock summary{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 8px;border-radius:12px;color:var(--muted);font-size:10px;list-style:none;cursor:pointer;min-width:52px}
.dock summary::-webkit-details-marker{display:none}.dock>a span{max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dock>a[aria-current]{color:#fff;background:rgba(92,192,255,.14)}.dock i{font-style:normal;display:grid}
.dock summary::before{content:"⋯";font-size:18px;line-height:19px}.dock .count{top:0;right:6px}
.more .sheet{position:fixed;left:10px;right:10px;bottom:76px;max-height:70vh;overflow:auto;padding:10px;border-radius:18px;background:rgba(12,18,30,.96);border:1px solid var(--line2);display:flex;flex-direction:column;gap:2px}
.more .sheet a{display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;color:var(--soft)}.more .sheet a[aria-current]{background:rgba(92,192,255,.14);color:#fff}.more .sheet i{font-style:normal;display:grid}.more .sheet .group{margin:10px 10px 2px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}.more .sheet form{padding:10px}
.ovtabs{display:flex;gap:6px;margin:0 0 10px;padding:4px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--line)}.ovtabs label{flex:1;text-align:center;padding:8px;border-radius:10px;color:var(--muted);cursor:pointer;font-size:13px}
#ov-now:checked~.ovtabs label[for=ov-now],#ov-health:checked~.ovtabs label[for=ov-health],#ov-act:checked~.ovtabs label[for=ov-act]{background:rgba(92,192,255,.16);color:#fff}
.ovw{display:block;height:auto}.ovw-mid,.ovw-low{display:block}.ovw [data-sec]{display:none;margin-bottom:10px}
#ov-now:checked~.ovw [data-sec=now],#ov-health:checked~.ovw [data-sec=health],#ov-act:checked~.ovw [data-sec=act]{display:block}
#ov-now:checked~.ovw .kpis[data-sec=now]{display:grid}.kpis,.kpis.six{grid-template-columns:1fr 1fr;gap:8px}.kpi .num{font-size:20px}.kpi .label{white-space:normal;letter-spacing:.08em;align-items:flex-start}
.svcs{grid-template-columns:1fr 1fr}.grid,.grid.two,.grid.three{grid-template-columns:1fr}.card{margin-bottom:10px}.ovw .card{height:auto}.chart .area{height:150px}
.portals .scroll{display:none}.pcards{display:grid;gap:8px;list-style:none;margin:0;padding:0}.pcards li{padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08)}.pcards p{margin:0}.pc-top{display:flex;justify-content:space-between;gap:10px}.pc-top .money{color:var(--orange2);font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace}.pc-co{color:var(--muted);font-size:12px}.pc-admin{margin-top:6px!important;font-size:12px;color:var(--soft);overflow-wrap:anywhere}.pc-n{margin-top:4px!important;font-size:11.5px;color:var(--faint)}
.row{grid-template-columns:auto 1fr}.row dd{grid-column:2}.feed li{grid-template-columns:1fr}.schema{grid-template-columns:1fr}.toc{display:none}.bars li{grid-template-columns:minmax(0,40%) 1fr auto}}
`;
/** The stylesheet's fingerprint, in its address: a browser keeps it for a week, and a new release's styles reach it at once. */
export const CSS_VERSION = createHash("sha256").update(CSS).digest("hex").slice(0, 10);
