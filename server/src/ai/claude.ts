// Claude as RoleMatch's outside AI service (owner, 8 Nov 2026: "let's go with Sonnet"; the AI matters more for matching than for extraction).
// Claude Sonnet 5.5 judges matches; Claude Haiku 5.5 reads every CV with the parser (owner, 8 Nov: "no more Ollama"). Every call passes these guards, in order:
//   1. It belongs to one portal: work for a company is refused outside its portal's scope (db.ts forPortal), so every call is billed to the portal it was for.
//   2. Personal identifiers are masked before anything leaves the PC (e-mail, phone, ID numbers, links, and any names the caller gives).
//   3. The platform's monthly safety cap (AI_MONTHLY_CAP_USD, default 25) is checked, then the company's own monthly allowance (orgs.ai_monthly_cap_usd,
//      or AI_ORG_MONTHLY_CAP_USD, default 5) is reserved: the most the call can cost is written down under a lock before it is sent, so calls starting
//      together can never take a company past its allowance (code review, 16 Nov 2026, B-M11). Over either, nothing is sent.
//   4. The call takes its place in the platform's shared per-minute limit (rateLimit.ts), so all servers together stay inside Anthropic's limits.
//   5. It is metered in ai_usage against the organisation's billing account and the portal (tokens as Anthropic counted them, and the cost); never text.
//      A company's call settles its own reservation with what it really cost.
// Each question carries one document of one portal and nothing else: Anthropic's API keeps no conversation between calls, so nothing of one portal can reach
// another's answer. The fixed instructions are marked for Anthropic's prompt cache (the same for every portal, and no tenant data), which makes repeats cheaper and faster.
// The key is ANTHROPIC_API_KEY, read from the environment (on the PC: /etc/rolematch/ai.env, root-only); it is never logged or returned.
import Anthropic from "@anthropic-ai/sdk";
import { currentOrg, currentPortal, platformSql as sql } from "../db";
import { sastMonthStart } from "../sast";
import type { ModelAnswer, ModelRefusal } from "./answer";
import { settlePlace, takePlace } from "./rateLimit";

export const MATCH_MODEL = process.env.AI_MATCH_MODEL ?? "claude-sonnet-5-5";
export const READ_MODEL = process.env.AI_READ_MODEL ?? "claude-haiku-5-5";
export const capUsd = () => Number(process.env.AI_MONTHLY_CAP_USD ?? 25);
// US dollars per million tokens, input and output: Anthropic's published first-party prices (8 Nov 2026). A token count times these is millionths of a dollar.
// Input read from the prompt cache costs a tenth of input; input written to it (five-minute cache) a quarter more.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5-5": { in: 2, out: 10 }, "claude-haiku-5-5": { in: 0.1, out: 0.5 }, "claude-opus-5-5": { in: 4, out: 20 }, "claude-sonnet-4-6": { in: 3, out: 15 },
};
// Only these models take the server-side refusal fallback (Haiku has none).
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);
/** Whether AI work can be done on this platform. Only the AI worker holds the key (least privilege); the API and the document worker are told that it has one
 *  (AI_KEY_IN_AI_WORKER=1), so they queue work for it, and never hold the key themselves. */
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY || process.env.AI_KEY_IN_AI_WORKER === "1";
const keyHere = () => !!process.env.ANTHROPIC_API_KEY;

