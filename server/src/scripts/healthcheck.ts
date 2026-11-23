// Docker's health check for one container, asking that container's own service (R161: every container used to ask the API, so a stuck worker looked healthy).
//   node src/scripts/healthcheck.js http://127.0.0.1:8790/health       healthy when the service answers 2xx (and, if it answers JSON with "ok", ok is true)
//   node src/scripts/healthcheck.js file:/tmp/monitor-alive 180        healthy when the file was touched in the last 180 seconds (a process with no port)
// deploy/mac/run.sh names each container's check beside its port. Exit 0 healthy, 1 not.
import { statSync } from "node:fs";

export async function healthy(target: string, maxAgeSec = 180, now = Date.now()): Promise<boolean> {
  if (target.startsWith("file:")) {
    try { return now - statSync(target.slice(5)).mtimeMs <= maxAgeSec * 1000; } catch { return false; }
  }
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const j: any = await r.json().catch(() => null);
    return j === null || typeof j !== "object" || !("ok" in j) || j.ok === true;
  } catch { return false; }
}

if (process.argv[1]?.endsWith("healthcheck.js") || process.argv[1]?.endsWith("healthcheck.ts")) {
  process.exit((await healthy(process.argv[2] ?? "", Number(process.argv[3] ?? 180))) ? 0 : 1);
}
