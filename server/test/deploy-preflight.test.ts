import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// The owner, 2026-11-05: rehearsal must never reach live by construction, and the refusal must be tested. Register R108, R116. Values are invented for this test.
const ROOT = join(import.meta.dirname, "..", ".."), dir = mkdtempSync(join(tmpdir(), "preflight-"));
const LIVE = { ROLEMATCH_ENVIRONMENT: "live", DATABASE_URL: "postgres://u:p@db.example-pooler.test:5432/postgres", SUPABASE_URL: "https://live.example.test", SUPABASE_SERVICE_ROLE_KEY: "live-service-key", LOCAL_ENCRYPTION_KEY: "live-enc", OPS_TOKEN: "live-ops", BACKUP_KEY: "live-backup", PORT: "18787", MAIL_SMTP_HOST: "smtp.example.test" };
const REHEARSAL = { ROLEMATCH_ENVIRONMENT: "rehearsal", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local-key", LOCAL_ENCRYPTION_KEY: "local-enc", OPS_TOKEN: "local-ops", BACKUP_KEY: "local-backup", PORT: "18795", MAIL_SMTP_HOST: "127.0.0.1" };
const envFile = (name: string, o: Record<string, string>) => { const p = join(dir, name); writeFileSync(p, Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); return p; };
const run = (kind: string, reh: Record<string, string>, live = LIVE, scripts: { rehearse?: string; run?: string } = {}) => { const r = spawnSync("bash", [join(ROOT, "deploy/preflight.sh"), kind], { encoding: "utf8", env: { ...process.env, ROLEMATCH_REHEARSAL_ENV: envFile("reh.env", reh), ROLEMATCH_LIVE_ENV: envFile("live.env", live), ...(scripts.rehearse ? { ROLEMATCH_REHEARSE_SCRIPT: scripts.rehearse } : {}), ...(scripts.run ? { ROLEMATCH_LIVE_SCRIPT: scripts.run } : {}) } }); return { code: r.status, out: r.stdout + r.stderr }; };

test("separate environments pass, with today's real scripts", () => { const r = run("rehearsal", REHEARSAL); expect(r.out).toContain("shares nothing"); expect(r.code).toBe(0); });
test.each([
  ["a settings file that does not say what it is", { ROLEMATCH_ENVIRONMENT: "" }, "ROLEMATCH_ENVIRONMENT"],
  ["live's database", { DATABASE_URL: LIVE.DATABASE_URL }, "not on this machine"],
  ["a hosted database of any kind", { DATABASE_URL: "postgres://u:p@other.example.test/db" }, "not on this machine"],
  ["live's Supabase", { SUPABASE_URL: LIVE.SUPABASE_URL }, "Supabase"],
  ["mail that leaves the machine", { MAIL_SMTP_HOST: "smtp.example.test" }, "mail"],
  ["live's service key", { SUPABASE_SERVICE_ROLE_KEY: LIVE.SUPABASE_SERVICE_ROLE_KEY }, "SUPABASE_SERVICE_ROLE_KEY"],
  ["live's encryption key", { LOCAL_ENCRYPTION_KEY: LIVE.LOCAL_ENCRYPTION_KEY }, "LOCAL_ENCRYPTION_KEY"],
  ["live's port", { PORT: LIVE.PORT }, "port"],
])("rehearsal is refused with %s", (_what, change, says) => { const r = run("rehearsal", { ...REHEARSAL, ...change }); expect(r.code).toBe(3); expect(r.out).toContain(says); });
test("a rehearsal script naming a live container is refused, however it got there", () => {
  const rehearse = join(dir, "bad-rehearse.sh"), real = readFileSync(join(ROOT, "deploy/rehearse.sh"), "utf8");
  writeFileSync(rehearse, real.replace("--name iso-api", "--name rm-api"));
  const r = run("rehearsal", REHEARSAL, LIVE, { rehearse }); expect(r.code).toBe(3); expect(r.out).toMatch(/live's containers|live container/);
});
test("a rehearsal script using live's data volume is refused", () => {
  const rehearse = join(dir, "bad-volume.sh"), real = readFileSync(join(ROOT, "deploy/rehearse.sh"), "utf8");
  writeFileSync(rehearse, real.replace("VOL=rolematch-rehearsal-data", "VOL=rolematch-mac-data"));
  const r = run("rehearsal", REHEARSAL, LIVE, { rehearse }); expect(r.code).toBe(3); expect(r.out).toContain("volume");
});
// R152: live's run script came to name its volume as a default (${ROLEMATCH_DATA_VOLUME:-rolematch-mac-data}) and the guard stopped seeing it; the PC's live volume is named in its nightly backup.
test("a rehearsal script using either machine's live data volume is refused, however the name is written", () => {
  const real = readFileSync(join(ROOT, "deploy/rehearse.sh"), "utf8");
  for (const vol of ["rolematch-mac-data", "rolematch-pc-data"]) {
    const rehearse = join(dir, `bad-${vol}.sh`); writeFileSync(rehearse, real.replace("VOL=rolematch-rehearsal-data", `VOL=${vol}`));
    const r = run("rehearsal", REHEARSAL, LIVE, { rehearse }); expect([vol, r.code]).toEqual([vol, 3]); expect(r.out).toContain(vol);
  }
});
test("live is refused if its settings do not say so, or point at this machine", () => {
  expect(run("live", REHEARSAL, { ...LIVE, ROLEMATCH_ENVIRONMENT: "rehearsal" }).code).toBe(3);
  expect(run("live", REHEARSAL, { ...LIVE, DATABASE_URL: REHEARSAL.DATABASE_URL }).code).toBe(3);
  expect(run("live", REHEARSAL).code).toBe(0);
});
// The move to the PC (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, C4): live's database may be on this machine only when its settings say the PC is its
// home, and never with the local stack's well-known password.
test("live on the PC's own database passes only when its settings say so, and never with a default password", () => {
  const url = (who: string) => "postgres://" + who + "@127.0.0.1:5434/postgres";   // invented, built in pieces so no line holds an address with a password
  const onPc = { ...LIVE, DATABASE_URL: url("rm_app:" + "invented-for-this-test") };
  expect(run("live", REHEARSAL, onPc).code).toBe(3);
  const told = run("live", REHEARSAL, { ...onPc, DATABASE_HOME: "pc" }); expect(told.code).toBe(0); expect(told.out).toContain("PC's own database");
  const weak = run("live", REHEARSAL, { ...onPc, DATABASE_HOME: "pc", DATABASE_URL: url("postgres:" + "postgres") });
  expect(weak.code).toBe(3); expect(weak.out).toContain("default password");
});
// C7: live's run script builds its names from a prefix ("${P}-api"); the guard still knows them, so a rehearsal using any of them is refused.
test("live's container names are still known when the run script builds them from its prefix", () => {
  const live = readFileSync(join(ROOT, "deploy/mac/run.sh"), "utf8");
  expect(live).toMatch(/--name "\$\{P\}-console"/);
  const rehearse = join(dir, "bad-console.sh"), real = readFileSync(join(ROOT, "deploy/rehearse.sh"), "utf8");
  writeFileSync(rehearse, real.replace("--name iso-api", "--name rm-console"));
  const r = run("rehearsal", REHEARSAL, LIVE, { rehearse }); expect(r.code).toBe(3); expect(r.out).toContain("rm-console");
});
