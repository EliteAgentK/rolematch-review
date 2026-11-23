// The Claude connection (src/ai/claude.ts; owner, 8 Nov 2026), against a fake Anthropic server on this machine: nothing leaves the PC, nothing is paid.
// Work for a company is refused outside its portal; personal identifiers are masked before sending; every call is metered to its portal and its organisation's
// billing account, without its text; the fixed instructions are marked for the prompt cache; the monthly cap stops calls; failures become refusals, never throws.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fakeServe, setupTestDb, type TestDb } from "./helpers";

const PORT = 8776;
let tdb: TestDb, db: postgres.Sql, ai: typeof import("../src/ai/claude"), seen: any[] = [], reply: () => Response, server: ReturnType<typeof fakeServe>, inPortal: <T>(fn: () => T) => T;
const ORG = crypto.randomUUID(), PORTAL = crypto.randomUUID();
const message = (text: string, over: any = {}) => () => Response.json({ id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 }, ...over });
beforeAll(async () => {
  tdb = await setupTestDb();
  Object.assign(process.env, { DB_SCHEMA: tdb.schema, ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`, ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key", AI_MONTHLY_CAP_USD: "1", AI_MAX_RETRIES: "0" });
  vi.resetModules();
  ai = await import("../src/ai/claude");
  server = fakeServe({ port: PORT, fetch: async (req) => { seen.push({ path: new URL(req.url).pathname, key: req.headers.get("x-api-key"), headers: [...req.headers.keys()], authz: (req.headers.get("authorization") ?? "").slice(0, 14), fullAuth: req.headers.get("authorization") ?? req.headers.get("x-api-key"), beta: req.headers.get("anthropic-beta"), body: await req.json() }); return reply(); } });
  await server.ready;
  db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { search_path: tdb.schema }, onnotice: () => {} });
  await db`insert into orgs (id, name) values (${ORG}, 'Claude test org')`;
  await db`insert into portals (id, org_id, name) values (${PORTAL}, ${ORG}, 'Claude test portal')`;
  const { forPortal } = await import("../src/db"); inPortal = (fn) => forPortal(ORG, PORTAL, fn);
}, 120_000);
afterAll(async () => { await server?.stop(); await db?.end(); const { platformSql } = await import("../src/db"); await platformSql.end({ timeout: 5 }); await tdb?.teardown(); });

test("personal identifiers are masked before anything is sent: e-mail, phone, ID number, links and the names given", () => {
  const t = ai.maskPersonal("Thandi Mokoena | thandi.m@example.test | +27 82 555 0143 | 011 555 0199 | ID 9001015009087 | linkedin.com/in/thandi | https://thandi.dev\nWorked 2015 - 2020 at Acme, 3 years.", ["Thandi Mokoena"]);
  expect(t).toBe("[name] [name] | [email] | [phone] | [phone] | ID [id number] | [link] | [link]\nWorked 2015 - 2020 at Acme, 3 years.");
});

test("structured outputs get a closed schema without length limits; code checks lengths afterwards", () => {
  expect(ai.strictSchema({ type: "object", required: ["a"], properties: { a: { type: "string", maxLength: 50 }, b: { type: "array", maxItems: 6, items: { type: "object", properties: { c: { type: "integer" } } } } } }))
    .toEqual({ type: "object", required: ["a", "b"], additionalProperties: false, properties: { a: { type: "string" }, b: { type: "array", items: { type: "object", additionalProperties: false, required: ["c"], properties: { c: { type: "integer" } } } } } });
});

test("a matching question goes to Sonnet 5.5, masked, with the key in its header only and the refusal fallback on; the call is metered without its text", async () => {
  seen = []; reply = message(JSON.stringify({ roles: [] }));
  const a = await inPortal(() => ai.askClaude({ system: "Judge the match.", user: "Name: Thandi Mokoena, thandi.m@example.test, 082 555 0143", schema: { type: "object", properties: { roles: { type: "array", items: { type: "string" } } } }, names: ["Thandi Mokoena"], purpose: "matching" }));
  expect(a).toMatchObject({ ok: true, json: { roles: [] }, model: "claude-sonnet-5-5" });
  const sent = JSON.stringify(seen[0].body);
  expect(seen[0].path).toBe("/v1/messages");
  expect(sent).not.toMatch(/thandi|Mokoena|555 0143|example\.test/i);
  expect(sent).not.toContain("sk-ant");
  // Only RoleMatch's own key is sent (this library sends it as a bearer value), never another credential this machine holds.
  expect(seen[0].authz).toBe("Bearer sk-ant-");
  expect(seen[0].fullAuth ?? "").toBe("Bearer sk-ant-test-not-a-real-key");
  expect(seen[0].body).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" } } });
  expect(seen[0].beta).toContain("server-side-fallback-2026-07-01");
  expect(seen[0].body.system).toEqual([{ type: "text", text: "Judge the match.", cache_control: { type: "ephemeral" } }]);   // the fixed instructions, cached; no tenant data in them
  const rows = await db`select purpose, provider, model, input_tokens, output_tokens, cost_micro_usd, outcome, org_id, portal_id, account_id = (select id from billing_accounts where org_id = ${ORG}) as own_account from ai_usage`;
  expect(rows).toEqual([{ purpose: "matching", provider: "anthropic", model: "claude-sonnet-5-5", input_tokens: 1200, output_tokens: 300, cost_micro_usd: "5400", outcome: "answered", org_id: ORG, portal_id: PORTAL, own_account: true }]);   // 1200 × 2 + 300 × 10
});

test("an organisation's billing account is opened by the database when the organisation is created", async () => {
  const org = crypto.randomUUID();
  await db`insert into orgs (id, name) values (${org}, 'Opened with an account')`;
  expect((await db`select count(*)::int as n from billing_accounts where org_id = ${org}`)[0].n).toBe(1);
});

test("work for a company outside its portal is never sent: it would be billed to nobody", async () => {
  seen = []; reply = message("{}");
  expect(await ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" })).toMatchObject({ ok: false, why: "unavailable", detail: "AI work must belong to a portal" });
  expect(await ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "extraction" })).toMatchObject({ ok: false, detail: "AI work must belong to a portal" });
  expect(seen).toHaveLength(0);
});

test("cached input is priced at a tenth and cache writes at a quarter more, as Anthropic charges them", () => {
  expect(ai.microUsd("claude-sonnet-5-5", { input: 1000, output: 100, cacheRead: 10_000, cacheWrite: 0 })).toBe(1000 * 2 + 10_000 * 0.2 + 100 * 10);
  expect(ai.microUsd("claude-haiku-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 4000 })).toBe(Math.round(4000 * 0.1 * 1.25));
});

test("a CV read goes to Haiku 5.5 with no fallback (Haiku has none)", async () => {
  seen = []; reply = message("{}", { model: "claude-haiku-5-5" });
  expect(await inPortal(() => ai.askClaude({ model: ai.READ_MODEL, system: "s", user: "u", schema: { type: "object", properties: {} }, purpose: "extraction" }))).toMatchObject({ ok: true, model: "claude-haiku-5-5" });
  expect(seen[0].body.model).toBe("claude-haiku-5-5");
  expect(seen[0].body.fallbacks).toBeUndefined();
});

test("a declined, cut-off, empty or failed answer, and no key, are refusals with a reason, never a crash", async () => {
  reply = message("", { stop_reason: "refusal" });
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "unavailable", detail: "the request was declined" });
  reply = message("{\"roles\":", { stop_reason: "max_tokens" });
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "truncated" });
  reply = message("   ");
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "empty" });
  reply = () => Response.json({ type: "error", error: { type: "api_error", message: "boom" } }, { status: 500 });
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "unavailable" });
  const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "unavailable", detail: "no AI key is configured" });
  process.env.ANTHROPIC_API_KEY = key;
});

test("a company stops at its own monthly allowance: nothing more is sent for it, the refusal is recorded, and another company's AI goes on", async () => {
  // Owner, 12 Nov 2026: "can't have people driving up my clients' AI costs". One company at its allowance must not stop another.
  const BUSY = crypto.randomUUID(), BUSY_PORTAL = crypto.randomUUID();
  await db`insert into orgs (id, name, ai_monthly_cap_usd) values (${BUSY}, 'Busy company', 0.05)`;
  await db`insert into portals (id, org_id, name) values (${BUSY_PORTAL}, ${BUSY}, 'Busy portal')`;
  await db`insert into ai_usage (org_id, portal_id, purpose, provider, model, cost_micro_usd, outcome) values (${BUSY}, ${BUSY_PORTAL}, 'matching', 'anthropic', 'claude-sonnet-5-5', 50000, 'answered')`;   // $0.05: its allowance
  const { forPortal } = await import("../src/db");
  seen = []; reply = message("{}");
  expect(await forPortal(BUSY, BUSY_PORTAL, () => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "unavailable", detail: expect.stringContaining("monthly AI allowance of $0.05") });
  expect(seen).toHaveLength(0);
  expect((await db`select count(*)::int as n from ai_usage where org_id = ${BUSY} and outcome = 'refused'`)[0].n).toBe(1);
  // The other company (no figure of its own: the platform's $5) is still answered.
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: true });
  expect(seen).toHaveLength(1);
  // Raising the allowance lets it work again, within the 30 seconds the figure is kept (0 here).
  await db`update orgs set ai_monthly_cap_usd = 1 where id = ${BUSY}`;
  expect(await forPortal(BUSY, BUSY_PORTAL, () => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: true });
});

test("many calls starting together never take a company past its allowance: each reserves what it may cost before it is sent, and is settled after", async () => {
  // Code review, 16 Nov 2026 (B-M11): the allowance was only checked, from a figure up to 30 s old, so calls starting together each saw room for themselves.
  const CO = crypto.randomUUID(), CO_PORTAL = crypto.randomUUID();
  await db`insert into orgs (id, name, ai_monthly_cap_usd) values (${CO}, 'Batch company', 0.05)`;
  await db`insert into portals (id, org_id, name) values (${CO_PORTAL}, ${CO}, 'Batch portal')`;
  await db`insert into ai_usage (org_id, portal_id, purpose, provider, model, cost_micro_usd, outcome) values (${CO}, ${CO_PORTAL}, 'matching', 'anthropic', 'claude-sonnet-5-5', 30000, 'answered')`;   // $0.03 of $0.05 spent
  const { forPortal } = await import("../src/db");
  // Each answer costs $0.0054 (1,200 tokens in, 300 out) and takes a moment, so all ten calls are in flight together.
  seen = []; reply = (() => new Promise<Response>((done) => setTimeout(() => done(message("{}")()), 150))) as unknown as () => Response;
  const asked = await Promise.all(Array.from({ length: 10 }, () => forPortal(CO, CO_PORTAL, () => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching", maxTokens: 1000 }))));
  const answered = asked.filter((a) => a.ok).length;
  expect(answered).toBeGreaterThan(0);
  expect(seen).toHaveLength(answered);   // a call refused for the allowance is never sent
  const [{ m }] = await db`select coalesce(sum(cost_micro_usd), 0)::bigint as m from ai_usage where org_id = ${CO}`;
  expect(Number(m)).toBeLessThanOrEqual(50_000);   // the month ends at or under the allowance
  expect((await db`select count(*)::int as n from ai_usage where org_id = ${CO} and outcome = 'reserved'`)[0].n).toBe(0);   // every reservation settled
  expect((await db`select count(*)::int as n from ai_usage where org_id = ${CO} and outcome = 'answered'`)[0].n).toBe(answered + 1);
  reply = message("{}");
});

// Independent audit, 20 Nov 2026: the platform's budget was checked against a total re-read every 30 seconds and never reserved, so calls from several
// companies starting together could all pass it. It is now reserved call by call against the month's one row, as each company's allowance is.
test("calls from several companies starting together never take the platform past its budget, and the month's row always equals the usage rows", async () => {
  const { forPortal } = await import("../src/db"), cos = Array.from({ length: 4 }, () => ({ org: crypto.randomUUID(), portal: crypto.randomUUID() }));
  for (const c of cos) { await db`insert into orgs (id, name, ai_monthly_cap_usd) values (${c.org}, 'Platform test company', 100)`; await db`insert into portals (id, org_id, name) values (${c.portal}, ${c.org}, 'Platform test portal')`; }
  const total = async () => Number((await db`select coalesce(sum(cost_micro_usd), 0)::bigint as m from ai_usage where at >= sast_month_start()`)[0].m);
  const each = ai.mostItCanCost("claude-sonnet-5-5", 2, 1000), before = await total(), cap = before + each * 3.5;   // room for three calls' reservations, not four
  const was = process.env.AI_MONTHLY_CAP_USD; process.env.AI_MONTHLY_CAP_USD = String(cap / 1e6);
  try {
    seen = []; reply = (() => new Promise<Response>((done) => setTimeout(() => done(message("{}")()), 150))) as unknown as () => Response;
    const asked = await Promise.all(cos.flatMap((c) => Array.from({ length: 4 }, () => forPortal(c.org, c.portal, () => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching", maxTokens: 1000 })))));
    const answered = asked.filter((a) => a.ok).length;
    expect(answered).toBeGreaterThan(0);
    expect(seen).toHaveLength(answered);                                  // a call refused for the budget is never sent
    expect(await total()).toBeLessThanOrEqual(cap);                       // the month ends at or under the platform's budget
    expect(asked.some((a) => !a.ok && /platform's monthly AI budget/.test(a.detail))).toBe(true);
    const [row] = await db`select settled_micro, held_micro from ai_platform_month where month = sast_month_start()`;
    expect(Number(row.held_micro)).toBe(0);                               // every reservation settled
    expect(Number(row.settled_micro)).toBe(await total());                // kept by the database: always the sum of the rows
  } finally { process.env.AI_MONTHLY_CAP_USD = was; reply = message("{}"); }
});

test("a call that timed out or met a failure of the AI service is kept at the most it could have cost, as uncertain; one refused outright costs nothing", async () => {
  const { forPortal } = await import("../src/db"), CO = crypto.randomUUID(), CO_PORTAL = crypto.randomUUID();
  await db`insert into orgs (id, name, ai_monthly_cap_usd) values (${CO}, 'Uncertain company', 100)`;
  await db`insert into portals (id, org_id, name) values (${CO_PORTAL}, ${CO}, 'Uncertain portal')`;
  const ask = () => forPortal(CO, CO_PORTAL, () => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching", maxTokens: 1000 }));
  reply = () => Response.json({ type: "error", error: { type: "api_error", message: "overloaded" } }, { status: 529 });
  expect(await ask()).toMatchObject({ ok: false, why: "unavailable" });
  reply = () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "bad request" } }, { status: 400 });
  expect(await ask()).toMatchObject({ ok: false });
  const rows = await db`select outcome, cost_micro_usd from ai_usage where org_id = ${CO} order by at`;
  expect(rows.map((r: any) => r.outcome)).toEqual(["uncertain", "failed"]);
  expect(Number(rows[0].cost_micro_usd)).toBe(ai.mostItCanCost("claude-sonnet-5-5", 2, 1000));   // never counted as free
  expect(Number(rows[1].cost_micro_usd)).toBe(0);
  reply = message("{}");
});

test("once the month's spend reaches the cap, nothing more is sent, and the refusal is recorded", async () => {
  await db`insert into ai_usage (purpose, provider, model, cost_micro_usd, outcome) values ('evaluation', 'anthropic', 'claude-sonnet-5-5', 1000000, 'answered')`;   // $1, the cap in this test
  seen = []; reply = message("{}");
  expect(await inPortal(() => ai.askClaude({ system: "s", user: "u", schema: {}, purpose: "matching" }))).toMatchObject({ ok: false, why: "unavailable", detail: expect.stringContaining("monthly AI budget") });
  expect(seen).toHaveLength(0);
  expect((await db`select count(*)::int as n from ai_usage where outcome = 'refused' and org_id = ${ORG}`)[0].n).toBe(1);
});
