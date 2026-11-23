// Not part of the ordinary suite: UPLOAD_JOURNEY=1 npm run test:local -- test/candidate/uploadJourney.test.ts. Starts a throw-away server on the local stack with the candidate pipeline switched on for its organisation, then drives the real
// app in Google Chrome through the file picker (e2e/upload-journey.spec.ts). The spec asks this process to restart the server mid-work, which is how recovery is tried. Needs `npm run build` first: the server serves the built app.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeWorld } from "../portalKit";

test.runIf(process.env.UPLOAD_JOURNEY)("the upload journey through the browser's file picker", async () => {
  const w = await makeWorld(8840, 1), A = w.users[0]; A.portal = (await A.get("/api/portals")).body[0].id;
  const cur = (await A.get("/api/settings")).body;
  expect((await A.req("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: cur.version, reading: { ...cur.settings.reading, candidatePipeline: true } }) })).status).toBe(200);
  const control = createServer(async (req, res) => { if (req.url === "/restart") { await w.restart(); res.end("restarted"); } else if (req.url === "/stop") { w.server.kill(); await w.server.exited; res.end("stopped"); } else { res.statusCode = 404; res.end(); } }).listen(8841);
  const code = await new Promise<number>((resolve) => {
    const p = spawn("npx", ["playwright", "test", "-c", "playwright.upload.config.ts", ...(process.env.JOURNEY_ARGS?.split(" ") ?? [])], { cwd: join(import.meta.dirname, "..", "..", ".."), stdio: "inherit", env: { ...process.env, BASE_URL: w.base, JOURNEY_EMAIL: A.email, JOURNEY_PASSWORD: "a-long-enough-password-1", JOURNEY_CONTROL: "http://localhost:8841" } });
    p.on("exit", (c) => resolve(c ?? 1));
  });
  control.close();
  // what the database holds afterwards, whatever the browser showed
  A.jar.clear(); await A.post("/api/auth/login", { email: A.email, password: "a-long-enough-password-1" });
  const saved = (await A.get("/api/candidates?limit=100")).body.items as any[], names = saved.map((c) => c.name);
  console.log(`saved candidates: ${saved.length}: ${names.join(", ")}`);
  expect(new Set(names).size).toBe(names.length);   // a restart must not publish anyone twice
  await w.stop();
  expect(code).toBe(0);
}, 40 * 60 * 1000);
