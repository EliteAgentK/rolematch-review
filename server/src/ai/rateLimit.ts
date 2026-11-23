// One speed limit for the whole platform's use of Claude, however many servers and workers ask at once (owner, 8 Nov 2026: 400 users in 1,000 portals,
// all reading and matching at the same time). RoleMatch has one Anthropic key, and Anthropic counts requests, input tokens and output tokens per minute per
// model. Every call first takes its place in this minute's count in the database (ai_rate), in one statement that succeeds only while the minute has room;
// when it has none, the call waits for the next minute. After the answer, the estimate is corrected to what Anthropic counted. Fairness between companies
// and portals is the queue's (queue.ts): this only keeps the platform as a whole inside the limit, so nobody's call is refused by Anthropic for speed.
import { platformSql as sql } from "../db";

export interface Limits { requests: number; inputTokens: number; outputTokens: number }
const num = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
/** 80% of the account's limits as Anthropic reported them on 8 Nov 2026 (1,000 requests, 500,000 input and 80,000 output tokens a minute, for both
 *  Sonnet 5.5 and Haiku 5.5), so other use of the key and the provider's own rounding never push a call over. Settings, so a higher tier needs no code. */
export const limitsFor = (model: string): Limits => {
  const key = /haiku/.test(model) ? "HAIKU" : "SONNET";
  return { requests: num(`AI_${key}_RPM`, 800), inputTokens: num(`AI_${key}_ITPM`, 400_000), outputTokens: num(`AI_${key}_OTPM`, 64_000) };
};
/** The longest a call waits for room before it is refused as busy (the caller then keeps the rules' result). */
const MAX_WAIT_MS = () => num("AI_RATE_MAX_WAIT_MS", 90_000);
const minuteOf = (t = Date.now()) => new Date(Math.floor(t / 60_000) * 60_000);

export interface Place { model: string; minute: Date; inputTokens: number; outputTokens: number }
/** Takes room in the current minute for one call, waiting for a later minute while this one is full. Null if no room came within the wait. */
export async function takePlace(model: string, inputTokens: number, outputTokens: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Place | null> {
  const lim = limitsFor(model), until = Date.now() + MAX_WAIT_MS();
  // A single call bigger than a whole minute's allowance is counted as the allowance, so it waits for an empty minute rather than for ever.
  const inTok = Math.min(inputTokens, lim.inputTokens), outTok = Math.min(outputTokens, lim.outputTokens);
  for (;;) {
    const minute = minuteOf();
    const rows = await sql`insert into ai_rate (model, minute, requests, input_tokens, output_tokens) values (${model}, ${minute}, 1, ${inTok}, ${outTok})
      on conflict (model, minute) do update set requests = ai_rate.requests + 1, input_tokens = ai_rate.input_tokens + excluded.input_tokens, output_tokens = ai_rate.output_tokens + excluded.output_tokens
      where ai_rate.requests + 1 <= ${lim.requests} and ai_rate.input_tokens + excluded.input_tokens <= ${lim.inputTokens} and ai_rate.output_tokens + excluded.output_tokens <= ${lim.outputTokens}
      returning minute`;
    if (rows.length) return { model, minute, inputTokens: inTok, outputTokens: outTok };
    const next = minute.getTime() + 60_000;
    if (next > until) return null;
    // Everyone who found the minute full wakes at once otherwise: a little spread keeps the first seconds of the next minute from a stampede.
    await sleep(next - Date.now() + Math.floor(Math.random() * 2_000));
  }
}
/** What Anthropic actually counted replaces the estimate, so a minute's count is true for the calls that follow. Never fails the caller. */
export async function settlePlace(p: Place, actual: { inputTokens: number; outputTokens: number }) {
  await sql`update ai_rate set input_tokens = greatest(0, input_tokens + ${actual.inputTokens - p.inputTokens}), output_tokens = greatest(0, output_tokens + ${actual.outputTokens - p.outputTokens})
    where model = ${p.model} and minute = ${p.minute}`.catch(() => {});
}
/** Old minutes are of no use to anyone: kept for a day for the console, then dropped. */
export const forgetOldMinutes = () => sql`delete from ai_rate where minute < now() - interval '1 day'`.catch(() => {});
