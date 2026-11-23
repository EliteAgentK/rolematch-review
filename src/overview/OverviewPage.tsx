// The Overview (owner, 10 Nov 2026; plan: docs/architecture/PLAN_OVERVIEW.md; design: docs/product/design/dashboard.html). One page draws Live (this
// organisation's own figures from the server) and Demo (a simulated organisation built in this browser, demo.ts) from the same calculations, so they behave
// the same. It checks for news every 15 seconds and at once when a change is saved in this browser; a figure that changed counts to its new value and
// glows once. Every block opens the Matching Board, where the records behind it are.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, onBoardChange } from "../api/client";
import DashboardNavbar from "../components/DashboardNavbar";
import { useOptionalSettings } from "../settings/SettingsContext";
import { departmentColour } from "./departments";
import { demoOverview } from "./demo";
import { pipelineStages } from "./pipeline";
import type { OverviewData } from "./types";
import { boardLink, type BoardFocus } from "../utils/boardIntent";
import { navigateWithTransition } from "../utils/viewTransition";
import { revealTopToBottom } from "../utils/reveal";
import { FIRST_PERIOD, forgetAll, keepFor, keptOverview, liveOverview, staleOverviews, warmPortal } from "../utils/warm";
import BrandLoader from "../components/BrandLoader";
import WelcomeBackBar from "../components/WelcomeBackBar";
import SavedAssessmentDialog, { prefetchAssessment } from "../components/SavedAssessmentDialog";
import { axisSteps } from "../utils/chartAxis";
import { coalesce } from "../utils/coalesce";
import "./overview.css";

type Mode = "live" | "demo";
const CHECK_EVERY = 15_000;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");   // 7,059: as in the approved design
const reduce = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const phone = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 700px)").matches;

/** The activity strip's slow drift, made by moving its own scroll position, so a person's own scrolling and the drift are one and the same thing. It
 *  stops while the strip is pointed at or holds focus, and for a few seconds after a scroll by hand; a mouse wheel scrolls it sideways. The lines are held
 *  twice over, so when the drift passes the first copy it steps back by one copy's width and the strip runs on without a seam. */
function useDrift(box: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const el = box.current; if (!el || !on) return;
    let raf = 0, last = performance.now(), hold = 0, over = false, pos = el.scrollLeft;
    const wait = (ms: number) => { hold = Math.max(hold, performance.now() + ms); };
    const step = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      if (Math.abs(el.scrollLeft - Math.round(pos)) > 2) pos = el.scrollLeft;   // moved by hand since the last frame
      if (!over && t > hold && !document.hidden) {
        pos += dt * 0.035;
        const copy = el.scrollWidth / 2;
        if (copy > el.clientWidth && pos >= copy) pos -= copy;
        el.scrollLeft = pos;
      }
      raf = requestAnimationFrame(step);
    };
    const enter = () => { over = true; }, leave = () => { over = false; wait(1200); };
    const wheel = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } pos = el.scrollLeft; wait(5000); };
    const touch = () => wait(6000);
    el.addEventListener("pointerenter", enter); el.addEventListener("pointerleave", leave); el.addEventListener("focusin", enter); el.addEventListener("focusout", leave);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("touchstart", touch, { passive: true });
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerenter", enter); el.removeEventListener("pointerleave", leave); el.removeEventListener("focusin", enter); el.removeEventListener("focusout", leave);
      el.removeEventListener("wheel", wheel); el.removeEventListener("touchstart", touch);
    };
  }, [box, on]);
}
// RoleMatch opens on the organisation's own Live figures, loaded behind the RoleMatch loading screen from the moment of signing in (owner, 10 Nov 2026:
// "start loading on the actual live portal so that it can be appearing when you sign in under the loading screen"; this replaces the earlier "open
// up with the view of the demo"). The Demo is one click away; whichever is chosen stays chosen while the tab is open.
let chosenMode: "live" | "demo" = "live", chosenDays = FIRST_PERIOD;   // kept while moving between the Overview and the board; a new visit starts on 7 days
const demoKept = new Map<number, { d: OverviewData; at: number }>();   // the Demo is made in the browser and is the same for everyone
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
/** One colour per person, from RoleMatch's own palette, the same wherever they appear (a hash of the name, so it never changes between visits). */
const AVATAR = [["#227C9D", "#3AA8D1"], ["#D9661A", "#F58220"], ["#0E9F8F", "#17C3B2"], ["#6C5CE7", "#8E7CFF"], ["#1E9E5A", "#2BD47D"], ["#C2410C", "#FE6D73"], ["#2563EB", "#6C8CFF"]];
const avatarBg = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const [a, b] = AVATAR[h % AVATAR.length]; return `linear-gradient(135deg, ${a}, ${b})`; };
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };

