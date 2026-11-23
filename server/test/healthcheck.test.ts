// Each container's Docker health check (src/scripts/healthcheck.ts, R161): a service is healthy when it answers, and says ok if it says anything about ok;
// a process with no port is healthy while its heartbeat file is fresh.
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { healthy } from "../src/scripts/healthcheck";
import { fakeServe } from "./helpers";

test("a service is healthy when it answers 2xx, and not when it answers ok: false, an error, or nothing", async () => {
  let answer: Response = Response.json({ ok: true, role: "worker" });
  const s = fakeServe({ port: 8771, fetch: () => answer.clone() });
  await s.ready;
  try {
    expect(await healthy("http://127.0.0.1:8771/health")).toBe(true);
    answer = new Response("ok", { headers: { "content-type": "text/plain" } });
    expect(await healthy("http://127.0.0.1:8771/healthz")).toBe(true);
    answer = Response.json({ ok: false, role: "worker" }, { status: 200 });
    expect(await healthy("http://127.0.0.1:8771/health")).toBe(false);
    answer = Response.json({ ok: false }, { status: 503 });
    expect(await healthy("http://127.0.0.1:8771/health")).toBe(false);
  } finally { await s.stop(); }
  expect(await healthy("http://127.0.0.1:8771/health")).toBe(false);   // nothing listening
});

test("a heartbeat file is healthy while fresh, and not when old or missing", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "hc-")), "alive");
  expect(await healthy(`file:${f}`, 180)).toBe(false);
  writeFileSync(f, "1");
  expect(await healthy(`file:${f}`, 180)).toBe(true);
  const old = (Date.now() - 300_000) / 1000; utimesSync(f, old, old);
  expect(await healthy(`file:${f}`, 180)).toBe(false);
});
