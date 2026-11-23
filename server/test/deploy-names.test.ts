import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// R108: the isolated rehearsal and the live service run on one machine for now, and the rehearsal force-removes its own containers by name. The two sets of names must never meet.
const read = (f: string) => readFileSync(join(import.meta.dirname, "../../deploy", f), "utf8");
const names = (text: string) => new Set([...text.matchAll(/--name\s+([\w-]+)/g)].map((m) => m[1]));
// run.sh builds its names and ports from a prefix and defaults (the copy beside live runs it with others, docs/architecture/DESIGN_JOHANNESBURG_MOVE.md C7).
// Every check below reads it as live runs it: the defaults are taken from the script's own line, so the two cannot drift apart.
function liveRun() {
  const text = read("mac/run.sh"), dflt = (v: string) => new RegExp(`${v}="\\$\\{[A-Z_]+:-([\\w-]+)\\}"`).exec(text)?.[1];
  const P = dflt("P"), WHP = dflt("WHP"), AHP = dflt("AHP"), CPORT = dflt("CPORT");
  expect([P, WHP, AHP, CPORT], "run.sh names its defaults for the prefix and the three ports").toEqual(["rm", expect.any(String), expect.any(String), expect.any(String)]);
  return text.replace(/"\$\{P\}-([\w-]+)"/g, `${P}-$1`).replace(/"\$WHP"|\$WHP\b/g, WHP!).replace(/"\$AHP"|\$AHP\b/g, AHP!).replace(/"\$CPORT"|\$CPORT\b/g, CPORT!);
}

test("the rehearsal never names, starts or removes a live container", () => {
  const rehearsal = read("rehearse.sh") + read("recoveryDrill.sh"), live = new Set(["rm-api", "rm-worker", "rm-ai-worker", "rm-monitor", "rm-console"]);
  for (const n of live) expect(liveRun()).toContain(n);
  expect(live.size).toBeGreaterThan(0);
  for (const name of [...live, "rm-tunnel"]) expect(rehearsal, name).not.toContain(name);
  for (const name of names(rehearsal)) expect(name).toMatch(/^iso-/);
});

// R161: the console was released on 8790, the port the document worker's health check takes by default, and the worker could not start. Every live
// container that listens names its port in run.sh, and no two share one, the API's included.
test("every live container that listens names its own port, and no two share one", () => {
  const run = liveRun().split("\n").filter((l) => /docker run .*--name rm-/.test(l) || /^\s+--memory .*node src\//.test(l));
  const lines = run.join("\n").replace(/\\\n/g, " ").split(/(?=docker run )/).filter((l) => /--name (rm-[\w-]+)/.test(l));
  const listens: Record<string, string> = { "src/worker.js": "WORKER_HEALTH_PORT", "src/console/server.js": "CONSOLE_PORT" };
  // The API's port comes from the host's settings file (18787 on the PC), which is not in Git; its default stands in for it here.
  const ports: Record<string, string> = { "rm-api": /port: num\("PORT", (\d+)\)/.exec(readFileSync(join(import.meta.dirname, "../src/config.ts"), "utf8"))![1] };
  for (const l of lines) {
    const name = /--name (rm-[\w-]+)/.exec(l)![1], entry = Object.keys(listens).find((e) => l.includes(`node ${e}`));
    if (!entry) continue;
    const port = new RegExp(`-e ${listens[entry]}=(\\d+)`).exec(l)?.[1];
    expect(port, `${name} must set ${listens[entry]} itself`).toBeDefined();
    ports[name] = port!;
  }
  expect(Object.keys(ports)).toEqual(expect.arrayContaining(["rm-api", "rm-worker", "rm-ai-worker", "rm-console"]));
  expect(new Set(Object.values(ports)).size, JSON.stringify(ports)).toBe(Object.keys(ports).length);
});

// R161, second half: the image's health check asked the API's port for every container, so a stuck worker showed "healthy" whenever the API answered.
test("each container that listens has a health check asking its own port, and the monitor one reading its heartbeat", () => {
  const run = liveRun().replace(/\\\n/g, " ");
  for (const [name, env] of [["rm-worker", "WORKER_HEALTH_PORT"], ["rm-ai-worker", "WORKER_HEALTH_PORT"], ["rm-console", "CONSOLE_PORT"]]) {
    const line = run.split("\n").find((l) => l.includes(`--name ${name} `))!;
    const port = new RegExp(`-e ${env}=(\\d+)`).exec(line)?.[1], asks = /--health-cmd "node src\/scripts\/healthcheck\.js http:\/\/127\.0\.0\.1:(\d+)\//.exec(line)?.[1];
    expect(asks, `${name} needs its own health check`).toBeDefined();
    expect(asks, name).toBe(port);
  }
  expect(run.split("\n").find((l) => l.includes("--name rm-monitor "))).toMatch(/--health-cmd "node src\/scripts\/healthcheck\.js file:\/tmp\/monitor-alive \d+"/);
});

// R164: the monitor started beside an API that was still restarting, and every release e-mailed the owner an outage and its all-clear.
test("a release starts the monitor only after the API's readiness check, and starts it whether or not the API came up", () => {
  const run = liveRun(), ready = run.indexOf("/api/ready"), monitor = run.indexOf("--name rm-monitor");
  expect(ready).toBeGreaterThan(0);
  expect(monitor, "rm-monitor must start after the readiness loop").toBeGreaterThan(ready);
  expect(run.slice(monitor)).toMatch(/NOT READY/);   // the not-ready exit comes after the monitor is started
  // ...and the old monitor is stopped on its own before anything it watches (8 Nov: stopped together with the API, it alerted during the swap).
  const stops = [...run.matchAll(/docker stop [^\n]*/g)].map((m) => m[0]);
  expect(stops[0], "the first stop must be the monitor alone").toMatch(/^docker stop (?:--time \d+ )?rm-monitor\b(?!.*rm-)/);
  expect(stops.slice(1).join(" ")).not.toContain("rm-monitor");
});

// The named tunnel (docs/ops/NAMED_TUNNEL_PLAN.md) must send each address to the container that owns it, and nothing else anywhere.
test("the tunnel sends app. to the API, console. only to the console's own port, and everything else to 404", () => {
  const tunnel = read("pc/cloudflared.yml"), consolePort = /-e CONSOLE_PORT=(\d+)/.exec(liveRun())![1];
  expect(tunnel).toMatch(/hostname: app\.rolematch\.co\.za\n\s+service: http:\/\/127\.0\.0\.1:__API_PORT__/);
  for (const m of tunnel.matchAll(/hostname: console\.rolematch\.co\.za\n\s*#?\s*service: http:\/\/127\.0\.0\.1:(\d+)/g)) expect(m[1]).toBe(consolePort);
  const rules = [...tunnel.matchAll(/^\s+- (?:hostname|service): (.+)$/gm)].map((m) => m[1]);
  expect(rules.at(-1)).toBe("http_status:404");
  // the copy beside live (next.) goes to the copy's own API port, never to live's or the console's
  const next = /hostname: next\.rolematch\.co\.za\n\s+service: http:\/\/127\.0\.0\.1:(\d+)/.exec(tunnel)?.[1];
  if (next) { expect(next).not.toBe(consolePort); expect(next).not.toBe("18787"); }
  for (const h of [...tunnel.matchAll(/hostname: ([\w.-]+)/g)].map((m) => m[1])) expect(["app.rolematch.co.za", "console.rolematch.co.za", "next.rolematch.co.za"]).toContain(h);
  expect(tunnel).not.toMatch(/AccountTag|TunnelSecret/);
});