/** A number that counts from its last value to its new one, and glows once when it changes after the first draw. */
function Count({ value, prefix = "" }: { value: number; prefix?: string }) {
  const [shown, setShown] = useState(0), last = useRef<number | null>(null), [glow, setGlow] = useState(false);
  useEffect(() => {
    const from = last.current ?? 0, to = value, first = last.current === null; last.current = value;
    if (reduce() || from === to) { setShown(to); return; }
    if (!first) { setGlow(true); setTimeout(() => setGlow(false), 1700); }
    const t0 = performance.now(), d = first ? 1300 : 900; let raf = 0;
    const step = (t: number) => { const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 4); setShown(from + (to - from) * e); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={glow ? "glow" : undefined}>{prefix}{fmt(shown)}</span>;
}

/** A smooth line through the points (owner, 10 Nov 2026: "I like them being curved and nice"), monotone between neighbours (Fritsch and Carlson), so the
 *  curve never rises above a peak or dips below zero between two days: it stays true to the figures while it rounds the corners. */
export function smoothPath(pts: [number, number][]) {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const n = pts.length, dx = pts.slice(1).map((p, i) => p[0] - pts[i][0]), m = pts.slice(1).map((p, i) => (p[1] - pts[i][1]) / (dx[i] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i])));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`; }
  return d;
}

/** The figure's trend: the same thing counted each day of the chosen period, so a block shows whether it is rising or falling, not only its total. */
function Spark({ data = [], colour, what }: { data?: number[]; colour: string; what: string }) {
  // A figure a server does not send yet (an older server for a moment during a release) draws nothing rather than stopping the page.
  if (!data.length) return null;
  const max = Math.max(1, ...data), min = Math.min(...data), x = (i: number) => (i / Math.max(1, data.length - 1)) * 104, y = (v: number) => 34 - ((v - min) / (max - min || 1)) * 28;
  return <svg className="spark" viewBox="0 0 104 38" role="img" aria-label={what}><title>{what}</title><path d={smoothPath(data.map((v, i) => [x(i), y(v)]))} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" /></svg>;
}

function Icon({ d, colour }: { d: string; colour: string }) {
  return <span className="ic" style={{ background: `color-mix(in srgb, ${colour} 16%, transparent)`, color: colour }}><svg className="svgic" viewBox="0 0 24 24" aria-hidden><path d={d} /></svg></span>;
}
const I = {
  credit: "M5 6c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3zM5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6",
  people: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6",
  jobs: "M3 7h18v13H3zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18",
  list: "M6 3h12v18l-6-4-6 4z", trend: "M3 17l6-6 4 4 8-8M15 7h6v6", star: "M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.6 6.5 19.5l1-6.3L3 8.9 9 8z",
  layers: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", talent: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 11l2 2 4-4",
  alert: "M12 3 2 20h20L12 3zM12 10v4M12 17h.01", pulse: "M3 12h4l3-8 4 16 3-8h4", clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 13v3M12 19h.01", pen: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
};
/** Each Needs attention rule's colour and icon (server/src/attention.ts). */
const ATTENTION_LOOK: Record<string, [string, string]> = {
  "interview-no-update": ["--coral", I.clock], "shortlist-waiting": ["--amber", I.list], "strong-not-acted": ["--cerulean", I.star],
  "job-no-shortlist": ["--violet", I.jobs], "new-not-matched": ["--teal", I.people],
};
/** A person in the activity strip as first name and last initial (owner, 10 Nov 2026: "people could have the same name"): "Sipho N."; an account with no
 *  name shows the first part of its e-mail address. The full name and address are in the line's detail. */
const shortName = (who: string) => {
  const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : "");
  if (who.includes("@")) return cap(who.split("@")[0].split(/[._-]/)[0] ?? "");
  const parts = who.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${cap(parts[0])} ${parts[parts.length - 1][0].toUpperCase()}.` : cap(parts[0] ?? "");
};

/** What makes a block that is not a <button> work like one: reached with Tab, named for a screen reader, and pressed with Enter or Space as well as a click.
 *  Several Overview blocks answered only a mouse (code review, 16 Nov 2026, G-M8). `pressed` is for a block that turns something on and off. */
export function pressable(act: () => void, label: string, pressed?: boolean) {
  return {
    role: "button" as const, tabIndex: 0, "aria-label": label, ...(pressed === undefined ? {} : { "aria-pressed": pressed }), onClick: act,
    onKeyDown: (e: { key: string; preventDefault: () => void; target?: unknown; currentTarget?: unknown }) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } },
  };
}

/** Recruitment activity: CVs read, matches run and people shortlisted, day by day, drawn to the chart's real size so its labels never stretch. Its daily
 *  figures used to be readable only by pointing with a mouse; the chart now takes focus, and the left and right arrow keys (Home, End) step through the days,
 *  showing and announcing each one (code review, 16 Nov 2026, G-M8). */
