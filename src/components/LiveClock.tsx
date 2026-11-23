// The time, always in view beside the light and dark switch (owner, 12 Nov 2026: "a need for time to always be present ... if someone signs up from
// somewhere, they need to have the time that is on their laptop"; "the time needs to change, and it has to have very lovely animations ... whether I'm in
// light mode or dark"). It is the device's own time, in the device's own time zone and the device's own way of writing it (24-hour or am/pm): RoleMatch
// never decides it. The digits roll upward as they change, the ring beside them sweeps once a minute, and a soft light passes over it as each minute turns.
// Nothing moves for anyone whose device asks for less motion (src/theme/motion.css).
import { useEffect, useId, useState } from "react";
import "./LiveClock.css";

const CELLS = Array.from({ length: 20 }, (_, i) => <span key={i}>{i % 10}</span>);

/** One digit as a strip of figures that rolls upward to the next; from 9 (or 5, or 2) back to 0 it rolls on through, never backwards. */
function Digit({ d }: { d: number }) {
  const [pos, setPos] = useState(d), [snap, setSnap] = useState(false), [prev, setPrev] = useState(d);
  if (d !== prev) { setPrev(d); setSnap(false); setPos(d > prev ? d : d + 10); }
  return (
    <span className="rmc-digit" aria-hidden="true">
      <span className={`rmc-strip${snap ? " snap" : ""}`} style={{ transform: `translateY(${-pos * 5}%)` }}
        onTransitionEnd={() => { if (pos >= 10) { setSnap(true); setPos(pos - 10); } }}>{CELLS}</span>
    </span>
  );
}
const figures = (s: string) => [...s].map((c, i) => (/\d/.test(c) ? <Digit key={i} d={Number(c)} /> : <span key={i} aria-hidden="true">{c}</span>));

export default function LiveClock() {
  const [now, setNow] = useState(() => new Date()), gradient = useId().replace(/:/g, "");
  // A new reading at each turn of the minute (and at once when the tab comes back, after a laptop has slept); the seconds are the ring's, drawn by CSS.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { const d = new Date(); setNow(d); t = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 20); };
    const back = () => { if (document.visibilityState === "visible") { clearTimeout(t); tick(); } };
    tick(); document.addEventListener("visibilitychange", back);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", back); };
  }, []);
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "", minute = parts.find((p) => p.type === "minute")?.value ?? "", period = parts.find((p) => p.type === "dayPeriod")?.value;
  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone, offset = new Intl.DateTimeFormat(undefined, { timeZoneName: "shortOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value;
  const spoken = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(now);
  const minuteKey = `${hour}:${minute}`, into = now.getSeconds() + now.getMilliseconds() / 1000;
  return (
    <time className="rmc" dateTime={now.toISOString()} title={`Your device's time · ${zone}${offset ? ` (${offset})` : ""}`} aria-label={spoken}>
      <svg className="rmc-ring" viewBox="0 0 18 18" aria-hidden="true">
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--rmc-a)" /><stop offset="1" stopColor="var(--rmc-b)" /></linearGradient></defs>
        <circle className="t" cx="9" cy="9" r="7" />
        {/* Re-drawn each minute from where the seconds really are, so it never drifts from the device's clock. */}
        <circle key={minuteKey} className="s" cx="9" cy="9" r="7" stroke={`url(#${gradient})`} style={{ animationDelay: `-${into.toFixed(2)}s` }} />
      </svg>
      <span className="rmc-time">{figures(hour)}<span className="rmc-colon" aria-hidden="true">:</span>{figures(minute)}{period && <span className="rmc-period" aria-hidden="true">{period}</span>}</span>
      <span className="rmc-date" aria-hidden="true">{date}</span>
      <span key={`sheen-${minuteKey}`} className="rmc-sheen" aria-hidden="true" />
    </time>
  );
}
