// Which of a pair's match results is THE result, everywhere it is shown (owner, 10 Nov 2026: "once someone is matched, that should always be the recorded
// scores and reasons, nothing should ever change"; 11 Nov 2026: the Overview showed 90 for a pair whose assessment opened on 86). The recorded match is
// the pair's first result the AI finished; failing that, the one it is still scoring; failing both (results from before the AI checked matches), the
// newest. One ordering, used by the assessment (index.ts), the Overview's strongest matches (orgOverview.ts), Needs attention (attention.ts) and the
// shortlist (applications.ts), so a pair shows the same score wherever it appears. Rows are read as "m" (from matches m).
import { sql } from "./db";

/** The ORDER BY that puts a pair's recorded match first: use after "order by m.candidate_id, m.job_id," with "distinct on (m.candidate_id, m.job_id)". */
export const recordedFirst = () => sql`(m.result->'ai'->>'state' = 'checked') desc nulls last, (m.result->'ai'->>'state' = 'pending') desc nulls last,
  case when m.result->'ai'->>'state' in ('checked', 'pending') then m.created_at end asc nulls last, m.created_at desc`;