export function ActivityChart({ data, on }: { data: OverviewData["series"]; on: Record<string, boolean> }) {
  const box = useRef<HTMLDivElement>(null), [size, setSize] = useState({ w: 800, h: 240 }), [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 240 })); ro.observe(el); return () => ro.disconnect(); }, []);
  const css = (v: string) => (box.current ? getComputedStyle(box.current).getPropertyValue(v).trim() : "#888");
  const COL: Record<string, string> = { cv: css("--cerulean"), match: css("--violet"), sl: css("--teal") }, NAMES: Record<string, string> = { cv: "CVs read", match: "Matches run", sl: "Shortlisted" };
  const keys = (["cv", "match", "sl"] as const).filter((k) => on[k]), n = data.dates.length, W = size.w, H = size.h, P = { l: 34, r: 12, t: 10, b: 26 };
  const axis = axisSteps(Math.max(0, ...keys.flatMap((k) => data[k]))), max = axis.top, x = (i: number) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r), y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const label = (i: number) => new Date(data.dates[i] + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" }), every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 110))));
  const line = (k: "cv" | "match" | "sl") => smoothPath(data[k].map((v, i) => [x(i), y(v)]));
  const move = (e: React.MouseEvent) => { const r = box.current!.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - P.l) / (W - P.l - P.r)) * (n - 1))))); };
  const keysDown = (e: React.KeyboardEvent) => {
    const to = e.key === "ArrowRight" ? (hover === null ? n - 1 : hover + 1) : e.key === "ArrowLeft" ? (hover === null ? n - 1 : hover - 1) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "Escape" ? null : undefined;
    if (to === undefined || !n) return;
    e.preventDefault(); setHover(to === null ? null : Math.max(0, Math.min(n - 1, to)));
  };
  return (
    <div className="chart" ref={box} onMouseMove={move} onMouseLeave={() => setHover(null)} tabIndex={0} onKeyDown={keysDown} onBlur={() => setHover(null)}
      role="group" aria-label="Recruitment activity by day. Use the left and right arrow keys to read each day's figures.">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Recruitment activity by day">
        <defs>{keys.map((k) => <linearGradient key={k} id={`ov-g-${k}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={COL[k]} stopOpacity=".32" /><stop offset="1" stopColor={COL[k]} stopOpacity="0" /></linearGradient>)}</defs>
        {axis.ticks.map((v, i) => { return <g key={i}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={css("--grid")} /><text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={css("--muted")}>{Math.round(v)}</text></g>; })}
        {data.dates.map((_, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={css("--muted")}>{label(i)}</text> : null))}
        {keys.map((k) => <path key={`a${k}`} d={`${line(k)}L${x(n - 1)},${H - P.b}L${x(0)},${H - P.b}Z`} fill={`url(#ov-g-${k})`} />)}
        {keys.map((k) => <path key={`l${k}`} d={line(k)} fill="none" stroke={COL[k]} strokeWidth={2.4} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${COL[k]})` }} />)}
        {keys.map((k) => <g key={`d${k}`}><circle className="nowdot" cx={x(n - 1)} cy={y(data[k][n - 1] ?? 0)} r={4} fill={COL[k]} /><circle cx={x(n - 1)} cy={y(data[k][n - 1] ?? 0)} r={4} fill={COL[k]} stroke={css("--card-solid")} strokeWidth={2} /></g>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke={css("--line-strong")} strokeDasharray="4 4" />}
      </svg>
      {hover !== null && (
        <div className="tip" role="status" aria-live="polite" style={{ opacity: 1, left: Math.min(x(hover) + 14, W - 180), top: 8 }}>
          <b>{label(hover)}</b>
          {keys.map((k) => <div key={k}><span><i style={{ background: COL[k] }} />{NAMES[k]}</span><b>{data[k][hover]}</b></div>)}
        </div>
      )}
    </div>
  );
}

/** Each stage's count in the period, with bars in proportion and no stage shown as a share of another (pipeline.ts; code review, 16 Nov 2026, G-M2). */
function Pipeline({ p, days }: { p: OverviewData["pipeline"]; days: number }) {
  return (
    <div className="funnel">
      {pipelineStages(p, days).map(({ label, n, colour, height, note }, i) => (
        <div className="stage" key={label} style={{ "--c": `var(${colour})` } as CSSProperties}>
          <div className="n"><Count value={n} /></div>
          <div className="barv" style={{ height: `${height}%`, animationDelay: `${i * 0.09}s` }} />
          <div className="t">{label}</div>
          <div className="conv">{note}</div>
        </div>
      ))}
    </div>
  );
}

/** The period's strongest matches: people on one side, jobs on the other, joined by flowing lines measured from where the cards really are. */
export function Strongest({ items, days, open }: { items: OverviewData["strongest"]; days: number; open: (m: OverviewData["strongest"][number]) => void }) {
  const box = useRef<HTMLDivElement>(null), [paths, setPaths] = useState<string[]>([]), [hot, setHot] = useState<number | null>(null);
  const people = useMemo(() => [...new Map(items.map((m) => [m.candidateId, m])).values()], [items]), jobs = useMemo(() => [...new Map(items.map((m) => [m.jobId, m])).values()], [items]);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const draw = () => { const r = el.getBoundingClientRect(); setPaths(items.map((m) => {
      const a = el.querySelector(`[data-p="${m.candidateId}"]`)?.getBoundingClientRect(), b = el.querySelector(`[data-j="${m.jobId}"]`)?.getBoundingClientRect();
      if (!a || !b) return ""; const x1 = a.right - r.left, y1 = a.top + a.height / 2 - r.top, x2 = b.left - r.left, y2 = b.top + b.height / 2 - r.top, mid = (x1 + x2) / 2;
      return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`; })); };
    draw(); const ro = new ResizeObserver(draw); ro.observe(el); return () => ro.disconnect();
  }, [items]);
  if (!items.length) return <p className="empty">No match has a final AI score in the last {days} days. Matches appear here as the AI scores them.</p>;
  const colours = ["var(--violet)", "var(--teal)", "var(--cerulean)"];
  return (
    <>
      <div className="bm" ref={box}>
        <svg aria-hidden>{paths.map((d, i) => d && <path key={i} className="flow" d={d} stroke={colours[i % 3]} style={{ opacity: hot === null ? undefined : hot === i ? 1 : 0.15, strokeWidth: hot === i ? 3 : undefined }} />)}</svg>
        <div style={{ display: "grid", gap: 12, alignContent: "space-around" }}>
          {people.map((m) => (
            <div key={m.candidateId} className={`person${hot !== null && items[hot]?.candidateId === m.candidateId ? " hot" : ""}`} data-p={m.candidateId} role="button" tabIndex={0} aria-label={`Open ${m.candidateName}'s saved assessment`} onMouseEnter={() => setHot(items.findIndex((x) => x.candidateId === m.candidateId))} onMouseLeave={() => setHot(null)} onClick={() => open(items.find((x) => x.candidateId === m.candidateId)!)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(items.find((x) => x.candidateId === m.candidateId)!); } }}>
              <span className="av" style={{ background: avatarBg(m.candidateName) }}>{initials(m.candidateName)}</span>
              <div style={{ minWidth: 0 }}><b>{m.candidateName}</b><span>{m.candidateRole}</span></div>
              {/* Each person's own score (owner, 12 Nov 2026: "all these scores aren't the same"): the best of their pairs in this list. */}
              <span className="score" title={`${m.candidateName}'s strongest score here`}>{Math.max(...items.filter((x) => x.candidateId === m.candidateId).map((x) => x.score))}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: 12, alignContent: "space-around" }}>
          {jobs.map((m) => (
            <div key={m.jobId} className={`job${hot !== null && items[hot]?.jobId === m.jobId ? " hot" : ""}`} data-j={m.jobId} role="button" tabIndex={0} aria-label={`Open the strongest saved assessment for ${m.jobTitle}`} onMouseEnter={() => setHot(items.reduce((b, x, i) => (x.jobId === m.jobId && (b < 0 || x.score > items[b].score) ? i : b), -1))} onMouseLeave={() => setHot(null)} onClick={() => open(items.filter((x) => x.jobId === m.jobId).sort((a, b) => b.score - a.score)[0])} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(items.filter((x) => x.jobId === m.jobId).sort((a, b) => b.score - a.score)[0]); } }}>
              {/* The job by its full name, no score: the scores are the people's, and the lines show whose job it is (owner, 12 Nov 2026: "we don't need to
                  have best 94, best 95, or even a score on the other side ... rather just have the full name of the job"). */}
              <div style={{ minWidth: 0 }}><b className="full" title={m.jobTitle}>{m.jobTitle}</b><span>{[m.jobCompany, m.jobLocation].filter(Boolean).join(" · ")}</span></div>
            </div>
          ))}
        </div>
      </div>
      <div className="bmlist">{items.map((m, i) => <div key={i} className="pair clickable" {...pressable(() => open(m), `Open ${m.candidateName}'s saved assessment for ${m.jobTitle}, score ${m.score}`)}><b>{m.candidateName}</b><span className="score">{m.score}</span><span>{m.jobTitle}{m.jobCompany ? ` · ${m.jobCompany}` : ""}{m.jobLocation ? ` · ${m.jobLocation}` : ""}</span></div>)}</div>
    </>
  );
}