/** Personal identifiers out of a text before it leaves the PC. Names are the caller's to give (the parser knows them); every other kind is found here. */
export function maskPersonal(text: string, names: string[] = [], keepContact = false): string {
  // A CV's reading is asked for the person's own name, e-mail and phone (cvReader.ts; owner, 10 Nov 2026: "why does it matter if the person's details get
  // read by Claude, that's the whole point"), so those go as written. An identity number is never asked for and never held, so it is always masked.
  if (keepContact) return text.replace(/\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{7}\b/g, "[id number]");
  let t = text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github)\.com\/\S*/gi, "[link]")
    .replace(/\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{7}\b/g, "[id number]")   // a South African identity number: YYMMDD and seven digits
    .replace(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3}[\s.-]?\d{3,4}\b/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m));
  for (const n of names.map((x) => x.trim()).filter((x) => x.length >= 3)) {
    const parts = n.split(/\s+/).filter((p) => p.length >= 3).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (parts.length) t = t.replace(new RegExp(`\\b(?:${parts.join("|")})\\b`, "gi"), "[name]");
  }
  return t;
}

/** Structured outputs take a subset of JSON Schema: length and count limits are dropped here (code checks every answer afterwards anyway), and every object
 *  is closed with all its properties required. */
export function strictSchema(s: any): any {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (!s || typeof s !== "object") return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) if (!["maxLength", "minLength", "maxItems", "minItems", "pattern", "format", "minimum", "maximum"].includes(k)) out[k] = strictSchema(v);
  if (out.type === "object" && out.properties) { out.additionalProperties = false; out.required = Object.keys(out.properties); }
  return out;
}

export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
export const microUsd = (model: string, t: Tokens) => { const p = PRICES[model] ?? PRICES[MATCH_MODEL] ?? { in: 2, out: 10 }; return Math.round(t.input * p.in + t.cacheRead * p.in * 0.1 + t.cacheWrite * p.in * 1.25 + t.output * p.out); };
export async function spentThisMonthUsd(): Promise<number> {
  const [r] = await sql`select coalesce(sum(cost_micro_usd), 0)::bigint as m from ai_usage where at >= ${sastMonthStart()}`;   // Johannesburg's month (code review, 16 Nov 2026, C-M5)
  return Number(r.m) / 1e6;
}
/** The platform's spend this month, settled and held, from its one row (066_ai_platform_month.sql: kept by the database on every write to ai_usage). */
const platformMonth = async () => { const [r] = await sql`select settled_micro, held_micro from ai_platform_month where month = ${sastMonthStart()}`; return { settled: Number(r?.settled_micro ?? 0), held: Number(r?.held_micro ?? 0) }; };
/** A company's own monthly allowance (supabase/migrations/047_org_ai_allowance.sql): its own figure, or the platform's for a company (AI_ORG_MONTHLY_CAP_USD,
 *  5 dollars unless set). Held exactly, call by call, by reserve() below. */
export const orgCapUsd = () => Number(process.env.AI_ORG_MONTHLY_CAP_USD ?? 5);
const NONE: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
type Outcome = "answered" | "refused" | "failed" | "uncertain";
/** What a call cost: from its tokens, or, for one that may have been charged without saying what for (uncertain), the most it could have cost. */
const costOf = (o: { model: string; tokens: Tokens; outcome: Outcome; most?: number }) => (o.outcome === "uncertain" ? (o.most ?? 0) : microUsd(o.model, o.tokens));
async function meter(o: { purpose: string; model: string; tokens: Tokens; outcome: Outcome; most?: number }) {
  const cost = costOf(o);
  await sql`insert into ai_usage (org_id, portal_id, account_id, purpose, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome)
    values (${currentOrg()}, ${currentPortal()}, (select id from billing_accounts where org_id = ${currentOrg()}), ${o.purpose}, 'anthropic', ${o.model}, ${o.tokens.input}, ${o.tokens.output}, ${o.tokens.cacheRead}, ${o.tokens.cacheWrite}, ${cost}, ${o.outcome})`.catch((e) =>
    console.error(JSON.stringify({ level: "warn", event: "ai_usage.not_recorded", reason: String(e?.message ?? e).slice(0, 120) })));
}

/** The most a call can cost: its text at three characters a token (English runs nearer four), all written to the cache, which is input's dearest rate,
 *  and every output token it may write. A company is held to this until the call answers, so its month can never end above its allowance. */
