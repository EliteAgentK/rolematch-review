// What one AI call gives back, whatever asked it: a JSON answer, or a refusal with its reason. Readers and matchers take this shape and never see the provider.

/** What one call cost, as the provider counted it: tokens only, never text. */
export interface ModelCost { promptTokens: number; outTokens: number; loadMs: number; readMs: number; writeMs: number }
export interface ModelAnswer { ok: true; json: unknown; raw: string; ms: number; model: string; cost?: ModelCost }
export interface ModelRefusal { ok: false; why: "empty" | "looping" | "truncated" | "malformed" | "timeout" | "unavailable" | "too_long"; detail: string; ms: number; model: string; cost?: ModelCost }
/** Two costs added up; with nothing given, a cost of zero to start from. */
export const addCost = (a?: ModelCost, b?: ModelCost): ModelCost => ({ promptTokens: (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0), outTokens: (a?.outTokens ?? 0) + (b?.outTokens ?? 0), loadMs: (a?.loadMs ?? 0) + (b?.loadMs ?? 0), readMs: (a?.readMs ?? 0) + (b?.readMs ?? 0), writeMs: (a?.writeMs ?? 0) + (b?.writeMs ?? 0) });