/** Each standard department, by its open jobs or by the candidates whose work belongs to it (owner, 10 Nov 2026: "both the jobs as well as the kinds of
 *  families ... the candidates are in"): each department's colour, bars that rise quickly, a light sweep every 10 seconds, smooth when figures change.
 *  Pointing at a department gives both figures; clicking it opens the Matching Board on that department. "Not grouped yet" is a record read before
 *  departments existed, placed by the reading shortly after release (server/src/aiRead.ts), so it is not a place to open. */
function Departments({ items, by, open }: { items: OverviewData["families"]; by: "jobs" | "candidates"; open: (dept: string) => void }) {
  const [grown, setGrown] = useState(false), [sweep, setSweep] = useState(false), [on, setOn] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setGrown(true), 150); return () => clearTimeout(t); }, []);
  useEffect(() => { if (reduce()) return; const t = setInterval(() => { setSweep(true); setTimeout(() => setSweep(false), 1200); }, 10_000); return () => clearInterval(t); }, []);
  const value = (f: OverviewData["families"][number]) => (by === "jobs" ? f.open : f.candidates);
  const shown = items.filter((f) => value(f) > 0).sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name)).slice(0, 4);
  if (!shown.length) return <p className="empty">{by === "jobs" ? "No open jobs yet. Jobs appear here by department as they are added." : "No candidates yet. Candidates appear here by the department of their work as CVs are read."}</p>;
  const max = Math.max(...shown.map(value)), plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
  const picked = items.find((f) => f.name === on), placeable = (name: string) => name !== "Not grouped yet";
  return (
    <>
      {shown.map((f) => (
        <div key={f.name} className={`fam${placeable(f.name) ? " clickable" : ""}${on === f.name ? " on" : ""}${sweep ? " sweep" : ""}`} style={{ "--c": departmentColour(f.name) } as CSSProperties}
          onMouseEnter={() => setOn(f.name)} onMouseLeave={() => setOn(null)} onClick={() => placeable(f.name) && open(f.name)}
          role={placeable(f.name) ? "button" : undefined} tabIndex={placeable(f.name) ? 0 : undefined} onKeyDown={(e) => { if (placeable(f.name) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(f.name); } }}>
          <span className="name">{f.name}</span>
          <span className="track"><span className="fill" style={{ width: grown ? `${(value(f) / max) * 100}%` : "0%" }} /></span>
          <span className="v"><Count value={value(f)} /></span>
        </div>
      ))}
      <div className="famdetail">
        {picked ? `${picked.name}: ${plural(picked.open, "open job", "open jobs")} · ${plural(picked.candidates, "candidate", "candidates")}${placeable(picked.name) ? ". Click to open it on the Matching Board." : ", being placed in departments."}`
          : "Click a department to open it on the Matching Board."}
      </div>
    </>
  );
}

function Talent({ items }: { items: OverviewData["experience"] }) {
  const [on, setOn] = useState<number | null>(null), total = items.reduce((n, b) => n + b.count, 0), R = 60, C = 2 * Math.PI * R;
  const colours = ["var(--teal)", "var(--cerulean)", "var(--violet)", "var(--amber)"];
  let off = 0;
  return (
    <div className="donutwrap">
      <div className="donut">
        <svg viewBox="0 0 150 150" width="150" height="150" aria-label="New candidates by years of experience">
          <circle cx="75" cy="75" r={R} fill="none" stroke="var(--tile)" strokeWidth="18" />
          {total > 0 && items.map((b, i) => { const len = Math.max(0, (b.count / total) * C - 3), el = <circle key={b.band} className="s" cx="75" cy="75" r={R} stroke={colours[i]} strokeDasharray={`${len} ${C}`} strokeDashoffset={-off} style={{ strokeWidth: on === i ? 24 : 18, opacity: on === null || on === i ? 1 : 0.35 }} onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} />; off += (b.count / total) * C; return el; })}
        </svg>
        <div className="mid"><div><b><Count value={on === null ? total : items[on].count} /></b><span>{on === null ? "new candidates" : items[on].band.toLowerCase()}</span></div></div>
      </div>
      <div>{items.map((b, i) => <div key={b.band} className={`band${on === i ? " on" : ""}`} style={{ "--c": colours[i] } as CSSProperties} onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)}><i /><span>{b.band}</span><b>{total ? Math.round((b.count / total) * 100) : 0}%</b><em>{fmt(b.count)}</em></div>)}</div>
    </div>
  );
}

