// The version of the reading behaviour (parser, OCR clean-up, layout, qualifications). It changes ONLY when the output for the same document changes.
// A frozen set of expected outputs (test/golden) is checked against it: change what the reader produces without bumping this and the tests fail;
// bump it and the tests make you review and re-freeze the new outputs. That is how the reader is kept from drifting by accident.
export const PARSER_VERSION = "2.16.0";   // 2.16.0 (16 Nov 2026): a role counts every month it covers; part-time and a certificate's "current" no longer mean unfinished (code review C-H1, C-H3)
// 2.15.0 (10 Nov 2026): job descriptions are read by Claude (src/jobReader.ts); the job reading rules and their frozen outputs are removed

/** What the candidate pipeline (src/candidatePipeline.ts) adds to the version label of whatever it reads, so its records can never be mistaken for the default's. */
export const CANDIDATE_PIPELINE_VERSION = "candidate-7";
export function parserVersionLabel(): string {
  return PARSER_VERSION;
}