export const mostItCanCost = (model: string, inputChars: number, maxTokens: number) => microUsd(model, { input: 0, output: maxTokens, cacheRead: 0, cacheWrite: Math.ceil(inputChars / 3) });
// A reservation older than this belongs to a call that never came back (the longest call, 300 s, tried three times, is 15 minutes): it counts as spent.
const RESERVATION_LIFE = "20 minutes";
type Reservation = { ok: true; id: string } | { ok: false; cap: number; waited: boolean; platform?: true };
/** Writes down what the call may cost against the company's allowance and the platform's budget, under the company's lock and then the platform month's
 *  row lock (always in that order), so two calls never both take the last of either. When the room is held only by calls still running, it waits for
 *  them to settle (up to AI_RESERVE_WAIT_MS) rather than refuse work that will fit. */
async function reserve(org: string, portal: string | null, purpose: string, model: string, micro: number): Promise<Reservation> {
  const until = Date.now() + Number(process.env.AI_RESERVE_WAIT_MS ?? 120_000);
  for (;;) {
    const r = await sql.begin(async (q): Promise<Reservation | { wait: number }> => {
      await q`select pg_advisory_xact_lock(hashtextextended(${"ai-allowance:" + org}, 0))`;
      const [s] = await q`select coalesce(sum(cost_micro_usd) filter (where outcome <> 'reserved' or at < now() - ${RESERVATION_LIFE}::interval), 0)::bigint as settled,
          coalesce(sum(cost_micro_usd) filter (where outcome = 'reserved' and at >= now() - ${RESERVATION_LIFE}::interval), 0)::bigint as held,
          (select ai_monthly_cap_usd from orgs where id = ${org}) as cap
        from ai_usage where org_id = ${org} and at >= ${sastMonthStart()}`;   // the allowance's month is Johannesburg's (code review, 16 Nov 2026, C-M5)
      const cap = Math.round((s.cap == null ? orgCapUsd() : Number(s.cap)) * 1e6);
      if (Number(s.settled) + micro > cap) return { ok: false, cap: cap / 1e6, waited: false } as const;
      if (Number(s.settled) + Number(s.held) + micro > cap) return { wait: cap / 1e6 } as const;
      // The platform's budget, held the same way: this month's row is locked until the reservation below is written into it (by the trigger).
      await q`insert into ai_platform_month (month) values (${sastMonthStart()}) on conflict (month) do nothing`;
      const [p] = await q`select settled_micro, held_micro from ai_platform_month where month = ${sastMonthStart()} for update`, platformCap = Math.round(capUsd() * 1e6);
      if (Number(p.settled_micro) + micro > platformCap) return { ok: false, cap: capUsd(), waited: false, platform: true } as const;
      if (Number(p.settled_micro) + Number(p.held_micro) + micro > platformCap) return { wait: capUsd(), platform: true } as const;
      const [row] = await q`insert into ai_usage (org_id, portal_id, account_id, purpose, provider, model, cost_micro_usd, outcome)
        values (${org}, ${portal}, (select id from billing_accounts where org_id = ${org}), ${purpose}, 'anthropic', ${model}, ${micro}, 'reserved') returning id`;
      return { ok: true, id: String(row.id) } as const;
    });
    if (!("wait" in r)) return r;
    if (Date.now() > until) return { ok: false, cap: r.wait, waited: true, ...("platform" in r ? { platform: true as const } : {}) };
    await new Promise((done) => setTimeout(done, 500));
  }
}
/** Replaces a reservation with what the call really cost. If that cannot be written, the reservation stands: a company is never charged less than it used. */
async function settle(id: string, o: { model: string; tokens: Tokens; outcome: Outcome; most?: number }) {
  const cost = costOf(o);
  await sql`update ai_usage set model = ${o.model}, input_tokens = ${o.tokens.input}, output_tokens = ${o.tokens.output}, cache_read_tokens = ${o.tokens.cacheRead},
      cache_write_tokens = ${o.tokens.cacheWrite}, cost_micro_usd = ${cost}, outcome = ${o.outcome}, at = now() where id = ${id} and outcome = 'reserved'`.catch((e) =>
    console.error(JSON.stringify({ level: "warn", event: "ai_usage.not_settled", reason: String(e?.message ?? e).slice(0, 120), note: "the reservation stands as the call's cost" })));
}