const OPENED = "rolematch.portalOpened", WELCOME_MS = 2000;
export default function OverviewPage() {
  const navigate = useNavigate(), orgLabel = useOptionalSettings()?.orgLabel ?? "";
  const [famBy, setFamBy] = useState<"jobs" | "candidates">("jobs");
  const [mode, setModeState] = useState<Mode>(chosenMode), [days, setDaysState] = useState(chosenDays);
  const setMode = (m: Mode) => { chosenMode = m; setModeState(m); }, setDays = (n: number) => { chosenDays = n; setDaysState(n); };
  const [error, setError] = useState<string>(""), [busy, setBusy] = useState(false), [, tick] = useState(0);
  // Opening the portal shows the RoleMatch loading screen for two seconds, once per tab, however fast the figures arrive (owner, 12 Nov 2026: "I really
  // like that it's fast now ... but I still do want to see ... 2 seconds, that RoleMatch loading portal thing"). Going back to the Overview later does not.
  const [opening, setOpening] = useState(() => { try { return !sessionStorage.getItem(OPENED); } catch { return false; } });
  useEffect(() => { if (!opening) return; const t = setTimeout(() => { setOpening(false); try { sessionStorage.setItem(OPENED, "1"); } catch { /* private window: shown each time, still two seconds */ } }, WELCOME_MS); return () => clearTimeout(t); }, [opening]);
  // Every period of Live and Demo is kept once fetched, for as long as the tab is open (owner, 10 Nov 2026: "they should both already be loaded"; "once
  // you're in it should be easy toggling"): Live in src/utils/warm.ts, which signing in has already started filling, the Demo here. Switching shows
  // what is kept at once and refreshes it behind; a period not kept yet shows as loading, never another period's figures under its label.
  const [, heldChanged] = useState(0);
  const keptOf = (m: Mode, n: number) => (m === "demo" ? demoKept.get(n) : keptOverview(n));
  const fetchOne = useCallback(async (m: Mode, n: number) => {
    if (m === "demo") demoKept.set(n, { d: demoOverview(n), at: Date.now() }); else await liveOverview(n);
    heldChanged((x) => x + 1);
  }, []);
  const shown = keptOf(mode, days), data = shown?.d ?? null, checkedAt = shown?.at ?? Date.now();
  const [tab, setTab] = useState<"time" | "pipe">("time"), [on, setOn] = useState({ cv: true, match: true, sl: true });
  const seen = useRef(new Set<string>()), first = useRef(true);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      await fetchOne(mode, days); setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { setError("Your organisation's figures are for recruiters and administrators. Here is the demo."); setMode("demo"); }
      else if (e instanceof ApiError && e.status === 401) { forgetAll(); navigate("/login"); }
      else setError(e instanceof ApiError ? e.message : "The figures could not be loaded. They will be tried again in a moment.");
    } finally { setBusy(false); }
  }, [mode, days, navigate, fetchOne]);
  // A signed-in page, like the board: the Demo needs nothing from the server, so the page asks who is here before showing anything (found on live,
  // 10 Nov 2026: signed out, it showed the demo). Signed out, it goes to sign-in.
  // Figures already kept for this tab were fetched with this person's session, so they show at once while the session is checked behind them.
  const [signedIn, setSignedIn] = useState(() => !!keptOf(chosenMode, chosenDays)), [welcome, setWelcome] = useState<string | null>(null);
  useEffect(() => {
    api.me().then(({ user }) => {
      keepFor(user.userId); setSignedIn(true); heldChanged((x) => x + 1);
      // Signing in leaves a note for a friendly welcome on the first page shown, which is now this one (it used to wait for the board).
      try { if (sessionStorage.getItem("th_welcome_back")) { sessionStorage.removeItem("th_welcome_back"); setWelcome((user.name ?? "").split(" ")[0] ?? ""); } } catch { /* storage unavailable: no welcome */ }
    })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) { forgetAll(); navigate("/login", { replace: true }); } else setSignedIn(true); });
  }, [navigate]);
  useEffect(() => { if (signedIn) void load(); }, [load, signedIn]);
  // Behind the first figures: the other Live periods and the Matching Board's records (src/utils/warm.ts), then the Demo's, one at a time, so a click on
  // a period, the Demo or the Matching Board shows what it needs at once.
  const warm = useCallback(async () => {
    await warmPortal(chosenDays);
    for (const n of [7, 30, 90]) if (!demoKept.has(n)) await fetchOne("demo", n).catch(() => {});
    heldChanged((x) => x + 1);
  }, [fetchOne]);
  useEffect(() => { if (signedIn) void warm(); }, [signedIn, warm]);
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) void load(); }, CHECK_EVERY); return () => clearInterval(t); }, [load]);
  // A change on the board makes every Live period out of date: the one on screen is fetched again, the others again behind it. Changes close together are
  // one refresh, 1.5 s after the last and at least every 10 s while they keep coming: each file of a batch is a change, and every one used to refetch the
  // figures and re-warm every period at once (code review, 16 Nov 2026, G-M9).
  const onChanged = useRef(() => {});
  onChanged.current = () => {
    staleOverviews(days);
    if (mode === "live") void load().then(() => warm()); else void fetchOne("live", days).catch(() => {}).then(() => warm());
  };
  useEffect(() => { const later = coalesce(() => onChanged.current(), 1500, 10_000), stop = onBoardChange(() => later.call()); return () => { stop(); later.cancel(); }; }, []);
  useEffect(() => { const v = () => { if (!document.hidden) void load(); }; document.addEventListener("visibilitychange", v); return () => document.removeEventListener("visibilitychange", v); }, [load]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (data) { if (first.current) { data.activity.forEach((a) => seen.current.add(a.at + a.what)); first.current = false; } } }, [data]);
  useEffect(() => { seen.current = new Set(); first.current = true; }, [mode, days]);
  const choose = (m: Mode) => { setMode(m); setError(""); };
  // Changing the period or the view replays the blocks' entrance from the top of the page to the bottom, quickly (src/utils/reveal.ts).
  const swapped = useRef(false);
  useEffect(() => { if (!swapped.current) { swapped.current = true; return; } revealTopToBottom(".ov .card"); }, [mode, days]);
  // Every block opens the Matching Board in the state it describes (src/utils/boardIntent.ts): no AI, no credit. The demo's records are on no board, so
  // there a click says what it would open in Live instead of opening anything.
  const [hint, setHint] = useState(""), [detail, setDetail] = useState<{ a: OverviewData["activity"][number]; target: BoardFocus | null; at: DOMRect } | null>(null);
  const strip = useRef<HTMLDivElement>(null), drifting = !!data && data.activity.length >= 4 && !reduce() && !phone();
  useDrift(strip, drifting && !detail);
  useEffect(() => { if (!detail) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [detail]);
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(""), 4200); return () => clearTimeout(t); }, [hint]);
  // A Needs attention item opens in place: the people and jobs waiting, by name, each one click from its match or record on the board (owner, 10 Nov
  // 2026: "a better way to show what those matches are instead of returning to the dashboard"). The whole list is one more click away.
  type AttItem = { candidateId?: string; jobId?: string; name?: string; title?: string; score?: number; status?: string };
  const [att, setAtt] = useState<{ id: string; title: string; detail: string; items: AttItem[] | null; error?: string } | null>(null);
  const openAttention = (a: { id: string; title: string; detail: string }) => {
    if (mode === "demo") { go({ kind: "attention", rule: a.id, title: a.title }, `the records behind "${a.title}"`); return; }
    setAtt({ ...a, items: null });
    api.attentionRecords(a.id).then((r) => { for (const it of (r.items ?? []).slice(0, 10)) if (it.candidateId && it.jobId) void prefetchAssessment({ candidateId: it.candidateId, jobId: it.jobId }).catch(() => {}); setAtt((cur) => (cur?.id === a.id ? { ...cur, items: r.items ?? [] } : cur)); })
      .catch(() => setAtt((cur) => (cur?.id === a.id ? { ...cur, items: [], error: "The list could not be loaded. Try again in a moment." } : cur)));
  };
  useEffect(() => { if (!att) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setAtt(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [att]);
  // A match opens its saved assessment here, on the Overview, never the board first (owner, 11 Nov 2026, the third time of asking: "the detail page ...
  // instead of being taken to the matching board"). Strongest matches, Needs attention and the activity details all come through here.
  const [pair, setPair] = useState<{ candidateId: string; jobId: string } | null>(null);
  // The strongest matches' saved assessments are fetched as soon as they are listed, so a click opens one at once.
  const strongestKey = mode === "live" ? (data?.strongest ?? []).map((m) => `${m.candidateId}|${m.jobId}`).join(",") : "";
  useEffect(() => { for (const k of strongestKey.split(",").filter(Boolean)) { const [candidateId, jobId] = k.split("|"); void prefetchAssessment({ candidateId, jobId }).catch(() => {}); } }, [strongestKey]);
  const go = (f: BoardFocus, what: string) => {
    if (mode === "demo") { setHint(`In Live, this opens ${f.kind === "match" ? what : `the Matching Board on ${what}`}. This is the demo, so nothing opens.`); return; }
    if (f.kind === "match" && f.candidateId && f.jobId) { setPair({ candidateId: f.candidateId, jobId: f.jobId }); return; }
    navigateWithTransition(navigate, boardLink(f));
  };
  const gone = Date.now() - checkedAt, ringOff = 56.5 * Math.min(1, gone / CHECK_EVERY);
  const d = data, org = mode === "demo" ? "Demo Group (a simulated organisation)" : orgLabel || "your organisation";
  const cvDelta = d ? pct(d.candidates.inPeriod, d.candidates.previous) : null, slDelta = d ? pct(d.series.sl.reduce((a, b) => a + b, 0), d.shortlisted.previous) : null;
  const Delta = ({ v, text }: { v: number | null; text: string }) => <div className="delta">{v !== null && <b className={v < 0 ? "down" : undefined}>{v < 0 ? "▼" : "▲"} {Math.abs(v)}%</b>} {text}</div>;
  const credits = d?.credits, left = credits?.allowanceRand ? Math.max(0, credits.allowanceRand - credits.usedRand) : null, share = credits?.allowanceRand ? left! / credits.allowanceRand : null;
  // A block that opens the board is pressable by keyboard too, with a name saying where it goes (code review, 16 Nov 2026, G-M8).
  const card = (delay: number, extra = "", children: ReactNode, onClick?: () => void, label = "") => <article className={`card ${extra}`} style={{ animationDelay: `${delay}s` }} {...(onClick ? pressable(onClick, label) : {})}>{children}</article>;

  // The RoleMatch loading screen until the first Live figures are here, then the page in one piece: never a page of empty blocks filling in.
  if (opening || (!d && mode === "live" && !error)) return <BrandLoader label="Opening your portal" />;
  return (
    <div className="ov">
      <DashboardNavbar view="overview" />
      <SavedAssessmentDialog pair={pair} onClose={() => setPair(null)} onBoard={() => { const p = pair; setPair(null); if (p) navigateWithTransition(navigate, boardLink({ kind: "match", ...p })); }} />
      {welcome !== null && <WelcomeBackBar name={welcome} />}
      <main className={`wrap${error ? " has-notice" : ""}`}>
        {hint && <div className="hint" role="status">{hint}</div>}
        {att && <div className="evscrim" onClick={() => setAtt(null)} />}
        {att && (
          <div className="evdetail attpanel" role="dialog" aria-label={att.title}>
            <p className="what" style={{ marginTop: 0 }}><b>{att.title}</b></p>
            <p className="at">{att.detail}</p>
            {att.items === null ? <p className="at">Loading…</p> : att.error ? <p className="at">{att.error}</p> : !att.items.length ? <p className="at">Nothing is waiting here now.</p> : (
              <div className="pairs">{att.items.map((it, i) => (
                <button key={i} onClick={() => { setAtt(null); go(it.candidateId && it.jobId ? { kind: "match", candidateId: it.candidateId, jobId: it.jobId } : { kind: "record", candidateId: it.candidateId, jobId: it.jobId }, it.name || it.title || "the record"); }}>
                  <span className="who">{it.name || it.title}</span>{it.name && it.title && <span className="job">{it.title}</span>}
                  {it.score != null ? <span className="score">{it.score}</span> : it.status ? <span className="state">{it.status.replace(/_/g, " ")}</span> : null}
                </button>))}</div>)}
            <div className="acts">
              <button className="primary" onClick={() => { const a = att; setAtt(null); go({ kind: "attention", rule: a.id, title: a.title }, `the records behind "${a.title}"`); }}>Show them on the Matching Board</button>
              <button onClick={() => setAtt(null)}>Close</button>
            </div>
          </div>
        )}
        {/* One activity line in full: who (their whole name and address), what, and exactly when, with the record it was about one click away. */}
        {detail && <div className="evscrim" onClick={() => setDetail(null)} />}
        {detail && (
          <div className="evdetail" role="dialog" aria-label="What happened" style={{ left: Math.min(Math.max(16, detail.at.left), window.innerWidth - 376), top: Math.max(16, detail.at.top - 196) }}>
            <div className="who"><span className="av" style={{ background: avatarBg(detail.a.who || "RoleMatch") }}>{initials(detail.a.who || "RoleMatch")}</span>
              <div style={{ minWidth: 0 }}><b>{detail.a.who || "RoleMatch"}</b><span>{detail.a.whoEmail || (mode === "demo" ? "a member of the demo organisation" : "")}</span></div></div>
            <p className="what">{detail.a.what}</p>
            <p className="at">{new Date(detail.a.at).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {ago(detail.a.at)}</p>
            {!!detail.a.facts?.length && <ul className="facts">{detail.a.facts.map((f) => <li key={f}>{f}</li>)}</ul>}
            {/* A batch's records by name, each opening on the Matching Board. */}
            {!!detail.a.records?.length && <div className="recs">{detail.a.records.map((r) => <button key={r.id} onClick={() => { setDetail(null); go({ kind: "record", ...(r.kind === "candidate" ? { candidateId: r.id } : { jobId: r.id }) }, r.name); }}>{r.name}</button>)}</div>}
            <div className="acts">
              {detail.target || (mode === "demo" && !detail.a.records?.length) ? <button className="primary" onClick={() => { const t = detail.target; setDetail(null); if (t) go(t, "the record this was about"); else go({ kind: "jobs" }, "the record this was about"); }}>{detail.target?.kind === "match" ? "View assessment" : "Open on the Matching Board"}</button> : <span className="gone">The record it was about has been deleted.</span>}
              <button onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        )}
        <section className="title">
          <div>
            <h1>Your recruitment, at a glance <span className={`badge ${mode}`}>{mode === "demo" ? "Demo" : <span className="dot">Live</span>}</span></h1>
            <p>{mode === "demo" ? "A simulated organisation, so you can see RoleMatch after months of use. Nothing here is real or stored." : `Everything in ${org} over the last ${days} days. Click a block to open the Matching Board.`}</p>
          </div>
          <div className="controls">
            <div className="seg mode" role="group" aria-label="Live or demo">
              <button className={mode === "live" ? "on live" : ""} onClick={() => choose("live")} aria-pressed={mode === "live"}>Live</button>
              <button className={mode === "demo" ? "on demo" : ""} onClick={() => choose("demo")} aria-pressed={mode === "demo"}>Demo</button>
            </div>
            <div className="seg" role="group" aria-label="Period">{[7, 30, 90].map((n) => <button key={n} className={days === n ? "on" : ""} onClick={() => setDays(n)} aria-pressed={days === n}>{n} days</button>)}</div>
            <button className={`refresh${busy ? " busy" : ""}`} onClick={() => void load()} title="Checks every 15 seconds and whenever something changes. Click to check now.">
              <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" /><circle cx="12" cy="12" r="9" fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" transform="rotate(-90 12 12)" strokeDasharray="56.5" strokeDashoffset={ringOff} /></svg>
              <span>{gone < 4000 ? "Updated just now" : `Updated ${Math.round(gone / 1000)} s ago`}</span>
            </button>
          </div>
        </section>
        {error && <p className="notice" role="status">{error}</p>}

        {!d ? <p className="notice">Loading the figures…</p> : (<>
          <section className="grid kpis">
            {card(0.04, "kpi still", <>
              <div className="row"><div className="label"><Icon d={I.credit} colour="var(--R)" />{left !== null ? "Credits remaining" : "Credits used"}</div>
                {share !== null && <svg className="ring" viewBox="0 0 56 56" aria-hidden><circle cx="28" cy="28" r="23" fill="none" stroke="var(--tile)" strokeWidth="6" /><circle cx="28" cy="28" r="23" fill="none" stroke="var(--R)" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 28 28)" strokeDasharray="144.5" strokeDashoffset={144.5 * (1 - share)} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.16,1,.3,1)" }} /></svg>}</div>
              <div className="num"><Count value={left ?? credits!.usedRand} prefix="R" /></div>
              <div className="delta">{left !== null ? `${Math.round(share! * 100)}% of this month's R${fmt(credits!.allowanceRand!)} left` : `so far in ${new Date(credits!.month + "-01").toLocaleDateString("en-ZA", { month: "long" })} · credits arrive with your plan`}</div>
            </>)}
            <div style={{ display: "contents" }}>
              {card(0.1, "kpi clickable", <>
                <div className="row"><div className="label"><Icon d={I.people} colour="var(--o)" />Candidates</div><Spark data={d.series.cv} colour="var(--o)" what={`New candidates each day, last ${days} days`} /></div>
                <div className="num"><Count value={d.candidates.inPeriod} /></div>
                <Delta v={cvDelta} text={`new in ${days} days · ${fmt(d.candidates.total)} in all`} />
              </>, () => go({ kind: "new", days }, `the candidates added in the last ${days} days`), `Candidates: ${fmt(d.candidates.inPeriod)} new in ${days} days. Open them on the Matching Board`)}
              {card(0.16, "kpi clickable", <>
                <div className="row"><div className="label"><Icon d={I.jobs} colour="var(--l)" />Open jobs</div><Spark data={d.series.jobs} colour="var(--l)" what={`Jobs opened each day, last ${days} days`} /></div>
                <div className="num"><Count value={d.jobs.open} /></div>
                <div className="delta">open now · {fmt(d.jobs.newInPeriod)} opened in {days} days</div>
              </>, () => go({ kind: "jobs" }, "the open jobs"), `Open jobs: ${fmt(d.jobs.open)}. Open them on the Matching Board`)}
              {card(0.22, "kpi clickable", <>
                <div className="row"><div className="label"><Icon d={I.list} colour="var(--e)" />Shortlisted</div><Spark data={d.series.sl} colour="var(--e)" what={`People shortlisted each day, last ${days} days`} /></div>
                <div className="num"><Count value={d.series.sl.reduce((a, b) => a + b, 0)} /></div>
                <Delta v={slDelta} text={`in ${days} days · ${fmt(d.shortlisted.count)} on shortlists for ${fmt(d.shortlisted.jobs)} ${d.shortlisted.jobs === 1 ? "job" : "jobs"}`} />
              </>, () => go({ kind: "shortlisted" }, "the shortlisted candidates"), `Shortlisted: ${fmt(d.series.sl.reduce((a, b) => a + b, 0))} in ${days} days. Open the shortlisted candidates on the Matching Board`)}
            </div>
          </section>

          <section className="grid row2">
            {card(0.28, "", <>
              <div className="hd">
                <div><h3><Icon d={I.trend} colour="var(--teal)" />Recruitment activity</h3><p className="sub">What came in and what moved forward, day by day.</p></div>
                {tab === "time" && <div className="legend">{(["cv", "match", "sl"] as const).map((k) => <span key={k} className={`chip${on[k] ? "" : " off"}`} style={{ "--c": `var(${k === "cv" ? "--cerulean" : k === "match" ? "--violet" : "--teal"})` } as CSSProperties} {...pressable(() => { if (Object.values(on).filter(Boolean).length > 1 || !on[k]) setOn({ ...on, [k]: !on[k] }); }, `Show ${k === "cv" ? "CVs read" : k === "match" ? "matches run" : "shortlisted"} on the chart`, on[k])}><i />{k === "cv" ? "CVs read" : k === "match" ? "Matches run" : "Shortlisted"}</span>)}</div>}
              </div>
              <div className="tabs"><button className={tab === "time" ? "on" : ""} onClick={() => setTab("time")}>Over time</button><button className={tab === "pipe" ? "on" : ""} onClick={() => setTab("pipe")}>Pipeline</button></div>
              <div className="chartbox">{tab === "time" ? <ActivityChart data={d.series} on={on} /> : <Pipeline p={d.pipeline} days={days} />}</div>
            </>)}
            {card(0.34, "", <>
              <div className="hd"><div><h3><Icon d={I.star} colour="var(--cerulean)" />Strongest matches</h3><p className="sub">The AI's final scores in the last {days} days. A recommendation for a person to review, never a decision.</p></div></div>
              <Strongest items={d.strongest} days={days} open={(m) => go({ kind: "match", candidateId: m.candidateId, jobId: m.jobId }, `${m.candidateName}'s saved assessment for ${m.jobTitle}`)} />
            </>)}
          </section>

          <section className="grid row3">
            {card(0.4, "", <>
              <div className="hd"><div><h3><Icon d={I.layers} colour="var(--amber)" />Top departments</h3><p className="sub">{famBy === "jobs" ? "Open jobs by department." : "Candidates by the department of their work."}</p></div></div>
              <div className="tabs"><button className={famBy === "jobs" ? "on" : ""} onClick={() => setFamBy("jobs")}>Open jobs</button><button className={famBy === "candidates" ? "on" : ""} onClick={() => setFamBy("candidates")}>Candidates</button></div>
              <Departments key={famBy} items={d.families} by={famBy} open={(dept) => go({ kind: "department", dept }, `the jobs and candidates in ${dept}`)} />
            </>)}
            {card(0.46, "", <>
              <div className="hd"><div><h3><Icon d={I.talent} colour="var(--violet)" />Incoming talent</h3><p className="sub">New candidates by years of dated experience.</p></div></div>
              <Talent items={d.experience} />
            </>)}
            {card(0.52, "", <>
              <div className="hd"><div><h3><Icon d={I.alert} colour="var(--coral)" />Needs attention</h3><p className="sub">{d.attention.length > 4 ? `Work waiting on a person, most urgent first; ${d.attention.length - 4} more after these.` : "Work waiting on a person, most urgent first."}</p></div></div>
              {d.attention.length ? d.attention.slice(0, 4).map((a) => { const [c, ic] = ATTENTION_LOOK[a.id] ?? ["--coral", I.alert]; return (
                <button key={a.id} className="att" onClick={() => openAttention(a)}>
                  <Icon d={ic} colour={`var(${c})`} /><div><b>{a.title}</b><span>{a.detail}</span></div>
                  <span className="count" style={{ background: `color-mix(in srgb, var(${c}) 18%, transparent)`, color: `var(${c})` }}><Count value={a.count} /></span><span className="go">›</span>
                </button>
              ); }) : (
                <div className="allclear"><span className="tick" aria-hidden>✓</span><div><b>Nothing is waiting on you</b><span>Every shortlist, interview and strong match has its next step. This updates as your team works.</span></div></div>
              )}
            </>)}
          </section>

          {card(0.58, "team", <>
            <div><h3><Icon d={I.pulse} colour="var(--green)" />Recent portal activity</h3><p className="sub" style={{ marginTop: 6 }}><span className="dot" style={{ color: "var(--green)" }}>Live</span> &nbsp;{mode === "demo" ? "from the demo organisation" : "everyone in this portal"}</p></div>
            {/* The latest 50, newest first. The strip drifts slowly left so the newest work keeps passing by, stops while it is pointed at or has focus,
                and can be scrolled by hand (wheel, trackpad or touch); after a scroll it waits a few seconds before drifting again (owner, 10 Nov 2026:
                "I should be able to scroll through it, and it needs to show the latest 50 entries at all times"). Each line opens what it was about. */}
            <div className="events" ref={strip}>
              {d.activity.length ? (() => {
                const line = (a: OverviewData["activity"][number], copy = false) => {
                  const key = a.at + a.what, fresh = !copy && !seen.current.has(key); if (fresh) seen.current.add(key);
                  const target: BoardFocus | null = a.match && a.candidateId && a.jobId ? { kind: "match", candidateId: a.candidateId, jobId: a.jobId } : a.candidateId || a.jobId ? { kind: "record", candidateId: a.candidateId, jobId: a.jobId } : null;
                  const body = <><span className="av" style={{ background: avatarBg(a.who || "RoleMatch") }}>{initials(a.who || "RoleMatch")}</span><div style={{ minWidth: 0 }}><b>{a.who ? `${shortName(a.who)}: ` : ""}{a.what}</b><span className="when">{ago(a.at)}</span></div></>;
                  // Every line opens its details (owner, 10 Nov 2026: "if something is in activity, it needs to be clickable").
                  return <button key={(copy ? "c" : "") + key} className={`ev clickable${fresh && !first.current ? " fresh" : ""}`} tabIndex={copy ? -1 : 0} aria-hidden={copy || undefined} title="See what happened" onClick={(e) => setDetail({ a, target, at: (e.currentTarget as HTMLElement).getBoundingClientRect() })}>{body}</button>;
                };
                return <div className="track">{d.activity.map((a) => line(a))}{drifting && d.activity.map((a) => line(a, true))}</div>;
              })() : <p className="empty" style={{ margin: 0 }}>Nothing yet. Uploads, matches and status changes appear here as they happen.</p>}
            </div>
          </>)}
        </>)}
      </main>
    </div>
  );
}
