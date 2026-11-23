// The monitor's decisions: one message when something goes wrong, silence while it stays wrong, a reminder each hour, and one message when it clears. No clock or mail host needed.
import { expect, test } from "vitest";
import { confirm, consoleEvent, decide, problemsNow, trendsNow } from "../src/scripts/monitor";

const down = [{ key: "outside", text: "The public address does not answer (connection failed)." }], empty = { since: {}, lastSent: {} }, MIN = 60_000;

test("a new problem is reported once, then nothing until the hourly reminder, then once when it clears with how long it lasted", () => {
  let st: any = empty, r = decide(down, st, 0);
  expect(r.send.map((m) => m.subject)).toEqual(["RoleMatch: The public address does not answer (connection failed)"]);
  st = r.next; r = decide(down, st, 30 * MIN); expect(r.send).toEqual([]);
  st = r.next; r = decide(down, st, 61 * MIN); expect(r.send[0].subject).toMatch(/^RoleMatch: still:/); expect(r.send[0].text).toMatch(/Ongoing for 61 minutes/);
  st = r.next; r = decide([], st, 75 * MIN); expect(r.send).toEqual([{ subject: "RoleMatch: back to normal (outside)", text: "Cleared after 75 minutes." }]);
  expect(r.next).toEqual(empty);
});

test("problems are told apart: a second one is reported even while the first lasts", () => {
  const first = decide(down, empty, 0), both = decide([...down, { key: "health:model", text: "model: degraded. documents are waiting because the model did not answer" }], first.next, 5 * MIN);
  expect(both.send.map((m) => m.subject)).toEqual(["RoleMatch: model: degraded"]);
});

// R162: on 6 and 7 Nov one slow health answer made mail and model "unknown" for a single minute, and the owner got two alerts and two all-clears for nothing.
test("a check that could not be measured once says nothing; twice in a row it is reported; a real fault is reported at once", () => {
  const unknown = { key: "health:mail", text: "mail: unknown. e-mail could not be measured (no answer in time)", unknown: true };
  const down2 = { key: "health:model", text: "model: degraded. documents are waiting" };
  let c = confirm([unknown, down2], empty);
  expect(c.problems).toEqual([down2]);
  let st: any = { ...decide(c.problems, empty, 0).next, unsure: c.unsure };
  c = confirm([], st);   // measured fine the next minute: nothing was ever sent about mail
  expect(c.problems).toEqual([]);
  expect(c.unsure).toEqual({});
  c = confirm([unknown], { ...empty, unsure: {} });
  st = { ...decide(c.problems, empty, 0).next, unsure: c.unsure };
  c = confirm([unknown], st);   // still unknown a minute later: now it is a problem
  const r = decide(c.problems, st, MIN);
  expect(r.send.map((m) => m.subject)).toEqual(["RoleMatch: mail: unknown"]);
  st = { ...r.next, unsure: c.unsure };
  expect(confirm([unknown], st).problems).toEqual([unknown]);   // once reported, it stays reported until it clears
});

test("what the monitor checks: an unanswered public address and every unhealthy check in the health report, by name", async () => {
  const fake = (async (url: string) => (String(url).endsWith("/api/ready") ? Promise.reject(new Error("refused")) : new Response(JSON.stringify({ checks: { database: { state: "healthy" }, model: { state: "degraded", note: "documents are waiting" } } })))) as typeof fetch;
  const p = await problemsNow(fake);
  expect(p.map((x) => x.key)).toEqual(["outside", "health:model"]);
});

// Trends (docs/ops/TRENDS_AND_LOAD.md): Prometheus's firing alerts become problems like any other, worded by the rule; pending ones wait for their "for".
test("trend alerts: firing ones are problems in the rule's own words, pending ones are not, two targets are one problem, and silence without Prometheus", async () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const alert = (name: string, state: string, severity = "today", job = "pc") => ({ state, labels: { alertname: name, severity, job }, annotations: { title: `${name} title`, meaning: `${name} meaning`, action: `${name} action` } });
  const found = await trendsNow(answer({ status: "success", data: { alerts: [alert("DiskFilling", "firing"), alert("ErrorsRising", "pending"), alert("NumbersMissing", "firing", "today", "pc"), alert("NumbersMissing", "firing", "today", "rolematch")] } }), "http://prom");
  expect(found.map((p) => p.key).sort()).toEqual(["trend:DiskFilling", "trend:NumbersMissing"]);
  const disk = found.find((p) => p.key === "trend:DiskFilling")!;
  expect(disk).toMatchObject({ severity: "today", meaning: "DiskFilling meaning", action: "DiskFilling action" });
  expect(disk.text).toBe("DiskFilling title. DiskFilling meaning\nWhat to do: DiskFilling action");
  expect(consoleEvent(disk)).toMatchObject({ fingerprint: "monitor:trend:DiskFilling", title: "DiskFilling title", meaning: "DiskFilling meaning", action: "DiskFilling action" });
  expect(decide([disk], { since: {}, lastSent: {} }, 0).send[0].subject).toBe("RoleMatch: DiskFilling title");
  expect((await trendsNow(answer({ status: "success", data: { alerts: [alert("DiskLow", "firing", "urgent")] } }), "http://prom"))[0].severity).toBe("urgent");
  expect(await trendsNow(answer({}), "")).toEqual([]);   // where Prometheus does not run, nothing is said about it
});

test("trends that cannot be read are a check that could not be measured: nothing the first minute, reported the second", async () => {
  const refused = (async () => { throw new Error("connection refused"); }) as unknown as typeof fetch;
  const [p] = await trendsNow(refused, "http://prom");
  expect(p).toMatchObject({ key: "trends", unknown: true, severity: "today" });
  const first = confirm([p], { since: {}, lastSent: {} });
  expect(first.problems).toEqual([]);
  expect(confirm([p], { since: {}, lastSent: {}, unsure: first.unsure }).problems).toEqual([p]);
  expect((await trendsNow((async () => new Response("bad gateway", { status: 502 })) as unknown as typeof fetch, "http://prom"))[0].key).toBe("trends");
});
