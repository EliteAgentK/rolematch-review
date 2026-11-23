import { useEffect, useState } from "react";
import { Box } from "@chakra-ui/react";
import { api, ApiError, selectedPortal, type MatchResult } from "../api/client";
import type { Candidate, Job } from "../types/records";
import { NOT_SUITABLE } from "../utils/stages";
import CandidateMatchPanel from "./CandidateMatchPanel";
import AssessmentDialog from "./AssessmentDialog";
import { PanelText } from "./ui/panel";
import { SPACE } from "../config/panels";

type Loaded = { candidate: Candidate; job: Job; result: MatchResult };
// Saved assessments, kept in this page once fetched (owner, 11 Nov 2026: "it must be immediate ... no more than a quick 2 second loading screen, these
// are saved records"). The Overview asks for its strongest matches' assessments as soon as it has them, so a click finds them here at once. A recorded
// match never changes (recordedMatch, server/src/index.ts); the candidate and job are fetched again after five minutes.
const kept = new Map<string, { at: number; p: Promise<Loaded> }>(), KEEP_MS = 5 * 60_000;
let role: Promise<boolean> | null = null;   // whether this person only views, asked once per page
const viewOnlyHere = () => (role ??= api.portals().then((ps) => (ps.find((x) => x.id === selectedPortal()) ?? ps[0])?.role === "hiring_manager").catch(() => { role = null; return true; }));
/** Starts fetching a pair's saved assessment, or returns the fetch already made. A failed fetch is not kept. */
export function prefetchAssessment(pair: { candidateId: string; jobId: string }): Promise<Loaded> {
  const key = `${pair.candidateId}|${pair.jobId}`, have = kept.get(key);
  if (have && Date.now() - have.at < KEEP_MS) return have.p;
  const p = Promise.all([api.getCandidate(pair.candidateId), api.getJob(pair.jobId), api.savedMatch(pair.candidateId, pair.jobId)]).then(([candidate, job, result]) => ({ candidate, job, result }));
  kept.set(key, { at: Date.now(), p }); p.catch(() => kept.delete(key)); void viewOnlyHere();
  return p;
}

/** One pair's saved assessment, opened where the person is (owner, 10 and 11 Nov 2026, asked three times: a strongest match "was supposed to take you to
 *  that page of the details of the applicant and job alignment, not to the board"). The same panel the Matching Board shows; nothing is matched again.
 *  Shortlist and Not suitable are saved from here as on the board, for this job only. The board is one click away, never the first stop. */
export default function SavedAssessmentDialog({ pair, onClose, onBoard }: { pair: { candidateId: string; jobId: string } | null; onClose: () => void; onBoard: () => void }) {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState(""), [saved, setSaved] = useState(""), [viewOnly, setViewOnly] = useState(true);
  // A hiring manager reads the assessment and decides nothing here, as on the board (hiringManager.ts): until the portal's role is known, no buttons.
  useEffect(() => { if (pair) void viewOnlyHere().then(setViewOnly); }, [pair]);
  useEffect(() => {
    setState(null); setError(""); setSaved("");
    if (!pair) return;
    let live = true;
    prefetchAssessment(pair)
      .then((loaded) => { if (live) setState(loaded); })
      .catch((e) => { if (live) setError(e instanceof ApiError && e.status === 404 ? "This assessment is not in this portal any more. The candidate or the job may have been deleted." : e instanceof ApiError ? e.message : "The assessment could not be loaded. Try again in a moment."); });
    return () => { live = false; };
  }, [pair?.candidateId, pair?.jobId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action: "shortlist" | "request-information" | "review-cv" | "not-suitable") => {
    if (!state || (action !== "shortlist" && action !== "not-suitable")) return;
    try {
      await api.setApplication(state.candidate.id, state.job.id, action === "shortlist" ? "shortlisted" : NOT_SUITABLE);
      setSaved(action === "shortlist" ? `${state.candidate.name} shortlisted for ${state.job.title}.` : `${state.candidate.name} marked not suitable for ${state.job.title}.`);
    } catch (e) { setSaved(e instanceof ApiError ? `Not saved: ${e.message}` : "Not saved: the server could not be reached."); }
  };

  return (
    <AssessmentDialog open={!!pair} onClose={onClose} who={state?.candidate.name} what={state?.job.title} extraAction={{ label: "Open on the Matching Board", onClick: onBoard }} testId="saved-assessment">
      {state ? <CandidateMatchPanel candidate={state.candidate} job={state.job} result={state.result} onAction={viewOnly ? undefined : act} />
        : error ? <PanelText>{error}</PanelText>
        : <Box py={SPACE.xxl} textAlign="center"><PanelText muted>Opening the saved assessment…</PanelText></Box>}
      {saved && <Box mt={SPACE.lg} role="status"><PanelText strong>{saved} Recorded as your decision for this job only, separately from the assessment.</PanelText></Box>}
    </AssessmentDialog>
  );
}
