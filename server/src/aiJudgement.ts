// What an AI judgement of one match line is, shared by the matcher (match.ts) and the AI matcher (aiMatch.ts) without either importing the other.
import type { EvidenceState } from "./types";

/** The key a role-fit judgement is held under (the role row has no requirement text of its own). */
export const ROLE_KEY = "__role__";
export interface AiJudgement { state: EvidenceState; modelState: string; rationale: string; quotes: string[]; model: string }
export type AiJudgements = Record<string, AiJudgement>;
