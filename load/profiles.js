// The crowd shapes the recruiter's journey (journey.js) runs under, chosen by name (load/run.sh <shape>). Every shape carries the same pass marks, taken
// from the live health report's own limits (server/src/config.ts OPS_*): fewer than 1% of requests failing, and the slowest 5% of pages (lists, a
// candidate, a note) under 2 seconds. Signing in (slow on purpose: the password check resists guessing) and uploading a file have their own marks.
//   smoke   one person, once; stops at the first failed check. A quick "does it work at all" after a release.
//   hold    VUS people (default 10), arriving over 30 seconds, for DURATION (default 3m). load/run.sh steps runs it at 10, 25, 50 and 100 in turn.
//   spike   a rush: from none to SPIKE people (default 100) in 30 seconds, a minute there, and away again.
//   steady  RATE new journeys a minute (default 30) for 5 minutes, however long each takes: a steady flow of arrivals.
const passMarks = {
  http_req_failed: ["rate<0.01"],
  "http_req_duration{kind:page}": ["p(95)<2000"],
  "http_req_duration{kind:sign-in}": ["p(95)<5000"],
  "http_req_duration{kind:upload}": ["p(95)<10000"],
  checks: ["rate>0.99"],
};
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

// Each pretend recruiter keeps their sign-in from one round to the next, as a browser does (k6 forgets cookies between rounds unless told).
export function profile(name) {
  return { noCookiesReset: true, ...shape(name) };
}
function shape(name) {
  switch (name) {
    case "smoke": return { vus: 1, iterations: 1, thresholds: { checks: [{ threshold: "rate==1.00", abortOnFail: true }] } };
    // People arrive over half a minute, as an office does, then stay: all signing in within the same instant is the spike shape's job (and is refused
    // by design past 40 requests in hand, server/src/index.ts SVC-BUSY; first steps run, 23 Nov 2026).
    case "hold": return { scenarios: { hold: { executor: "ramping-vus", startVUs: 0, gracefulRampDown: "3m", stages: [{ duration: "30s", target: num(__ENV.VUS, 10) }, { duration: __ENV.DURATION || "3m", target: num(__ENV.VUS, 10) }] } }, thresholds: passMarks };
    case "spike": return { scenarios: { spike: { executor: "ramping-vus", startVUs: 0, gracefulRampDown: "1m", stages: [{ duration: "30s", target: num(__ENV.SPIKE, 100) }, { duration: "1m", target: num(__ENV.SPIKE, 100) }, { duration: "30s", target: 0 }] } }, thresholds: passMarks };
    case "steady": return { scenarios: { steady: { executor: "constant-arrival-rate", rate: num(__ENV.RATE, 30), timeUnit: "1m", duration: "5m", preAllocatedVUs: 20, maxVUs: 200 } }, thresholds: passMarks };
    default: throw new Error(`unknown crowd shape "${name}": smoke, hold, spike or steady (or "steps" through load/run.sh)`);
  }
}