let client: Anthropic | null = null;
// Only RoleMatch's own key, given explicitly: never another credential the machine happens to hold (a login profile or an auth token).
const claude = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, authToken: null, maxRetries: Number(process.env.AI_MAX_RETRIES ?? 2), timeout: 120_000 }));

export interface ClaudeCall { system: string; user: string; schema: object; model?: string; effort?: "low" | "medium" | "high"; /** reading facts off a page needs no deliberation: Haiku answers without thinking first (Sonnet always thinks) */ think?: boolean; maxTokens?: number; timeoutMs?: number; names?: string[]; /** the person's own contact details go as written (a CV's reading); identity numbers are still masked */ keepContact?: boolean; purpose: "extraction" | "matching" | "evaluation"; /** what the answer is expected to take, for the shared limit before Anthropic has counted it */ expectOutTokens?: number }
/** Roughly how many tokens a text is, before Anthropic has counted it: about four characters each in English. */
const tokensIn = (s: string) => Math.ceil(s.length / 4);
/** One question to Claude, answered as JSON in the given schema, or refused with a reason. Never throws. */
export async function askClaude(o: ClaudeCall): Promise<ModelAnswer | ModelRefusal> {
  const t0 = performance.now(), model = o.model ?? MATCH_MODEL;
  const refuse = (why: ModelRefusal["why"], detail: string, cost?: ModelAnswer["cost"]): ModelRefusal => ({ ok: false, why, detail, ms: performance.now() - t0, model, cost });
  if (!keyHere()) return refuse("unavailable", "no AI key is configured");
  // Work for a company is always one portal's: outside a portal it would be billed to nobody, so it is not sent at all. Only platform evaluation runs without one.
  if (o.purpose !== "evaluation" && (!currentOrg() || !currentPortal())) return refuse("unavailable", "AI work must belong to a portal");
  // Work for no company (platform evaluation) is checked here; a company's call is also reserved against the budget, exactly, in reserve() below.
  const month = await platformMonth().catch(() => null);
  if (!month) return refuse("unavailable", "the platform's AI budget could not be read");
  if (month.settled + month.held >= capUsd() * 1e6) { await meter({ purpose: o.purpose, model, tokens: NONE, outcome: "refused" }); return refuse("unavailable", `the platform's monthly AI budget of $${capUsd()} is used up`); }
  const user = maskPersonal(o.user, o.names, o.keepContact), most = mostItCanCost(model, o.system.length + user.length, o.maxTokens ?? 16000);
  // Each company stops at its own allowance too, so no one company can use up the month for the others (owner, 12 Nov 2026). Evaluation runs belong to no company.
  const org = currentOrg();
  let held: string | null = null;
  if (org) {
    const r = await reserve(org, currentPortal(), o.purpose, model, most);
    if (!r.ok) {
      await meter({ purpose: o.purpose, model, tokens: NONE, outcome: "refused" });
      const whose = r.platform ? `the platform's monthly AI budget of $${r.cap}` : `this company's monthly AI allowance of $${r.cap}`;
      return refuse("unavailable", r.waited ? `${whose} is nearly used up: the AI work already running takes the rest` : `${whose} is used up`);
    }
    held = r.id;
  }
  // What the call cost, written once: settling the company's reservation, or a row of its own for work that belongs to no company.
  const record = (x: { model: string; tokens: Tokens; outcome: Outcome }) => held ? settle(held, { ...x, most }) : meter({ purpose: o.purpose, ...x, most });
  // A count that cannot be kept (the database did not answer) is not a full minute: it is said as what it is (9 Nov 2026, a measurement read
  // "speed limit" for 13 of 54 questions while the counts stood far below the limits and the database was busy with a test run).
  let countFailed = false;
  const place = await takePlace(model, tokensIn(o.system) + tokensIn(user), o.expectOutTokens ?? 2_000).catch(() => { countFailed = true; return null; });
  if (!place) { await record({ model, tokens: NONE, outcome: "refused" }); return refuse("unavailable", countFailed ? "the AI's shared speed count could not be reached" : "the AI is at its speed limit"); }
  const fallback = FALLBACK_MODELS.has(model);
  let msg: any;
  try {
    msg = await claude().beta.messages.create({
      model, max_tokens: o.maxTokens ?? 16000,
      // The fixed instructions first and marked for the prompt cache: identical for every document of every portal, so after the first call they are read from the cache.
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: o.effort ?? "medium", format: { type: "json_schema", schema: strictSchema(o.schema) } },
      ...(o.think === false && /haiku/.test(model) ? { thinking: { type: "disabled" } } : {}),
      // A request a safety check declines is re-run by the server on a model that can answer it (owner told, 8 Nov). Haiku has no fallback.
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as any, { timeout: o.timeoutMs ?? 120_000 });
  } catch (e: any) {
    // A request refused before it was taken (too long, no credit, the speed limit, a bad key) cost nothing. One that timed out, lost its connection or met a
    // failure of the AI service itself may have been worked on and charged: it is kept at the most it could have cost, as uncertain, never as free.
    const mayHaveCost = e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && Number(e.status ?? 0) >= 500) || !(e instanceof Anthropic.APIError);
    await record({ model, tokens: NONE, outcome: mayHaveCost ? "uncertain" : "failed" });
    await settlePlace(place, { inputTokens: 0, outputTokens: 0 });
    if (e instanceof Anthropic.APIConnectionTimeoutError) return refuse("timeout", "The AI did not answer in time");
    if (e instanceof Anthropic.BadRequestError && /too long|context|maximum/i.test(String(e.message))) return refuse("too_long", "the question is longer than the model takes");
    if (e instanceof Anthropic.APIError && /credit balance/i.test(String(e.message))) return refuse("unavailable", "the AI's credit is used up");
    if (e instanceof Anthropic.APIError) return refuse("unavailable", `The AI answered ${e.status ?? "with an error"}`);
    return refuse("unavailable", "The AI could not be reached");
  }
  const u = msg?.usage ?? {}, tokens: Tokens = { input: Number(u.input_tokens ?? 0), output: Number(u.output_tokens ?? 0), cacheRead: Number(u.cache_read_input_tokens ?? 0), cacheWrite: Number(u.cache_creation_input_tokens ?? 0) };
  const served = String(msg?.model ?? model), raw = (msg?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const cost = { promptTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite, outTokens: tokens.output, loadMs: 0, readMs: 0, writeMs: 0 };
  // Input read from the cache does not count against Anthropic's per-minute input limit, so the shared count does not keep it either.
  await settlePlace(place, { inputTokens: tokens.input + tokens.cacheWrite, outputTokens: tokens.output });
  await record({ model: served, tokens, outcome: msg?.stop_reason === "refusal" || !raw.trim() ? "failed" : "answered" });
  if (msg?.stop_reason === "refusal") return refuse("unavailable", "the request was declined", cost);
  if (msg?.stop_reason === "max_tokens") return refuse("truncated", "the answer was cut off", cost);
  if (!raw.trim()) return refuse("empty", "The AI returned nothing", cost);
  try { return { ok: true, json: JSON.parse(raw), raw, ms: performance.now() - t0, model: served, cost }; } catch { return refuse("malformed", "the answer is not valid JSON", cost); }
}
