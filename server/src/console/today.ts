// The Today page's judgement, kept apart from fetching and drawing so every case is tested without a server (docs/database/17, section 4 "Today").
// Plain words first, a word beside every colour, "unknown" with its reason where a source cannot be read, never a silent zero (17, section 5).
import { STALE_SEC, type Read } from "./sources";
import { needsYou, type OwnerEvent } from "./store";

export type Tone = "good" | "warn" | "bad" | "unknown";
export interface Line { label: string; value: string; tone: Tone; why?: string }
export interface Today { tone: Tone; headline: string; detail: string; needs: { title: string; tone: Tone; href: string }[]; lines: Line[]; latest: OwnerEvent[] }

export const ago = (sec: number | null | undefined) => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "unknown";
  if (sec < 90) return "just now";
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  if (sec < 48 * 3600) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} days ago`;
};
const span = (sec: number) => (sec < 90 ? `${sec} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`);
const unknown = (label: string, why: string): Line => ({ label, value: "unknown", tone: "unknown", why });
const stateTone = (s: string): Tone => (s === "healthy" ? "good" : s === "degraded" ? "warn" : s === "unavailable" ? "bad" : "unknown");

export function buildToday(h: Read<any>, pc: Read<any>, n: Read<Record<string, any>>, events: OwnerEvent[], now = new Date()): Today {
  const lines: Line[] = [];
  const stale = (r: Read<any>) => r.ok && r.ageSec > STALE_SEC;
  const hv = h.ok ? h.value : null, pv = pc.ok && !stale(pc) ? pc.value : null, nv = n.ok ? n.value : null;
  const pcWhy = !pc.ok ? pc.why : `the PC's status is ${ago(pc.ageSec)}, so it may be out of date`;

  // Live
  if (!hv) lines.push(unknown("Live", (h as any).why));
  else { const r = hv.checks?.readiness; lines.push({ label: "Live", value: r?.state === "healthy" ? "up" : r?.note ?? "not ready", tone: stateTone(r?.state ?? "unknown") }); }
  if (pv) lines.push(pv.containers?.tunnel ? { label: "Internet address", value: "connected", tone: "good" } : { label: "Internet address", value: "the tunnel is not running", tone: "bad" });

  // Reading CVs
  if (!hv) lines.push(unknown("CV reading", (h as any).why));
  else {
    const q = hv.checks?.queue ?? {};
    const waiting = Number(q.queued ?? 0);
    lines.push({ label: "CV reading", value: waiting ? `${waiting} waiting · oldest ${span(Number(q.oldestQueuedSec ?? 0))}` : "nothing waiting", tone: stateTone(q.state ?? "unknown") });
  }
  // Claude: what it is doing, and the month's spend against the platform's cap, from live's own health report.
  if (!hv) lines.push(unknown("AI", (h as any).why));
  else { const a = hv.checks?.ai; lines.push(!a ? unknown("AI", "this release does not report the AI") : { label: "AI", value: `${a.note} · $${Number(a.spentThisMonthUsd ?? 0).toFixed(2)} of $${a.monthlyCapUsd} this month`, tone: stateTone(a.state ?? "unknown") }); }

  // Safety
  if (!pv) lines.push(unknown("Last backup", pcWhy));
  else {
    const s = pv.liveBackupSec;
    lines.push(s === null ? { label: "Last backup", value: "none found", tone: "bad" } : { label: "Last backup", value: ago(s), tone: s < 26 * 3600 ? "good" : "bad" });
    const live = pv.liveDatabase, db = pv.ownDatabase ?? {};
    // Since the move live's database is on the PC (12 Nov 2026): its own lines; the earlier paused one (rm-db) is not live's and is not shown.
    if (live) {
      lines.push({ label: "Live's database", value: live.running ? "running" : "not running", tone: live.running ? "good" : "bad" });
      lines.push(live.baseCopySec === null ? { label: "Base copy", value: "none yet", tone: "bad" } : { label: "Base copy", value: ago(live.baseCopySec), tone: live.baseCopySec < 26 * 3600 ? "good" : "bad" });
      lines.push({ label: "Change log", value: live.archiving ? "archived each minute" : "archiving failed", tone: live.archiving ? "good" : "bad" });
      lines.push(!live.drill ? { label: "Restore drill", value: "has not run yet", tone: "warn" } : { label: "Restore drill", value: live.drill.passed ? `passed · ${ago(live.drill.ageSec)}` : "did not pass", tone: live.drill.passed && live.drill.ageSec < 8 * 86400 ? "good" : "bad" });
      const mac = pv.liveBackupCollectedByMacSec;
      lines.push(mac === null || mac === undefined ? { label: "Copy on the Mac", value: "never made", tone: "bad" } : { label: "Copy on the Mac", value: ago(mac), tone: mac < 26 * 3600 ? "good" : "bad" });
    } else if (!db.running) lines.push({ label: "Own database", value: "not running", tone: "bad" });
    else {
      const b = db.backups;
      lines.push(!b ? { label: "Own database backups", value: "unknown", tone: "unknown", why: "pgBackRest did not answer" }
        : { label: "Own database backups", value: b.ok ? `healthy · last ${ago(b.lastBackupSec)}` : "not healthy", tone: b.ok && b.lastBackupSec < 26 * 3600 ? "good" : "bad" });
      lines.push(db.macCopySec === null ? { label: "Copy on the Mac", value: "never made", tone: "bad" }
        : { label: "Copy on the Mac", value: ago(db.macCopySec), tone: db.macCopySec <= 15 * 60 ? "good" : db.macCopySec <= 3600 ? "warn" : "bad" });
      const d = db.drill;
      lines.push(!d ? { label: "Restore drill", value: "has not run yet", tone: "warn" }
        : { label: "Restore drill", value: d.passed ? `passed in ${d.seconds} s · ${ago(d.ageSec)}` : "did not pass", tone: d.passed && d.ageSec < 8 * 86400 ? "good" : "bad" });
    }
  }

  // People and problems
  if (!nv) { lines.push(unknown("Failed CVs (24 h)", (n as any).why)); lines.push(unknown("Sign-ups today", (n as any).why)); }
  else {
    const f = Number(nv.documentsFailed24h);
    lines.push({ label: "Failed CVs (24 h)", value: f ? `${f} could not be read` : "none", tone: f ? "warn" : "good" });
    lines.push({ label: "CVs read (24 h)", value: String(nv.documentsPublished24h), tone: "good" });
    lines.push({ label: "Sign-ups today", value: `${nv.peopleJoinedToday} people · ${nv.organisationsToday} organisations`, tone: "good" });
    lines.push({ label: "On RoleMatch", value: `${nv.people} people in ${nv.organisations} organisations`, tone: "good" });
  }
  if (pv) lines.push({ label: "Disk", value: `${pv.diskUsedPct}% used`, tone: pv.diskUsedPct < 80 ? "good" : pv.diskUsedPct < 90 ? "warn" : "bad" });
  if (pv) lines.push(pv.containers?.monitor ? { label: "Monitor", value: "watching", tone: "good" } : { label: "Monitor", value: "not running", tone: "bad" });

  const open = needsYou(events, now);
  const needs = [
    ...open.map((e) => ({ title: e.title + (e.times > 1 ? ` (×${e.times})` : ""), tone: (e.severity === "urgent" ? "bad" : "warn") as Tone, href: `/alerts/${e.id}` })),
    ...lines.filter((l) => l.tone === "bad" || l.tone === "warn").map((l) => ({ title: `${l.label}: ${l.value}`, tone: l.tone, href: "/#health" })),
  ];
  const bad = needs.some((x) => x.tone === "bad"), warn = needs.length > 0, blind = lines.some((l) => l.tone === "unknown");
  const tone: Tone = bad ? "bad" : warn ? "warn" : blind ? "unknown" : "good";
  const headline = bad ? "Needs you now" : warn ? `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you` : blind ? "Some of it cannot be seen" : "All well";
  const detail = blind ? lines.filter((l) => l.tone === "unknown").map((l) => `${l.label}: ${l.why}`).filter((v, i, a) => a.indexOf(v) === i).join(" · ") : `Checked ${now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" })}`;
  return { tone, headline, detail, needs, lines, latest: events };
}
