// Security audit, 6 Nov 2026: unknown addresses that name a file or a hidden file are not found, rather than answered with the app's page, so a scanner does not report
// "/.env answers 200"; the app's own pages, the page shell and the built files are still served. Needs the built frontend (npm run build at the repository root).
import { existsSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, type World } from "./portalKit";

const built = existsSync(new URL("../../dist/index.html", import.meta.url));
let w: World;
beforeAll(async () => { if (built) w = await makeWorld(8871, 1); }, 180000);
afterAll(async () => { await w?.stop(); });

test.skipIf(!built)("hidden and file-like addresses are not found; the app's pages are served", async () => {
  for (const p of ["/.env", "/server/.env", "/.git/config", "/supabase/config.toml", "/deploy/limits.sh", "/wp-login.php", "/backup.zip"]) {
    const r = await fetch(`${w.base}${p}`);
    expect([p, r.status]).toEqual([p, 404]);
    expect(await r.text()).toBe("Not found");
  }
  for (const p of ["/", "/login", "/dashboard", "/accept-invite"]) {
    const r = await fetch(`${w.base}${p}`);
    expect([p, r.status, r.headers.get("content-type")]).toEqual([p, 200, "text/html"]);
  }
  expect((await fetch(`${w.base}/favicon.ico`)).status).toBe(200);
});
