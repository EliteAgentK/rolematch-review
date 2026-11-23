// Signs invented people in once at a steady rate, so a crowd can start with sessions already open and sign-in is measured on its own, not as a side effect. Tokens last an hour. The output holds disposable sessions for the disposable stack, and is private.
//   node prelogin.mjs --base http://127.0.0.1:18801 --origin http://localhost:18795 --accounts accounts.json --out sessions.json [--at-once 40]
import { readFileSync, writeFileSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg("base"), ORIGIN = arg("origin", BASE), AT_ONCE = Number(arg("at-once", 40));
const { password, accounts } = JSON.parse(readFileSync(arg("accounts"), "utf8"));
if (!accounts.every((a) => a.email.endsWith("@load.invalid"))) { console.error("Refusing: accounts must be the invented ones."); process.exit(2); }
let next = 0, ok = 0, failed = 0; const t0 = Date.now(), out = {}, times = [];
await Promise.all(Array.from({ length: AT_ONCE }, async () => {
  while (next < accounts.length) {
    const a = accounts[next++], t = performance.now();
    try {
      const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": a.ip }, body: JSON.stringify({ email: a.email, password }), signal: AbortSignal.timeout(60_000) });
      await r.text();
      if (r.status === 200) { out[a.email] = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); ok++; } else { failed++; if (failed < 4) console.log("sign-in refused", r.status); }
    } catch (e) { failed++; if (failed < 4) console.log("sign-in failed", e?.name); }
    times.push(performance.now() - t);
  }
}));
times.sort((a, b) => a - b);
writeFileSync(arg("out"), JSON.stringify(out), { mode: 0o600 });
console.log(`${ok} signed in, ${failed} not, in ${Math.round((Date.now() - t0) / 1000)} s; p50 ${Math.round(times[times.length >> 1])} ms, p95 ${Math.round(times[Math.floor(times.length * 0.95)])} ms`);
