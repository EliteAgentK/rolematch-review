// Run by mail-isolation.test.ts against a throw-away schema and a slow simulated mail host: how long do verification-class sends take while a burst of invitation-class sends is going?
import { sendMail } from "../../src/mail";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const one = async (cls: "authentication" | "invitation", i: number) => {
  const t0 = Date.now();
  try { await sendMail({ cls, to: `probe${i}@example.test`, subject: "s", html: "<p>h</p>", text: "t", template: "probe", templateVersion: "1" }); return { ok: true, ms: Date.now() - t0 }; }
  catch (e: any) { return { ok: false, ms: Date.now() - t0, kind: e?.kind ?? String(e?.name ?? "error") }; }
};
const burst = process.env.PROBE_MODE === "burst";
const t0 = Date.now();
// the invitation dispatcher sends one message at a time, in order: that is the burst
const bulk = burst ? (async () => { const r = []; for (let i = 0; i < Number(process.env.PROBE_BURST ?? 12); i++) r.push(await one("invitation", i)); return r; })() : Promise.resolve([]);
await sleep(300);
const auth: { ok: boolean; ms: number }[] = [];
for (let i = 0; i < 4; i++) { const p = one("authentication", 100 + i); await sleep(200); auth.push(await p); }
const b = await bulk;
console.log(JSON.stringify({ auth, bulkCount: b.length, bulkOk: b.filter((x) => x.ok).length, bulkTotalMs: Date.now() - t0 }));
process.exit(0);
