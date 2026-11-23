import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Box, 
  Container, 
  Grid, 
  Stack, 
  Text, 
  VStack, 
  Flex,
  chakra,
  Dialog,
  Portal,
  useDisclosure,
  Input,
  HStack,
  HoverCard,
  Alert,
} from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { AlertIcon, AlertRoot } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { CloseButton } from "../components/ui/close-button";
import { InputGroup } from "../components/ui/input-group";
import { toaster } from "../components/ui/toaster";
import { ARROW_GUTTER } from "../components/ui/tooltip";

import CandidateCard from "../components/CandidateCard";
import JobCard from "../components/JobCard";
import CenterPanel from "../components/CenterPanel";
import DashboardNavbar from "../components/DashboardNavbar";
import DropZone from "../components/DropZone";
import CandidateMatchPanel from "../components/CandidateMatchPanel";
import AssessmentDialog from "../components/AssessmentDialog";
import { inReviewOrder } from "../utils/reviewOrder";
import MatchShortlistZone from "../components/MatchShortlistZone";
import { waitForScores } from "../components/AiCheck";
import { startSending, stopSending, useSendings } from "../utils/backgroundSends";
import MatchProgressOverlay, { failedRunNote, type ProgressState } from "../components/MatchProgressOverlay";
import WelcomeBackBar from "../components/WelcomeBackBar";
import { useSettings } from "../settings/SettingsContext";
import { describeFailures } from "../utils/uploadFailures";
import ShortlistResults from "../components/ShortlistResults";
import GettingStartedModal from "../components/GettingStartedModal";
import { api, ApiError, listCapped, selectedPortal, selectPortal } from "../api/client";
import type { Application, BatchReport, BatchView, Capacity, MatchResult, PendingDocument } from "../api/client";
import BrandLoader from "../components/BrandLoader";
import { arrivingBoard, forgetAll, keepBoard, keepFor, keptBoard, keptFor } from "../utils/warm";
import { displayCase } from "../utils/displayCase";
import MatchChooser from "../components/MatchChooser";
import { BulkBar, ConfirmBulkDelete, Pickable } from "../components/BulkDelete";
import { NOT_SUITABLE, onShortlist, shortlistedFor, StagesContext, jobsHolding } from "../utils/stages";
import BatchPanel from "../components/BatchPanel";
import { FilterSelect } from "../components/FilterSelect";
import { shortDate } from "../utils/shortDate";
import { revealTopToBottom } from "../utils/reveal";
import { pauseUntilOnline } from "../utils/wake";
import { requestOrder } from "../utils/requestOrder";
import { whatBecameOf } from "../utils/vanishedDocuments";
import { boardAccess, type PortalChoice } from "../utils/portalRole";
import CapacityBar from "../components/CapacityBar";
import BatchSummaryDialog from "../components/BatchSummaryDialog";
import { batchCompletedLine, reportCsv } from "../utils/batchReport";
import { chooseFiles, FILE_UNREADABLE, sendBatch } from "../utils/batchUpload";
import type { Candidate, Job } from "../types/records";
import DocumentProcessingCard from "../components/DocumentProcessingCard";
import { useChangeReason } from "../components/ChangeReasonDialog";
import { rolematchConfig } from "../config/rolematch.config";
import { SearchIcon, QuestionIcon } from "../components/ui/icons";
import { FOCUS_PARAMS, parseFocus } from "../utils/boardIntent";
const CAPACITY_MS = 15_000;   // while nothing is moving; experiment X4

// In the four-column board a list or panel takes the height its column gives it and scrolls inside, instead of making the row as tall as everything in it
// (CSS size containment: what it holds does not count towards the row's height).
export const FILLS_COLUMN = { "@media (min-width: 80em)": { contain: "size" } } as const;

interface FilterState {
  location: string;
  skills: string[];
  searchTerm: string;
  status?: string; // For candidates
  department?: string; // the standard department, for jobs and candidates alike
}

// The board as it was last shown, kept while the page is open (owner, 9 Nov 2026: back from Settings the loading screen stayed for ages; "as soon as everything
// appears the loading screen needs to go, it is just the placeholder for loading"). Coming back, the board shows at once from this and refreshes quietly.
// It belongs to one person and one portal: anyone else or another portal starts from nothing, with the loading screen; signing out and switching portal
// reload the page, which drops it.
// The board's records are kept for the tab (src/utils/warm.ts) for one person in one portal: signing in and the Overview fetch them ahead, so the
// board opens on them at once and refreshes behind (owner, 10 Nov 2026: "a whole new loading screen came up, once you're in it should be easy toggling").
const shownBefore = () => keptBoard();

/** Whether the server answers at all (any answer, even a refusal): after an upload failed with no answer, this tells a lost connection from a file the
 *  browser could not send (code review, 16 Nov 2026, G-M4). The browser saying it is offline settles it without asking. */
const serverReachable = () => (typeof navigator !== "undefined" && navigator.onLine === false ? Promise.resolve(false)
  : api.capacity().then(() => true, (e) => e instanceof ApiError && e.status > 0));

/** In place of the upload boxes when the board offers no changes: a hiring manager's read-only view, or a role not known yet (code review, 16 Nov 2026, E-M4). */
export function AccessNotice({ access, onRetry }: { access: "view" | "unknown" | "change"; onRetry: () => void }) {
  if (access === "view") return <Text fontSize="sm" color="fg.muted" p={3} borderWidth="1px" borderRadius="lg">Read-only: you see shortlisted candidates and roles. Recruiters add and change them.</Text>;
  return (
    <Flex role="status" align="center" justify="space-between" gap={3} wrap="wrap" p={3} borderWidth="1px" borderRadius="lg" data-testid="role-unknown">
      <Text fontSize="sm" color="fg.muted">Checking your role in this portal. Until it is confirmed, uploads and changes are not offered here.</Text>
      <Button size="sm" variant="outline" onClick={onRetry}>Check again</Button>
    </Flex>
  );
}

/** Said above a list that stopped at the client's safety cap, so nobody takes the first 5,000 for everything (code review, 16 Nov 2026, E-M10). */
export function ListCapNotice({ cap, noun }: { cap: { shown: number; total: number }; noun: string }) {
  const n = (x: number) => x.toLocaleString("en-US");
  return <Text role="status" fontSize="sm" color="fg.muted" data-testid="list-cap">Only the newest {n(cap.shown)} of {n(cap.total)} {noun} are loaded on this board. Search, filters, Select all and Match all cover these {n(cap.shown)} only.</Text>;
}

const Dashboard = () => {
  const settingsCtx = useSettings();
  const orgLabel = settingsCtx.orgLabel, cardBg = useColorModeValue("white", "gray.800");
  const { nouns } = settingsCtx;
  const bgPage = useColorModeValue("gray.50", "gray.900");
  const focusBg = useColorModeValue("rgba(23,195,178,0.08)", "rgba(23,195,178,0.10)");   // the Overview's "Showing" pill
  // The same ground as the Overview (owner, 10 Nov 2026: "the same kind of colours in the matching board"): the page colour with a soft cerulean and teal glow.
  const boardGlow = useColorModeValue("radial-gradient(1200px 600px at 80% -10%, rgba(23,195,178,0.05), transparent 60%), radial-gradient(900px 520px at 5% 0%, rgba(58,168,209,0.07), transparent 60%)", "radial-gradient(1200px 600px at 80% -10%, rgba(23,195,178,0.09), transparent 60%), radial-gradient(900px 520px at 5% 0%, rgba(58,168,209,0.12), transparent 60%)");
  const { open: isOpen, onOpen, onClose } = useDisclosure();
  const { 
    open: isShortlistOpen, 
    onOpen: onShortlistOpen, 
    onClose: onShortlistClose 
  } = useDisclosure();
  const {
    open: isTutorialOpen,
    onOpen: onTutorialOpen,
    onClose: onTutorialClose
  } = useDisclosure(); // the tour opens by itself only right after sign-up (below); the ? button opens it any time

  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(() => !!shownBefore());
  const [welcomeBack, setWelcomeBack] = useState<string | null>(null);
  const [candidateRecords, setCandidateRecords] = useState<Candidate[]>(() => shownBefore()?.cands ?? []);
  const [jobRecords, setJobRecords] = useState<Job[]>(() => shownBefore()?.jobs ?? []);
  const rereading = candidateRecords.filter((c) => c.rereading).length;   // CVs the AI is reading again: their cards are locked and uploads pause
  const rereadingJobs = jobRecords.filter((j) => j.rereading).length;    // jobs the same: the same waiting rules as CVs (PLAN_JOBS_READ_BY_AI.md)
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const [dismissedDocs, setDismissedDocs] = useState<string[]>([]);
  const knownDocs = useRef<Set<string>>(new Set());
  const docBatch = useRef<Map<string, string | null>>(new Map());   // the batch each document in the last list belonged to (E-M7)
  
  // For the match modal
  const [matchedCandidate, setMatchedCandidate] = useState<Candidate | null>(null);
  const [matchedJob, setMatchedJob] = useState<Job | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  
  // For shortlist results
  const [shortlistResults, setShortlistResults] = useState<Array<{
    candidate: Candidate;
    job: Job;
    matchResult: MatchResult;
  }>>([]);
  const [shortlistType, setShortlistType] = useState<"candidate-to-jobs" | "job-to-candidates">("candidate-to-jobs");
  // A candidate's status for each job (utils/stages.tsx), the job whose saved shortlist is open, who is being chosen for a match, and what is ticked for deletion.
  const [applications, setApplications] = useState<Application[]>(() => shownBefore()?.apps ?? []);
  const boardOwner = useRef<string | null>(null);
  const [savedShortlistOf, setSavedShortlistOf] = useState<Job | null>(null);
  const [chooser, setChooser] = useState<{ id: string; type: "candidate" | "job" } | null>(null);
  const [picked, setPicked] = useState<{ candidate: Set<string> | null; job: Set<string> | null }>({ candidate: null, job: null });
  const [bulk, setBulk] = useState<{ kind: "candidate" | "job"; busy: boolean } | null>(null);
  

  // A failed load is shown as a failure, never as an empty board: "0 candidates" would read as if the records were gone (R35).
  const [loadError, setLoadError] = useState<string | null>(null);
  // A list longer than the client reads (5,000) is said to be incomplete, with how many there are in all (code review, 16 Nov 2026, E-M10).
  const [listCap, setListCap] = useState(() => ({ cands: listCapped(shownBefore()?.cands), jobs: listCapped(shownBefore()?.jobs) }));
  // Reloads overlap (a batch poll, a published document, a failed save each start one) and a save puts its own answer on screen at once, so an older
  // answer landing last used to put an older record back: the next edit then met a version conflict, and a new status seemed to vanish (code review,
  // 16 Nov 2026, E-M1). Now the newest wins: a reload's answer is shown only if nothing newer has started or been saved here since (src/utils/requestOrder.ts).
  // `recordsOrder` covers the records and the open panels; `stagesOrder` each candidate's status per job, which is read separately.
  const [recordsOrder] = useState(requestOrder), [stagesOrder] = useState(requestOrder);
  const reload = useCallback(async (arriving?: unknown) => {
    const load = async (fresh: boolean): Promise<{ cands: Candidate[]; jobList: Job[] }> => {
      let cands: Candidate[], jobList: Job[];
      const ticket = recordsOrder.begin();
      try { [cands, jobList] = fresh ? await Promise.all([api.candidates(true), api.jobs(true)]) : await arrivingBoard().then((b) => [b.cands, b.jobs] as const); }
      catch (e) { if (recordsOrder.current(ticket) && !(e instanceof ApiError && e.status === 401)) setLoadError(e instanceof ApiError ? e.message : "The server could not be reached."); throw e; }
      if (!recordsOrder.current(ticket)) return recordsOrder.overtakenByWrite(ticket) ? load(true) : { cands, jobList };   // older than what is on screen: not shown
      setLoadError(null);
      setListCap({ cands: listCapped(cands), jobs: listCapped(jobList) });
      setCandidateRecords(cands);
      setJobRecords(jobList);
      const remember = (apps: Application[]) => { if (boardOwner.current) keepBoard({ cands, jobs: jobList, apps }); };
      remember(keptBoard()?.apps ?? []);
      const stagesTicket = stagesOrder.begin();
      api.applications().then((apps) => { if (stagesOrder.current(stagesTicket)) { setApplications(apps); remember(apps); } }).catch(() => {});   // each candidate's status per job; the board works without it
      // keep the open panels in step with the server copy
      setSelectedCandidate((cur) => (cur ? cands.find((c) => c.id === cur.id) ?? null : cur));
      setSelectedJob((cur) => (cur ? jobList.find((j) => j.id === cur.id) ?? null : cur));
      return { cands, jobList };
    };
    return load(arriving !== "arriving");   // only opening the page may take the page the portal shares; every other reload follows a change
  }, [recordsOrder, stagesOrder]);
  /** A change saved here is on screen: any reload already on its way is older than it. */
  const savedHere = (stages = false) => { recordsOrder.wrote(); if (stages) stagesOrder.wrote(); };
  // Settings, History links to a record with ?open=candidate:<id> or ?open=job:<id>: open it here, or say plainly that it is no longer on this board.
  const openFromLink = useCallback((loaded: { cands: Candidate[]; jobList: Job[] }) => {
    const params = new URLSearchParams(window.location.search), want = params.get("open");
    if (!want) return;
    const [kind, id] = want.split(":");
    const found = kind === "candidate" ? loaded.cands.find((c) => c.id === id) : kind === "job" ? loaded.jobList.find((j) => j.id === id) : undefined;
    if (found && kind === "candidate") setSelectedCandidate(found as Candidate);
    else if (found) setSelectedJob(found as Job);
    else toaster.create({ title: "Not on this board", description: "That record is not in this portal. It may have been deleted, or it belongs to another portal.", type: "info" });
    params.delete("open");
    window.history.replaceState(null, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
  }, []);

  // What an Overview block asked the board to show (src/utils/boardIntent.ts; docs/architecture/PLAN_OVERVIEW_LINKS.md), on top of the person's own filters.
  // The pill above the lists says what it is; Clear returns the board to everything. No AI and no credit: it only filters, opens records, or shows a match
  // that was already saved. The link is taken off the address once it has been acted on, so a refresh shows the board as the person left it.
  const [focus, setFocus] = useState<{ label: string; candidates?: Set<string>; jobs?: Set<string>; since?: number; openJobs?: boolean; rolesOfShown?: boolean; undo?: () => void } | null>(null);
  const applyFocus = async (loaded: { cands: Candidate[]; jobList: Job[] }) => {
    const f = parseFocus(window.location.search);
    if (!f) return;
    const params = new URLSearchParams(window.location.search); FOCUS_PARAMS.forEach((k) => params.delete(k));
    window.history.replaceState(null, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
    const cand = (id?: string) => (id ? loaded.cands.find((c) => c.id === id) : undefined), job = (id?: string) => (id ? loaded.jobList.find((j) => j.id === id) : undefined);
    const gone = () => toaster.create({ title: "Not on this board", description: "That record is not in this portal any more. It may have been deleted.", type: "info" });
    if (f.kind === "new") setFocus({ label: `Candidates added in the last ${f.days} days`, since: Date.now() - f.days * 86_400_000 });
    else if (f.kind === "jobs") setFocus({ label: "Open jobs", openJobs: true });
    else if (f.kind === "shortlisted") { setCandidateFilters((c) => ({ ...c, status: "shortlisted" })); setFocus({ label: "Shortlisted candidates", rolesOfShown: true, undo: () => setCandidateFilters((c) => ({ ...c, status: "All" })) }); }
    else if (f.kind === "department") {
      setCandidateFilters((c) => ({ ...c, department: f.dept })); setJobFilters((j) => ({ ...j, department: f.dept }));
      setFocus({ label: f.dept, undo: () => { setCandidateFilters((c) => ({ ...c, department: "All" })); setJobFilters((j) => ({ ...j, department: "All" })); } });
    } else if (f.kind === "match" || f.kind === "record") {
      const c = cand(f.candidateId), j = job(f.jobId);
      if ((f.candidateId && !c) || (f.jobId && !j)) gone();
      if (c) setSelectedCandidate(c); if (j) setSelectedJob(j);
      // Exactly what was clicked, and the bar that says so with the way back to the whole board (owner, 11 Nov 2026: "I should never be stuck on a screen,
      // no matter what I press in the Overview").
      if (c || j) setFocus({ label: [c?.name, j?.title].filter(Boolean).join(" and "), candidates: c ? new Set([c.id]) : undefined, jobs: j ? new Set([j.id]) : undefined });
      if (f.kind === "match" && c && j) void showSavedMatch(c, j);   // the assessment already saved: nothing is run again
    } else if (f.kind === "attention") {
      try {
        const r = await api.attentionRecords(f.rule);
        // Exactly the records the Overview counted, in the lists the rule is about; none at all when it has since been dealt with.
        setFocus({ label: r.count ? f.title : `${f.title}: nothing is waiting here now`, candidates: r.about.includes("candidates") ? new Set(r.candidateIds) : undefined, jobs: r.about.includes("jobs") ? new Set(r.jobIds) : undefined });
      } catch { toaster.create({ title: "Could not load that list", description: "The board shows everything instead. Try again from the Overview shortly.", type: "info" }); }
    }
  };
  const clearFocus = () => { focus?.undo?.(); setFocus(null); };
  // "Matching Board" in the header, pressed while already on the board, is the way back to the whole board too (DashboardNavbar.tsx).
  useEffect(() => { const back = () => clearFocus(); window.addEventListener("rolematch:board-home", back); return () => window.removeEventListener("rolematch:board-home", back); });

  // The board rises into place from top to bottom as it opens, the same quick entrance as the Overview's (src/utils/reveal.ts): once it has something to show.
  const revealed = useRef(false);
  useEffect(() => { if (authChecked && !revealed.current) { revealed.current = true; requestAnimationFrame(() => revealTopToBottom("[data-reveal], [data-reveal-children] > *")); } }, [authChecked]);
  // Require a real session, then load the organisation's records.
  // Which portal to open (owner brief, sign-in): one portal opens directly; several with none chosen show a chooser; none says so. A remembered choice
  // the person no longer has (they left, or were removed) is forgotten first, so the board never asks the server for a portal it will refuse.
  const [choosing, setChoosing] = useState<{ id: string; name: string; role: string }[] | null>(null), [noPortal, setNoPortal] = useState(false);
  useEffect(() => {
    // An Overview link is applied at once to the records the board already shows (kept from the Overview or sign-in), not after the fresh load: on live
    // that load took 5 to 10 s, and the board stood plain meanwhile (owner, 11 Nov 2026: "why make me wait 5 to 10 seconds ... all I get is the board").
    // The link is then taken off the address, so the fresh load does not apply it twice.
    // Only when the kept records hold what the link points at: a record added since then waits for the fresh load rather than being called missing.
    const kept = keptBoard(), f = parseFocus(window.location.search), open = new URLSearchParams(window.location.search).get("open")?.split(":")[1];
    const has = (id?: string) => !id || !!kept?.cands.some((c) => c.id === id) || !!kept?.jobs.some((j) => j.id === id);
    if (kept && (f || open) && has(open) && (!f || !("candidateId" in f || "jobId" in f) || (has((f as { candidateId?: string }).candidateId) && has((f as { jobId?: string }).jobId)))) {
      const loaded = { cands: kept.cands, jobList: kept.jobs }; openFromLink(loaded); void applyFocus(loaded);
    }
    api.me()
      .then(({ user, portals: mine }) => {
        // The board kept from before is shown only to the person it was loaded for; anyone else waits for their own.
        if (shownBefore() && !keptFor(user.userId)) { setCandidateRecords([]); setJobRecords([]); setApplications([]); setAuthChecked(false); }
        keepFor(user.userId); boardOwner.current = user.userId;
        const list = mine ?? [];
        if (mine) setPortals(mine);   // the role in each portal, from the same answer that lets the board open (E-M4)
        if (selectedPortal() && !list.some((p) => p.id === selectedPortal())) selectPortal(null);
        if (list.length === 0) { setNoPortal(true); throw new Error("no portal"); }
        if (list.length > 1 && !selectedPortal()) { setChoosing(list); throw new Error("choose"); }
        // Set by the sign-up and sign-in pages: the tour is for new accounts only, and a returning person just gets a friendly note.
        try {
          if (sessionStorage.getItem("th_just_signed_up")) { sessionStorage.removeItem("th_just_signed_up"); onTutorialOpen(); }
          else if (sessionStorage.getItem("th_welcome_back")) { sessionStorage.removeItem("th_welcome_back"); setWelcomeBack((user.name ?? "").split(" ")[0] ?? ""); }
        } catch { /* storage unavailable: no welcome message, nothing breaks */ }
      })
      .then(() => reload("arriving"))
      .then((loaded) => { openFromLink(loaded); void applyFocus(loaded); setAuthChecked(true); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) { forgetAll(); navigate(e.code === "AUTH-005" ? "/login?ended=1" : "/login"); } else setAuthChecked(true); });
  }, [navigate, reload, openFromLink, onTutorialOpen]);

  // While CVs or jobs are being read again, the board asks for the latest every 10 seconds, so each card unlocks with its new reading without a refresh.
  useEffect(() => {
    if (!authChecked || rereading + rereadingJobs === 0) return;
    const t = window.setInterval(() => { if (!document.hidden) reload().catch(() => {}); }, 10_000);
    const back = () => { if (!document.hidden) reload().catch(() => {}); };   // at once on coming back to the page, not up to 10 s later
    document.addEventListener("visibilitychange", back);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [authChecked, rereading + rereadingJobs > 0, reload]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Check the server for documents being processed. Often only while something is processing; rarely when idle (to notice a colleague's upload);
  // never while the tab is hidden. With many people on the board at once, idle boards cost the server almost nothing.
  const checkDocumentsNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!authChecked) return;
    const PROCESSING_MS = 1500, HELD_MS = 10_000, IDLE_MS = 30_000;
    let stopped = false, timer = 0, inFlight = false, again = false, heldOnly = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.hidden) return;
      timer = window.setTimeout(tick, knownDocs.current.size === 0 ? IDLE_MS : heldOnly ? HELD_MS : PROCESSING_MS);
    };
    const tick = async () => {
      if (inFlight) { again = true; return; }   // one check at a time; a request made meanwhile runs right after
      inFlight = true;
      try {
        const docs = await api.documents();
        if (stopped) return;
        // A document that could not be added is not left sitting on the board: say briefly what went wrong and what to try, then clear it
        // (the failure stays in the error log). Several at once become a single notice.
        // A file in a batch is reported by the batch's own panel, summary and report (one place, no pop-up per file); only single files get a notice here.
        const failed = docs.filter((d) => d.status === "exception" && !notifiedFailures.current.has(d.id) && !d.batchId);
        if (failed.length) {
          failed.forEach((d) => notifiedFailures.current.add(d.id));
          toaster.create({ ...describeFailures(failed), type: "warning", duration: Infinity, closable: true }); // stays until the recruiter closes it
          failed.forEach((d) => api.dismissDocument(d.id).catch(() => notifiedFailures.current.delete(d.id)));
        }
        setDocuments(docs.filter((d) => d.status !== "exception"));
        const processing = docs.filter((d) => d.status === "processing").map((d) => d.id);
        heldOnly = processing.length > 0 && docs.filter((d) => d.status === "processing").every((d) => d.stage === "held");   // waiting out an outage: no need to ask often
        // A document that was processing last time and is gone from the list has finished, but not necessarily been published: a failure cleared in
        // another tab, or one past the list's newest 100, is missing too, and was announced as "Document published" (code review, 16 Nov 2026, E-M7).
        // A file of a batch of several is reported by its batch's panel and summary; each other one is looked up, and only one the server calls published is
        // announced as published.
        const missing = [...knownDocs.current].filter((id) => !processing.includes(id) && !docs.some((d) => d.id === id && d.status === "exception"));
        const ofBatchPanel = (id: string) => { const b = batchesRef.current.find((x) => x.id === docBatch.current.get(id)); return !!b && b.counts.declared > 1; };
        const fate = await whatBecameOf(missing.filter((id) => !ofBatchPanel(id)), (id) => api.document(id).catch((e) => (e instanceof ApiError && e.status === 404 ? "gone" as const : null)));
        if (stopped) return;
        knownDocs.current = new Set([...processing, ...fate.followOn]);
        docBatch.current = new Map([...docs.map((d) => [d.id, d.batchId ?? null] as const), ...fate.followOn.map((id) => [id, docBatch.current.get(id) ?? null] as const)]);
        const failedNow = fate.failed.filter((d) => !notifiedFailures.current.has(d.id));
        if (failedNow.length) { failedNow.forEach((d) => notifiedFailures.current.add(d.id)); toaster.create({ ...describeFailures(failedNow), type: "warning", duration: Infinity, closable: true }); }
        if (missing.length) await reload();
        if (fate.published.length) toaster.create({ title: fate.published.length === 1 ? "Document published" : `${fate.published.length} documents published`, description: "The validated record is ready on the matching board.", type: "success" });
      } catch { /* transient; try again next tick */ }
      finally {
        inFlight = false;
        if (again && !stopped) { again = false; void tick(); } else schedule();
      }
    };
    const onVisibility = () => { if (document.hidden) window.clearTimeout(timer); else void tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    checkDocumentsNow.current = () => void tick();
    void tick();
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); checkDocumentsNow.current = () => {}; };
  }, [authChecked, reload]);

  // Check if user has dismissed the tutorial before
  useEffect(() => {
    const dontShowTutorial = localStorage.getItem("rolematchDontShowTutorial");
    if (dontShowTutorial === "true") {
      onTutorialClose();
    }
  }, [onTutorialClose]);
  const notifiedFailures = useRef<Set<string>>(new Set());
  // One progress pop-up serves all three kinds of matching. Its percentage comes from steps that really completed (see the runners below).
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressRunning = progress?.status === "running";
  const targetRef = useRef(0);
  const lastRun = useRef<() => void>(() => {});
  const finishedRef = useRef<(() => void) | null>(null);
  /** Cancel in the matching window (owner, 9 Nov 2026: "there needs to be an option to cancel ... i pressed something by mistake and now i use credits"). */
  const cancelRun = useRef<(() => void) | null>(null);
  /** One matching run that can be cancelled: once cancelled the window closes at once, nothing more is sent, and every match it started that still waits is
   *  withdrawn; what the AI had not been handed yet costs nothing. Matches that come back after Cancel are withdrawn as they arrive. */
  const cancellable = () => {
    const run = { stopped: false, ids: [] as string[], add: (r: MatchResult) => { if (!r.id || r.ai?.state !== "pending") return; if (run.stopped) void api.cancelMatches([r.id]).catch(() => {}); else run.ids.push(r.id); } };
    cancelRun.current = () => {
      run.stopped = true; cancelRun.current = null; setProgress(null);
      const ids = run.ids.splice(0);
      const told = (notSent: number, started: number) => toaster.create({ title: "Matching cancelled", type: "info", closable: true,
        description: started ? `Nothing more will be sent to the AI. ${started === 1 ? "One match was" : `${started} matches were`} already with it; whatever it finished is kept for the next Match.${notSent ? " The rest used no usage credits." : ""}` : "Nothing was sent to the AI after this, so no more usage credits were used." });
      if (!ids.length) { told(0, 0); return; }
      api.cancelMatches(ids).then((r) => told(r.notSent, r.started)).catch(() => toaster.create({ title: "Not cancelled", description: "The server could not be reached, so the AI may still score these. Try again shortly.", type: "error", closable: true }));
    };
    return run;
  };
  // Jobs and candidates are grouped by the same standard departments, which Claude places each in (server/src/jobReader.ts, JOB_DEPARTMENTS;
  // department.ts; owner, 10 Nov 2026), the same for every organisation, whatever a document calls its own unit. One read before then is
  // "Not grouped yet" until it is placed (the Overview's departments card) or read again.
  const groupOf = (r: { group?: string }) => r.group || "Not grouped yet";
  const departmentsIn = (rs: { group?: string }[]) => ["All", ...[...new Set(rs.map(groupOf))].sort((a, b) => Number(a === "Not grouped yet") - Number(b === "Not grouped yet") || a.localeCompare(b))];
  const [candidatesNeedReview, setCandidatesNeedReview] = useState(false);
  const [jobsNeedReview, setJobsNeedReview] = useState(false);
  const [candidateFilters, setCandidateFilters] = useState<FilterState>({
    location: "All",
    skills: [],
    searchTerm: "",
    status: "All",
    department: "All"
  });

  const [jobFilters, setJobFilters] = useState<FilterState>({
    location: "All",
    skills: [],
    searchTerm: "",
    department: "All"
  });

  // Extract unique candidate statuses and locations for filter dropdowns
  // The filter lists the organisation's own statuses (and any a record still carries), never a fixed list.
  const candidateStatuses = useMemo(() => {
    const known = (settingsCtx.settings?.statuses ?? []).filter((s) => s.active).map((s) => s.key);
    return ["All", ...new Set([...known, ...candidateRecords.map((c) => c.status), ...applications.map((a) => a.status)])];
  }, [candidateRecords, settingsCtx.settings, applications]);
  
  const candidateDepartments = useMemo(() => departmentsIn(candidateRecords), [candidateRecords]);   // eslint-disable-line react-hooks/exhaustive-deps
  const candidateLocations = useMemo(() => {
    return ["All", ...[...new Set(candidateRecords.map((c) => c.city).filter(Boolean) as string[])].sort()];   // one name per city (server/src/places.ts)
  }, [candidateRecords]);

  const filteredCandidates = useMemo(() => {
    return candidateRecords.filter((candidate) => {
      const matchesLocation =
        candidateFilters.location === "All" ||
        candidate.city === candidateFilters.location;

      const matchesSkills =
        candidateFilters.skills.length === 0 ||
        candidateFilters.skills.every((skill: string) =>
          candidate.skills.includes(skill)
        );
      
      // A status is per job. With a role selected, the filter means "for that role" (owner, 10 Nov 2026: "shortlisted candidates per job too");
      // with none, "Shortlisted" finds everyone shortlisted for any job. "New" is someone with no status for it (or for any job) yet.
      const stages = applications.filter((a) => a.candidateId === candidate.id && (!selectedJob || a.jobId === selectedJob.id));
      const matchesStatus =
        candidateFilters.status === "All" ||
        (candidateFilters.status === "new" ? stages.length === 0 && candidate.status === "new"
          : stages.some((a) => a.status === candidateFilters.status) || (stages.length === 0 && candidate.status === candidateFilters.status));
      
      const matchesSearchTerm = candidateFilters.searchTerm === "" ||
        candidate.name.toLowerCase().includes(candidateFilters.searchTerm.toLowerCase()) ||
        candidate.role.toLowerCase().includes(candidateFilters.searchTerm.toLowerCase()) ||
        candidate.skills.some(skill => 
          skill.toLowerCase().includes(candidateFilters.searchTerm.toLowerCase())
        );

      const matchesReview = !candidatesNeedReview || candidate.reviewState === "needs_review";
      const matchesDepartment = candidateFilters.department === "All" || groupOf(candidate) === candidateFilters.department;
      const matchesFocus = (!focus?.candidates || focus.candidates.has(candidate.id)) && (!focus?.since || new Date(candidate.appliedDate).getTime() >= focus.since);
      return matchesLocation && matchesSkills && matchesStatus && matchesSearchTerm && matchesReview && matchesDepartment && matchesFocus;
    });
  }, [candidateFilters, candidateRecords, candidatesNeedReview, applications, focus, selectedJob?.id]);
  // Under the Overview's "Shortlisted candidates", the roles column keeps only the roles those people hold that stage for (owner, 17 Nov 2026), so the
  // banner reads "1 candidate, 1 role", not every role in the portal. Null whenever that focus is off or the status filter has been cleared.
  const rolesOfShown = useMemo(() => {
    const status = candidateFilters.status;
    if (!focus?.rolesOfShown || !status || status === "All" || status === "new") return null;
    // From every person on the board, not only those left after choosing a role: choosing one role must not hide the others.
    return jobsHolding(applications, new Set(candidateRecords.map((c) => c.id)), status);
  }, [focus?.rolesOfShown, candidateFilters.status, candidateRecords, applications]);
  const candidatesFlagged = candidateRecords.filter((c) => c.reviewState === "needs_review").length;
  const jobsFlagged = jobRecords.filter((j) => j.reviewState === "needs_review").length;

  const jobDepartments = useMemo(() => departmentsIn(jobRecords), [jobRecords]);
  
  const jobLocations = useMemo(() => {
    return ["All", ...[...new Set(jobRecords.map((j) => j.city).filter(Boolean) as string[])].sort()];
  }, [jobRecords]);

  const filteredJobs = useMemo(() => {
    return jobRecords.filter((job) => {
      const matchesLocation =
        jobFilters.location === "All" || 
        job.city === jobFilters.location;

      const matchesSkills =
        jobFilters.skills.length === 0 ||
        jobFilters.skills.every((skill: string) =>
          job.skills.includes(skill)
        );
        
      const matchesDepartment =
        jobFilters.department === "All" ||
        groupOf(job) === jobFilters.department;
      
      const matchesSearchTerm = jobFilters.searchTerm === "" ||
        job.title.toLowerCase().includes(jobFilters.searchTerm.toLowerCase()) ||
        job.company.toLowerCase().includes(jobFilters.searchTerm.toLowerCase()) ||
        job.skills.some(skill => 
          skill.toLowerCase().includes(jobFilters.searchTerm.toLowerCase())
        );

      const matchesReview = !jobsNeedReview || job.reviewState === "needs_review";
      const matchesFocus = (!focus?.jobs || focus.jobs.has(job.id)) && (!focus?.openJobs || !["closed", "archived"].includes(job.status ?? ""))
        && (!rolesOfShown || rolesOfShown.has(job.id));
      return matchesLocation && matchesSkills && matchesDepartment && matchesSearchTerm && matchesReview && matchesFocus;
    });
  }, [jobFilters, jobRecords, jobsNeedReview, focus, rolesOfShown]);   // jobsNeedReview was missing, so "Show only needs review" did not filter (code review, 16 Nov 2026, E-M2)
  // A department filter whose department has gone (its last record deleted, or every record placed elsewhere) returns to All, so no list is left empty
  // by a choice that no longer exists.
  useEffect(() => {
    if (candidateFilters.department !== "All" && candidateRecords.length && !candidateDepartments.includes(candidateFilters.department ?? "")) setCandidateFilters((c) => ({ ...c, department: "All" }));
    if (jobFilters.department !== "All" && jobRecords.length && !jobDepartments.includes(jobFilters.department ?? "")) setJobFilters((j) => ({ ...j, department: "All" }));
  }, [candidateDepartments, jobDepartments]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Upload batches. The server holds the truth (src/batches.ts); this only sends files into a batch a few at a time and shows the server's counts.
  const [batches, setBatches] = useState<BatchView[]>([]);
  // A finished batch goes to Settings, History (its summary is still shown once to the person who sent it). An organisation may keep finished batches on the board instead.
  const keepFinished = settingsCtx.settings?.panels?.finishedBatchesOnBoard ?? false;
  const sendings = useSendings();   // batches being sent in the background (src/utils/backgroundSends.ts): they carry on when this page is left
  const [preparing, setPreparing] = useState<{ kind: "cv" | "jd"; count: number } | null>(null);
  const [skippedByBatch, setSkippedByBatch] = useState<Record<string, number>>({});
  const [meId, setMeId] = useState<string | null>(null), [myRole, setMyRole] = useState<string>("");
  useEffect(() => { api.me().then(({ user }) => { setMeId(user.userId); meIdRef.current = user.userId; setMyRole(user.role); }).catch(() => {}); }, []);
  // The person's portals and their role in each: null until known. They come with "who am I" as the board opens, and from /portals.
  const [portals, setPortals] = useState<PortalChoice[] | null>(null);
  const loadPortals = useCallback(() => api.portals().then(setPortals).catch(() => {}), []);
  useEffect(() => { void loadPortals(); }, [loadPortals]);
  const activePortal = portals?.find((p) => p.id === selectedPortal()) ?? portals?.[0];   // the same fallback the portal selector uses
  // The server refuses every change from a hiring manager and shows them only shortlisted candidates (hiringManager.ts); the board just does not offer the
  // rest. While the role is not known (not loaded yet, or the request failed) nothing that changes a record is offered either: it used to be offered in full
  // then, and every action was refused (code review, 16 Nov 2026, E-M4).
  const access = boardAccess(portals, selectedPortal()), viewOnly = access !== "change";
  // The portal's shared upload allowance (server figures, refreshed every few seconds; labelled if they cannot be). It blocks nothing by itself: every admission is
  // decided by the server, and a full allowance leaves records, matching and reports fully usable.
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [capacityAt, setCapacityAt] = useState(0), [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!authChecked) return;
    let stopped = false, timer = 0, delay = CAPACITY_MS;
    const poll = async () => {
      try { const c = await api.capacity(); if (!stopped) { setCapacity(c); setCapacityAt(Date.now()); delay = batchesRef.current.some((b) => !b.complete) ? 5000 : CAPACITY_MS; } }
      catch (e) { delay = e instanceof ApiError && e.status === 429 ? Math.min(60_000, (e.retryAfterSec ?? 10) * 1000 + Math.random() * 3000) : Math.min(30_000, delay * 2); }   // after a limit or an error, back off: no retry storm
      if (!stopped && !document.hidden) timer = window.setTimeout(poll, delay);
    };
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible); void poll();
    const tick = window.setInterval(() => setNow(Date.now()), 5000);
    return () => { stopped = true; window.clearTimeout(timer); window.clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, [authChecked]);
  const capacityStale = !!capacity && now - capacityAt > 45_000;
  // Uploads pause while CVs are being read again (owner, 9 Nov 2026: "when reading, uploads should be locked"), and open again by themselves (rereading, above).
  const blockedFor = () => (capacity && capacity.available === 0 && !capacityStale
    ? { message: `All ${capacity.total} upload slots in this portal are reserved right now. Reading records, matching and reports still work. Try again when a batch has closed.` }
    : rereading > 0 ? { message: `Uploads are paused while ${rereading} ${rereading === 1 ? "CV is" : "CVs are"} read again. They open again by themselves when the reading is done.` }
    : rereadingJobs > 0 ? { message: `Uploads are paused while ${rereadingJobs} ${rereadingJobs === 1 ? "job is" : "jobs are"} read again. They open again by themselves when the reading is done.` } : undefined);
  const refreshCapacity = () => api.capacity().then((c) => { setCapacity(c); setCapacityAt(Date.now()); }).catch(() => {});
  /** What a refused upload or reservation says. A temporary rate limit is not a full portal, and a full portal is not a rate limit. */
  const refusalText = (e: unknown): { title: string; description: string } => {
    if (e instanceof ApiError && e.code === "CAPACITY-001") return { title: "Not enough upload slots", description: e.message };
    if (e instanceof ApiError && e.code === "RATE-001") return { title: "Slow down for a moment", description: e.message };
    return { title: "This batch cannot be accepted", description: e instanceof ApiError ? e.message : "The server could not be reached." };
  };
  // The completion summary: shown once to the person who submitted the batch when it finishes, from the stored report, and again after a refresh or a later
  // sign-in until they acknowledge it (the server remembers). One at a time.
  const [summary, setSummary] = useState<{ batch: BatchView; report: BatchReport | null } | null>(null);
  const shownSummaries = useRef(new Set<string>());
  useEffect(() => {
    if (summary || !meId) return;
    const due = batches.find((b) => b.counts.declared > 1 && b.complete && !b.acknowledgedByMe && b.createdBy === meId && !shownSummaries.current.has(b.id));   // a single upload reports on its own card
    if (!due) return;
    shownSummaries.current.add(due.id);
    api.batchReport(due.id).then((report) => setSummary({ batch: due, report })).catch(() => setSummary({ batch: due, report: null }));
  }, [batches, meId, summary]);
  const closeSummary = (ack = true) => {
    const id = summary?.batch.id; setSummary(null);
    if (id && ack) api.ackBatch(id).then(() => setBatches((cur) => cur.map((x) => (x.id === id ? { ...x, acknowledgedByMe: true } : x)))).catch(() => shownSummaries.current.delete(id));
  };
  const downloadReport = () => {
    if (!summary?.report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(summary.report)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `batch-report-${summary.batch.id.slice(0, 8)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const batchesRef = useRef<BatchView[]>([]);
  const activeSeen = useRef(new Set<string>()), meIdRef = useRef<string | null>(null);
  batchesRef.current = batches;
  useEffect(() => {
    if (!authChecked) return;
    let stopped = false, timer = 0;
    const poll = async () => {
      try {
        const list = await api.batches();
        if (stopped) return;
        const wasWorking = batchesRef.current.some((b) => !b.complete);
        setBatches(list);
        // A colleague's batch finishing is a quiet note (the shared panel shows the detail), once, and only for batches seen working in this browser.
        for (const b of list) { if (!b.complete) activeSeen.current.add(b.id); else if (activeSeen.current.delete(b.id) && b.createdBy !== meIdRef.current) toaster.create({ title: batchCompletedLine(b), type: "info", duration: 8000 }); }
        if (wasWorking) void reload();   // records published since the last look
      } catch { /* transient */ }
      if (!stopped && !document.hidden) timer = window.setTimeout(poll, batchesRef.current.some((b) => !b.complete) ? 2000 : 30_000);
    };
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [authChecked, reload]);

  const handleFilesUpload = async (type: "cv" | "jd", chosen: File[]) => {
    const maxMb = settingsCtx.settings?.limits.maxFileMb ?? rolematchConfig.uploads.maxSizeMb;
    const { files, skipped } = chooseFiles(chosen, settingsCtx.formats.extensions, maxMb * 1024 * 1024);
    if (files.length === 0) { toaster.create({ title: "Nothing to upload", description: skipped.length ? `None of the ${skipped.length} files is a supported document (${settingsCtx.formats.description}).` : "No files were found.", type: "error" }); return; }
    if (files.length === 1 && skipped.length === 0) { void handleFileUpload(type, files[0]); return; }
    let batch: BatchView;
    setPreparing({ kind: type, count: files.length });   // the server takes a moment to admit a batch; show it at once rather than a blank wait
    try { batch = await api.createBatch(type, files.length, files.reduce((n, f) => n + f.size, 0), skipped); }
    catch (e) { setPreparing(null); void refreshCapacity(); toaster.create({ ...refusalText(e), type: e instanceof ApiError && e.code === "RATE-001" ? "warning" : "error" }); return; }
    setPreparing(null);
    setBatches((cur) => [batch, ...cur]);
    setSkippedByBatch((cur) => ({ ...cur, [batch.id]: skipped.length }));
    // Sent in the background of the whole app, not of this page: going to Settings or any other screen does not stop it.
    await startSending(batch.id, files.length, async (signal, report) => {
      await sendBatch(files, {
        name: (f) => f.name, signal,
        // Every file is sent to the server straight away, a few at a time; the server's own queue paces the reading (owner, 9 Nov 2026: closing the browser
        // must not lose the rest of a batch). Once they are all in, the page can be closed.
        window: 500, concurrency: 4,
        send: (f) => api.uploadToBatch(batch.id, type, f),
        untilOnline: pauseUntilOnline,   // a lost connection pauses the batch; it resumes by itself when the connection is back
        reachable: serverReachable,      // but a file the browser cannot send while the server answers is refused after a few tries (G-M4)
        inFlight: async () => { const v = await api.batch(batch.id); setBatches((cur) => cur.map((x) => (x.id === v.id ? v : x))); return v.counts.waiting + v.counts.processing; },
        onProgress: (p) => report(p.sent + p.refused.length, p.paused),
      });
      // Read the batch once more BEFORE saying sending has finished, so the panel never shows the old "not sent yet" numbers beside a finished sender.
      await api.batch(batch.id).then((v) => setBatches((cur) => cur.map((x) => (x.id === v.id ? v : x)))).catch(() => {});
    });
  };
  // A batch of several files has its own panel while it runs (and after, while its summary is kept). A single upload is a batch of one inside (its slot
  // reservation): its own processing card shows it.
  const panelShown = (b: BatchView) => b.counts.declared > 1 && !b.closedAt && (!(b.complete || b.cancelledAt) || keepFinished);
  const batchPanels = (kind: "cv" | "jd") => [...(preparing?.kind === kind ? [<DocumentProcessingCard key="preparing" fileName={`${preparing.count} files`} documentType={kind === "cv" ? "CV" : "Job description"} stageIndex={-1} uploading />] : []), ...batches.filter((b) => b.kind === kind && panelShown(b)).map((b) => (   // a single upload is a batch of one inside (its slot reservation): its own processing card shows it
    <BatchPanel key={b.id} canManage={b.createdBy === meId || myRole === "admin"} batch={b} files={documents.filter((d) => d.batchId === b.id && d.status === "processing")} skipped={skippedByBatch[b.id] ?? 0} sending={sendings.get(b.id) ?? null}
      onCancel={() => { stopSending(b.id); api.cancelBatch(b.id).then((r) => setBatches((cur) => cur.map((x) => (x.id === b.id ? r.view : x)))).catch(() => toaster.create({ title: "Could not cancel", type: "error" })); }}
      onRetry={() => api.retryBatch(b.id).then((r) => { setBatches((cur) => cur.map((x) => (x.id === b.id ? r.view : x))); if (!r.retried) toaster.create({ title: "Nothing to retry", description: "The remaining files failed for reasons a retry cannot change, or have used their retries.", type: "info" }); }).catch(() => toaster.create({ title: "Could not retry", type: "error" }))}
      onClose={() => api.closeBatch(b.id).then(() => setBatches((cur) => cur.filter((x) => x.id !== b.id))).catch(() => {})} />
  ))];

  const [uploadingNow, setUploadingNow] = useState<{ id: string; kind: "cv" | "jd"; fileName: string; paused?: boolean }[]>([]);
  const cancelledUploads = useRef(new Set<string>());   // single uploads a person cancelled while the connection was down
  const handleFileUpload = async (type: "cv" | "jd", file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!settingsCtx.formats.extensions.includes("." + extension)) {
      toaster.create({ title: "Unsupported document", description: `Use ${settingsCtx.formats.description}. iPhone HEIC photos must be saved as JPEG first.`, type: "error" });
      return;
    }
    const maxMb = settingsCtx.settings?.limits.maxFileMb ?? rolematchConfig.uploads.maxSizeMb; // the organisation's own limit once loaded
    if (file.size > maxMb * 1024 * 1024) {
      toaster.create({ title: "File is too large", description: `Maximum size is ${maxMb} MB.`, type: "error" });
      return;
    }
    // Show the file at once: the request waits on the server's storage for a second or two, and a blank wait looks like nothing happened.
    const localId = "uploading-" + Math.random().toString(36).slice(2);
    setUploadingNow((cur) => [{ id: localId, kind: type, fileName: file.name }, ...cur]);
    try {
      // A lost connection is not a failure: the file is sent again until it arrives, and the card says it is paused (owner, 10 Nov 2026). Cancel ends it.
      const send = async (): Promise<Awaited<ReturnType<typeof api.upload>> | null> => {
        for (let tries = 0, fileErrors = 0; ; tries++) {
          try { const d = await api.upload(type, file); setUploadingNow((cur) => cur.map((u) => (u.id === localId && u.paused ? { ...u, paused: false } : u))); return d; }
          catch (e) {
            if (e instanceof ApiError && e.status !== 0) throw e;   // the server answered: a real refusal, said as before
            // The server can be reached, so the browser could not send this file (changed, moved or online-only since it was chosen): a few tries, then
            // said, instead of "paused" for ever (code review, 16 Nov 2026, G-M4).
            if (await serverReachable()) { if (++fileErrors >= 3) throw new ApiError(0, "FILE-UNREADABLE", FILE_UNREADABLE); await new Promise((r) => setTimeout(r, 1000)); continue; }
            setUploadingNow((cur) => cur.map((u) => (u.id === localId ? { ...u, paused: true } : u)));
            await pauseUntilOnline(Math.min(10_000, 2000 * 2 ** Math.min(3, tries)));
            if (cancelledUploads.current.delete(localId)) return null;
          }
        }
      };
      const doc = await send();
      if (!doc) return;
      if (doc.duplicate) {
        toaster.create({ title: "Already uploaded", description: "This exact file is already in your organisation, so it was not processed again.", type: "info" });
      } else {
        knownDocs.current.add(doc.id);
        setDocuments((cur) => [doc, ...cur.filter((d) => d.id !== doc.id)]);
        checkDocumentsNow.current();   // follow it closely from now on
      }
    } catch (e) {
      toaster.create({ ...(e instanceof ApiError && (e.code === "CAPACITY-001" || e.code === "RATE-001") ? refusalText(e) : { title: "Upload failed", description: e instanceof ApiError ? e.message : "The server could not be reached." }), type: e instanceof ApiError && e.code === "RATE-001" ? "warning" : "error" });
      void refreshCapacity();
    } finally {
      setUploadingNow((cur) => cur.filter((u) => u.id !== localId));
    }
  };

  // A change to a field read from the document needs a reason (the server requires it; notes and status never do). Cancelling saves nothing.
  const { ask: askChangeReason, dialog: changeReasonDialog } = useChangeReason();
  const documentFieldsChanged = (kind: "candidate" | "job", before: unknown, after: unknown): string[] => {
    const fields = settingsCtx.response?.editPolicy?.configurable[kind] ?? {};
    return Object.keys(fields).filter((k) => JSON.stringify((before as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify((after as Record<string, unknown>)[k])).map((k) => fields[k].label.toLowerCase());
  };

  const saveCandidate = async (updated: Candidate) => {
    try {
      const changed = documentFieldsChanged("candidate", candidateRecords.find((c) => c.id === updated.id), updated);
      const reason = changed.length ? await askChangeReason(changed) : undefined;
      if (reason === null) return null;   // cancelled: nothing is saved
      const saved = await api.saveCandidate(updated, reason);
      savedHere(); setCandidateRecords((cur) => cur.map((c) => (c.id === saved.id ? saved : c)));
      setSelectedCandidate((cur) => (cur?.id === saved.id ? saved : cur));
      return saved;
    } catch (e) {
      toaster.create({ title: "Not saved", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
      await reload();
      return null;
    }
  };

  const saveJob = async (updated: Job) => {
    try {
      const changed = documentFieldsChanged("job", jobRecords.find((j) => j.id === updated.id), updated);
      const reason = changed.length ? await askChangeReason(changed) : undefined;
      if (reason === null) return null;   // cancelled: nothing is saved
      const saved = await api.saveJob(updated, reason);
      savedHere(); setJobRecords((cur) => cur.map((j) => (j.id === saved.id ? saved : j)));
      setSelectedJob((cur) => (cur?.id === saved.id ? saved : cur));
      return saved;
    } catch (e) {
      toaster.create({ title: "Not saved", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
      await reload();
      return null;
    }
  };

  const confirmCandidateReview = async (c: Candidate) => {
    try {
      const saved = await api.markReviewed<Candidate>("candidates", c.id, c.version);
      savedHere(); setCandidateRecords((cur) => cur.map((x) => (x.id === saved.id ? saved : x)));
      setSelectedCandidate((cur) => (cur?.id === saved.id ? saved : cur));
    } catch (e) {
      toaster.create({ title: "Not saved", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
      await reload();
    }
  };

  const confirmJobReview = async (j: Job) => {
    try {
      const saved = await api.markReviewed<Job>("jobs", j.id, j.version);
      savedHere(); setJobRecords((cur) => cur.map((x) => (x.id === saved.id ? saved : x)));
      setSelectedJob((cur) => (cur?.id === saved.id ? saved : cur));
    } catch (e) {
      toaster.create({ title: "Not saved", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
      await reload();
    }
  };

  const removeCandidate = async (c: Candidate) => {
    try {
      await api.deleteRecord("candidates", c.id);
      savedHere(true); setCandidateRecords((cur) => cur.filter((x) => x.id !== c.id));
      setSelectedCandidate((cur) => (cur?.id === c.id ? null : cur));
      setMatchedCandidate((cur: any) => (cur?.id === c.id ? null : cur));
      toaster.create({ title: "Candidate deleted", description: "The record, original CV and match results were removed.", type: "success" });
    } catch (e) {
      toaster.create({ title: "Not deleted", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
      throw e;
    }
  };

  const removeJob = async (j: Job) => {
    try {
      await api.deleteRecord("jobs", j.id);
      savedHere(true); setJobRecords((cur) => cur.filter((x) => x.id !== j.id));
      setSelectedJob((cur) => (cur?.id === j.id ? null : cur));
      setMatchedJob((cur: any) => (cur?.id === j.id ? null : cur));
      toaster.create({ title: "Job deleted", description: "The job, original file and match results were removed.", type: "success" });
    } catch (e) {
      toaster.create({ title: "Not deleted", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
      throw e;
    }
  };

  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  /** Moves the shown progress forward (never back, and never to 100 until the results are ready). */
  const advance = (stage: number, target: number) => {
    targetRef.current = Math.max(targetRef.current, Math.min(99, target));
    setProgress((p) => (p && p.status === "running" ? { ...p, stage: Math.max(p.stage, stage), target: targetRef.current } : p));
  };
  const startProgress = (p: Omit<ProgressState, "status" | "target" | "stage">) => { targetRef.current = 2; setProgress({ ...p, stage: 0, target: 2, status: "running" }); };
  // A failure says what is true afterwards (`afterError`): whether matches already with the AI carry on, never a blanket "Nothing was changed" (code review,
  // 16 Nov 2026, E-M5). Messages written for people (the AI time-out from waitForScores) are shown as they are; only a failed fetch is "could not be reached".
  const failProgress = (e: unknown, afterError?: string) => setProgress((p) => (p ? { ...p, status: "error", afterError, error: e instanceof ApiError || (e instanceof Error && !(e instanceof TypeError)) ? e.message : "The server could not be reached." } : p));
  /** The only moment progress reaches 100%: when the results exist. It is shown for a moment, then the results open. */
  const completeProgress = async (open: () => void) => {
    targetRef.current = 100;
    setProgress((p) => (p ? { ...p, stage: p.stages.length - 1, target: 100, status: "done" } : p));
    // wait until the number the person sees has really ticked up to 100%, hold it for a moment, then show the results
    await new Promise<void>((done) => { finishedRef.current = done; });
    await sleep(700);
    setProgress(null);
    open();
  };

  // 1 candidate + 1 job, only after the green Match button is pressed. The window stays open until the AI's score is final (owner, 9 Nov 2026: no score is shown
  // while it is being worked out).
  const handleMatch = async (candidate: Candidate, job: Job) => {
    if (progressRunning) return; // a second request cannot start while one is running
    // A pair already assessed opens its recorded assessment at once: nothing runs again (owner, 10 Nov 2026; the server holds to it too, index.ts runMatch).
    if (recorded.current.has(`${candidate.id}|${job.id}`)) { void showSavedMatch(candidate, job); return; }
    lastRun.current = () => handleMatch(candidate, job);
    startProgress({
      heading: "Assessing role alignment",
      subject: `Matching ${candidate.name} with ${job.title}`,
      stages: ["Opening the role requirements", "Reviewing the candidate evidence", "Scoring with the AI", "Checking every requirement against the CV", "Preparing the match assessment"],
    });
    let easing: number | undefined;
    const run = cancellable();
    try {
      await api.getJob(job.id); advance(1, 10);                // the latest version of the role really is loaded
      await api.getCandidate(candidate.id); advance(1, 16);    // and of the candidate
      if (run.stopped) return;
      const first = await api.match(candidate.id, job.id); run.add(first); advance(2, 22);
      if (run.stopped) return;
      // The AI works on one question; while it does, the number rises slowly toward (but stays below) the finish.
      easing = window.setInterval(() => advance(targetRef.current > 60 ? 3 : 2, targetRef.current + (90 - targetRef.current) * 0.02), 500);
      const [result] = await waitForScores([first], () => {}, () => run.stopped);
      window.clearInterval(easing);
      if (run.stopped) return;
      cancelRun.current = null;
      advance(4, 97);
      await completeProgress(() => { setMatchedCandidate(candidate); setMatchedJob(job); setMatchResult(result); onOpen(); });
    } catch (e) {
      window.clearInterval(easing);
      cancelRun.current = null;
      if (!run.stopped) failProgress(e, failedRunNote(run.ids.length));
    }
  };

  // Whether the selected pair already has a recorded assessment (the AI's finished score): then the bar offers it instead of a new match.
  const recorded = useRef(new Map<string, string>()), [recordedHere, setRecordedHere] = useState<{ at: string } | null>(null);
  useEffect(() => {
    const c = selectedCandidate?.id, j = selectedJob?.id;
    setRecordedHere(c && j && recorded.current.has(`${c}|${j}`) ? { at: recorded.current.get(`${c}|${j}`)! } : null);
    if (!c || !j) return;
    let live = true;
    api.savedMatch(c, j).then((r: any) => { if (r?.ai?.state !== "checked") return; recorded.current.set(`${c}|${j}`, r.savedAt ?? ""); if (live) setRecordedHere({ at: r.savedAt ?? "" }); }).catch(() => {});
    return () => { live = false; };
  }, [selectedCandidate?.id, selectedJob?.id, matchResult]);   // eslint-disable-line react-hooks/exhaustive-deps
  // A hiring manager cannot run a match; they read the latest one a recruiter ran. Nothing is calculated here.
  const showSavedMatch = (candidate: Candidate, job: Job) => api.savedMatch(candidate.id, job.id)
    .then((result) => { setMatchedCandidate(candidate); setMatchedJob(job); setMatchResult(result); onOpen(); })
    .catch((e) => toaster.create({ title: "No saved match", description: e instanceof ApiError ? e.message : "It could not be loaded. Try again shortly.", type: "info", closable: true }));

  /** Sets one candidate's status for one job (Shortlist, Not suitable, and the later stages on a job's shortlist). The person's other jobs are untouched. */
  const setStage = async (candidateId: string, jobId: string, status: string | null) => {
    try {
      const r = await api.setApplication(candidateId, jobId, status);
      savedHere(true); setApplications((cur) => [...cur.filter((a) => !(a.candidateId === candidateId && a.jobId === jobId)), ...(r.application ? [r.application] : [])]);
      if (r.candidate) { const c = r.candidate; setCandidateRecords((cur) => cur.map((x) => (x.id === c.id ? c : x))); setSelectedCandidate((cur) => (cur?.id === c.id ? c : cur)); setMatchedCandidate((cur: any) => (cur?.id === c.id ? c : cur)); }
      return true;
    } catch (e) {
      toaster.create({ title: "Not saved", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error", closable: true });
      return false;
    }
  };
  const decide = async (candidate: Candidate, job: Job, action: "shortlist" | "review-cv" | "not-suitable") => {
    if (action !== "shortlist" && action !== "not-suitable") return;
    const ok = await setStage(candidate.id, job.id, action === "shortlist" ? "shortlisted" : NOT_SUITABLE);
    if (ok) toaster.create({ title: action === "shortlist" ? `${candidate.name} shortlisted for ${job.title}` : `${candidate.name} marked not suitable for ${job.title}`, description: "Recorded as your decision for this job only, separately from the assessment.", type: action === "shortlist" ? "success" : "info" });
  };
  const handleRecruiterAction = async (action: "shortlist" | "request-information" | "review-cv" | "not-suitable") => {
    if (!matchedCandidate || !matchedJob || action === "request-information") return;
    await decide(matchedCandidate, matchedJob, action);
  };

  /** A job's saved shortlist: who a recruiter has shortlisted for it (or moved further), with the saved scores. Nothing is matched again. */
  // From a card's "Shortlisted for" line (owner, 17 Nov 2026: "a way to see what they were shortlisted for, not only on the job"): the saved match of
  // that person and that job, as recorded. Nothing is matched again.
  const openPairMatch = async (candidateId: string, jobId: string): Promise<void> => {
    const c = candidateRecords.find((x) => x.id === candidateId), j = jobRecords.find((x) => x.id === jobId);
    if (!c || !j) { toaster.create({ title: "Not on this board", description: `That ${nouns.job.one.toLowerCase()} is not in this portal any more. It may have been deleted.`, type: "info" }); return; }
    await showSavedMatch(c, j);
  };
  const openJobShortlist = async (job: Job) => {
    try {
      const rows = await api.jobShortlist(job.id);
      if (!rows.length) { toaster.create({ title: "Nobody is shortlisted for this job yet", description: "Match a candidate with it, then choose Shortlist.", type: "info" }); return; }
      const none = { score: 0, scoreCeiling: 0, band: "", confidence: "Low", confidenceScore: 0, confidenceReasons: [], evidence: [], matchingSkills: [], locationMatch: null, experienceYears: 0, recommendation: "", counts: { verified: 0, partial: 0, notDemonstrated: 0, contradicted: 0 }, disclaimer: "", warnings: [], engineVersion: "", rulesVersion: "", rulesFingerprint: "", ai: { state: "not_checked", reason: "No match has been run for this candidate and this job." } };
      setShortlistResults(rows.map((r) => ({ candidate: r.candidate, job: r.job, matchResult: r.matchResult ?? none })) as any);
      setShortlistType("job-to-candidates"); setSavedShortlistOf(job); onShortlistOpen();
    } catch (e) {
      toaster.create({ title: "The shortlist could not be opened", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error" });
    }
  };

  /** Deletes everything ticked in one list, one record at a time through the same route as a single delete, and says how many went. */
  const deletePicked = async (kind: "candidate" | "job") => {
    const ids = [...(picked[kind] ?? [])]; if (!ids.length) return;
    setBulk({ kind, busy: true });
    const gone: string[] = [];
    for (const id of ids) { try { await api.deleteRecord(kind === "candidate" ? "candidates" : "jobs", id); gone.push(id); } catch { /* counted below */ } }
    const removed = new Set(gone);
    savedHere(true);
    if (kind === "candidate") { setCandidateRecords((cur) => cur.filter((x) => !removed.has(x.id))); setSelectedCandidate((cur) => (cur && removed.has(cur.id) ? null : cur)); setMatchedCandidate((cur: any) => (cur && removed.has(cur.id) ? null : cur)); }
    else { setJobRecords((cur) => cur.filter((x) => !removed.has(x.id))); setSelectedJob((cur) => (cur && removed.has(cur.id) ? null : cur)); setMatchedJob((cur: any) => (cur && removed.has(cur.id) ? null : cur)); }
    setApplications((cur) => cur.filter((a) => !removed.has(kind === "candidate" ? a.candidateId : a.jobId)));
    setPicked((cur) => ({ ...cur, [kind]: null })); setBulk(null);
    const word = kind === "candidate" ? nouns.candidate : nouns.job, failed = ids.length - gone.length;
    toaster.create({ title: `${gone.length} ${(gone.length === 1 ? word.one : word.many).toLowerCase()} deleted`, description: failed ? `${failed} could not be deleted. Try those again.` : "The records, original files and match results were removed.", type: failed ? "warning" : "success", closable: true });
  };
  /** Asks the AI to read each ticked CV again (the same route as the panel's button); the earlier reading is kept, and each card updates when its reading is saved. */
  const [readingAgain, setReadingAgain] = useState<{ sent: number; of: number } | null>(null);
  const readAgainPicked = async () => {
    const ids = [...(picked.candidate ?? [])]; if (!ids.length) return;
    setReadingAgain({ sent: 0, of: ids.length });
    let queued = 0, lastError = "";
    for (const [n, id] of ids.entries()) {
      try { await api.readAgain(id); queued++; savedHere(); setCandidateRecords((cur) => cur.map((c) => (c.id === id ? { ...c, rereading: { since: new Date().toISOString() } } : c))); }
      catch (e) { lastError = e instanceof ApiError ? e.message : "The server could not be reached."; }
      setReadingAgain({ sent: n + 1, of: ids.length });
    }
    setReadingAgain(null); setPicked((cur) => ({ ...cur, candidate: null }));
    const failed = ids.length - queued, word = queued === 1 ? nouns.candidate.one : nouns.candidate.many;
    toaster.create({ title: `${queued} ${word.toLowerCase()} being read again`, description: failed ? `${failed} could not be started: ${lastError}` : "Each card shows Reading again… until its new reading is in, and the board updates by itself. Uploads open again when all are done.", type: failed ? "warning" : "success", closable: true });
  };
  /** Asks the AI to read each ticked job again from its original (jobs are read by the AI alone). A recruiter's own corrections stay. Each card is locked
   *  until its new reading is in, and the board updates by itself. */
  const [readingJobsAgain, setReadingJobsAgain] = useState<{ sent: number; of: number } | null>(null);
  const readJobsAgainPicked = async () => {
    const ids = [...(picked.job ?? [])]; if (!ids.length) return;
    setReadingJobsAgain({ sent: 0, of: ids.length });
    let done = 0, lastError = "";
    for (const [n, id] of ids.entries()) {
      try { await api.readJobAgain(id); done++; savedHere(); const mark = (x: Job) => (x.id === id ? { ...x, rereading: { since: new Date().toISOString() } } : x); setJobRecords((cur) => cur.map(mark)); setSelectedJob((cur) => (cur ? mark(cur) : cur)); }
      catch (e) { lastError = e instanceof ApiError ? e.message : "The server could not be reached."; }
      setReadingJobsAgain({ sent: n + 1, of: ids.length });
    }
    setReadingJobsAgain(null); setPicked((cur) => ({ ...cur, job: null }));
    const failed = ids.length - done, word = done === 1 ? nouns.job.one : nouns.job.many;
    toaster.create({ title: `${done} ${word.toLowerCase()} being read again`, description: failed ? `${failed} could not be started: ${lastError}` : "Each card shows Reading again… until its new reading is in, and the board updates by itself. Anything you corrected by hand is kept.", type: failed ? "warning" : "success", closable: true });
  };
  const togglePick = (kind: "candidate" | "job", id: string) => setPicked((cur) => { const next = new Set(cur[kind] ?? []); if (next.has(id)) next.delete(id); else next.add(id); return { ...cur, [kind]: next }; });

  const handleDirectMatch = (candidateId: string, jobId: string) => {
    const candidate = candidateRecords.find(c => c.id === candidateId);
    const job = jobRecords.find(j => j.id === jobId);
    
    if (candidate && job) {
      setSelectedCandidate(candidate);
      setSelectedJob(job);
    }
  };
  
  // 1 candidate against every role, or 1 role against every candidate. The window stays open until the AI has scored every one, and counts them as they
  // finish; the list opens only with final scores, in review order (owner, 9 Nov 2026).
  const handleShortlistMatch = (itemId: string | Candidate | Job, type: "candidate" | "job") => {
    const id = typeof itemId === "string" ? itemId : (itemId as { id: string }).id;
    if (progressRunning) return;
    // With more than one on the other side, the person chooses: all of them, or the ones they tick (MatchChooser).
    if ((type === "job" ? candidateRecords.length : jobRecords.length) > 1) setChooser({ id, type }); else void runShortlistMatch(id, type, null);
  };
  const runShortlistMatch = async (id: string, type: "candidate" | "job", only: string[] | null) => {
    if (progressRunning) return;
    lastRun.current = () => runShortlistMatch(id, type, only);
    const isCandidate = type === "candidate";
    const name = (isCandidate ? candidateRecords.find((c) => c.id === id)?.name : jobRecords.find((j) => j.id === id)?.title) ?? (isCandidate ? "this candidate" : "this role");
    const subject = isCandidate ? `Finding suitable roles for ${name}` : `Finding suitable candidates for ${name}`;
    startProgress(isCandidate
      ? { heading: "Finding role matches", subject, stages: ["Reading the candidate evidence", "Loading available roles", "Scoring each role with the AI", "Checking every requirement against the CV", "Putting them in review order"] }
      : { heading: "Finding candidate matches", subject, stages: ["Reading the role requirements", "Loading available candidates", "Scoring each candidate with the AI", "Checking every requirement against the CVs", "Putting them in review order"] });
    const run = cancellable();
    let sending = 0;   // pairs on their way to the server, for what a failure says (E-M5)
    try {
      const self = isCandidate ? await api.getCandidate(id) : await api.getJob(id); advance(1, 6);
      const everyone: (Candidate | Job)[] = isCandidate ? await api.jobs() : await api.candidates(); advance(1, 10);
      const others = only ? everyone.filter((o) => only.includes(o.id)) : everyone;
      if (!others.length) { setProgress(null); toaster.create({ title: "Nothing to compare", description: isCandidate ? "There are no jobs yet." : "There are no candidates yet.", type: "info" }); return; }
      const results: { candidate: Candidate; job: Job; matchResult: any }[] = new Array(others.length);
      let next = 0, sent = 0;
      const worker = async () => {
        while (!run.stopped && next < others.length) {
          const i = next++;
          const candidate = (isCandidate ? self : others[i]) as Candidate, job = (isCandidate ? others[i] : self) as Job;
          sending++;
          try { results[i] = { candidate, job, matchResult: await api.match(candidate.id, job.id) }; } finally { sending--; }
          run.add(results[i].matchResult);
          advance(2, 10 + 10 * (++sent / others.length));   // 10% to 20%: every pair handed to the AI
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, others.length) }, worker));
      if (run.stopped) return;
      const what = isCandidate ? "roles" : "candidates";
      const scored = await waitForScores(results.map((r) => r.matchResult), (done, total) => {
        advance(done / total < 0.6 ? 2 : 3, 20 + 76 * (done / total));   // 20% to 96% = scores that are final
        setProgress((p) => (p && p.status === "running" ? { ...p, subject: `${subject}: ${done} of ${total} ${what} scored` } : p));
      }, () => run.stopped);
      if (run.stopped) return;
      cancelRun.current = null;
      const final = results.map((r, i) => ({ ...r, matchResult: scored[i] }));
      // In the approved review order (src/utils/reviewOrder.ts), not the order the scores happened to finish in.
      const ordered = inReviewOrder(final, isCandidate ? "candidate-to-jobs" : "job-to-candidates");
      await completeProgress(() => { setShortlistResults(ordered as any); setShortlistType(isCandidate ? "candidate-to-jobs" : "job-to-candidates"); setSavedShortlistOf(null); onShortlistOpen(); });
    } catch (e) {
      cancelRun.current = null;
      if (!run.stopped) { run.stopped = true; failProgress(e, failedRunNote(run.ids.length, sending)); }
    }
  };

  const handleDrop = (e: React.DragEvent, targetType: "candidate" | "job") => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const type = e.dataTransfer.getData("type");

    if (type === "candidate" && targetType === "job") {
      const candidate = candidateRecords.find((c) => c.id === id);
      const job = selectedJob;
      if (candidate && job) {
        setSelectedCandidate(candidate);
        setSelectedJob(job);
      }
    } else if (type === "job" && targetType === "candidate") {
      const job = jobRecords.find((j) => j.id === id);
      const candidate = selectedCandidate;
      if (job && candidate) {
        setSelectedCandidate(candidate);
        setSelectedJob(job);
      }
    }
  };

  // A file in a batch of several has no row of its own: its batch's panel shows the whole upload (owner, 10 Nov 2026). The rest are single files, each
  // with its full card; several single files at once are one short list of one-line rows (owner, 8 Nov).
  const inPanel = new Set(batches.filter(panelShown).map((b) => b.id));   // a file whose batch panel is not shown keeps its own row
  const ownRow = (d: PendingDocument) => !d.batchId || !inPanel.has(d.batchId);
  const manyAtOnce = (kind: "cv" | "jd") => uploadingNow.filter((u) => u.kind === kind).length + documents.filter((d) => d.kind === kind && d.status === "processing" && !dismissedDocs.includes(d.id) && ownRow(d)).length > 1;
  const uploadingCards = (kind: "cv" | "jd") => uploadingNow.filter((u) => u.kind === kind).map((u) => (
    <DocumentProcessingCard key={u.id} fileName={u.fileName} documentType={kind === "cv" ? "CV" : "Job description"} stageIndex={-1} uploading compact={manyAtOnce(kind)} paused={u.paused} onCancel={() => { cancelledUploads.current.add(u.id); setUploadingNow((cur) => cur.filter((x) => x.id !== u.id)); }} />
  ));
  const documentCards = (kind: "cv" | "jd") => [...uploadingCards(kind), ...documents
    .filter((d) => d.kind === kind && !dismissedDocs.includes(d.id) && ownRow(d))
    .map((d) => d.status === "processing" ? (
      <DocumentProcessingCard key={d.id} compact={manyAtOnce(kind)} fileName={d.fileName} documentType={kind === "cv" ? "CV" : "Job description"}
        stageIndex={Math.max(0, rolematchConfig.processingStages.findIndex((st) => st.key === d.stage))} held={d.stage === "held"} />
    ) : d.status === "exception" ? (
      <AlertRoot key={d.id} status="warning" borderRadius="lg" alignItems="flex-start">
        <AlertIcon />
        <Box flex={1}>
          <Alert.Title fontSize="sm">{d.fileName} was not published</Alert.Title>
          <Alert.Description fontSize="sm">{d.errorMessage}</Alert.Description>
        </Box>
        <CloseButton onClick={() => { setDismissedDocs((cur) => [...cur, d.id]); api.dismissDocument(d.id).catch(() => setDismissedDocs((cur) => cur.filter((x) => x !== d.id))); }} />
      </AlertRoot>
    ) : null)];

  // Hidden (not unmounted) until the session is confirmed, so hook order never changes between renders.
  // The ways to narrow Who to match (MatchChooser): for a role, the people shortlisted for it, each other status people hold for it, those it has no
  // match with yet, and each department; for a person, the same from their side. Every filter is of this portal's own records.
  // The chooser's one filter: those on this role's shortlist (or the roles this person is on the shortlist for), as the board counts a shortlist.
  const chooserShortlisted = useMemo(() => {
    const forJob = chooser?.type === "job", role = nouns.job.one.toLowerCase();
    const ids = !chooser ? [] : forJob ? shortlistedFor(applications, chooser.id).map((a) => a.candidateId) : applications.filter((a) => a.candidateId === chooser.id && onShortlist(a.status)).map((a) => a.jobId);
    return { label: forJob ? `Shortlisted for this ${role}` : `${nouns.job.many} they are shortlisted for`, ids, none: forJob ? `Nobody is shortlisted for this ${role} yet.` : `Not shortlisted for any ${role} yet.` };
  }, [chooser, applications]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chooserSubject = chooser ? (chooser.type === "job" ? jobRecords.find((j) => j.id === chooser.id)?.title : candidateRecords.find((c) => c.id === chooser.id)?.name) ?? "" : "";
  return (
    <StagesContext.Provider value={{ all: applications, set: setStage, openShortlist: openJobShortlist, openMatch: openPairMatch, readOnly: viewOnly }}>
    {!authChecked && <Box position="fixed" inset={0} zIndex={2000}><BrandLoader label="Opening your board" /></Box>}
    <MatchChooser open={!!chooser} heading={chooser?.type === "job" ? `Who to match with ${chooserSubject}` : `Which ${nouns.job.many.toLowerCase()} to match ${chooserSubject} with`}
      noun={(chooser?.type === "job" ? nouns.candidate.many : nouns.job.many).toLowerCase()}
      choices={chooser?.type === "job" ? candidateRecords.map((c) => ({ id: c.id, title: c.name, subtitle: displayCase(c.role, c.displayNames) })) : jobRecords.map((j) => ({ id: j.id, title: displayCase(j.title), subtitle: displayCase(j.company) }))}
      shortlisted={chooserShortlisted}
      onClose={() => setChooser(null)} onMatch={(ids) => { const c = chooser; setChooser(null); if (c) void runShortlistMatch(c.id, c.type, ids); }} />
    <ConfirmBulkDelete count={bulk ? picked[bulk.kind]?.size ?? 0 : 0} noun={(bulk?.kind === "job" ? nouns.job.many : nouns.candidate.many).toLowerCase()} busy={!!bulk?.busy}
      what={bulk?.kind === "job" ? "Each job, its original file and its match results are removed." : "Each record, its original CV and its match results are removed."}
      onClose={() => setBulk(null)} onConfirm={() => bulk && deletePicked(bulk.kind)} />
    <Box bg={bgPage} bgImage={boardGlow} minH="100vh" visibility={authChecked ? "visible" : "hidden"}>
      <DashboardNavbar onHelpClick={onTutorialOpen} view="board" />
      {changeReasonDialog}
      <BatchSummaryDialog batch={summary?.batch ?? null} report={summary?.report ?? null} onClose={() => closeSummary(true)} onDownload={downloadReport}
        onReview={() => { if (summary?.batch.kind === "jd") setJobsNeedReview(true); else setCandidatesNeedReview(true); closeSummary(true); }}
        onRetry={() => { const id = summary?.batch.id; if (!id) return; shownSummaries.current.delete(id); closeSummary(false); api.retryBatch(id).then((r) => setBatches((cur) => cur.map((x) => (x.id === id ? r.view : x)))).catch(() => toaster.create({ title: "Could not retry", type: "error" })); }} />
      {(choosing || noPortal) && (
        <Container maxW="640px" py={12} className="rm-reveal">
          {choosing ? (<>
            <Text fontSize="2xl" fontWeight="bold">Choose a portal</Text>
            <Text color="fg.muted" mt={1} mb={5}>You can work in {choosing.length} portals{orgLabel ? ` of ${orgLabel}` : ""}. Each has its own candidates, jobs and upload slots; you can switch later from the board.</Text>
            <Stack as="ul" gap={3} listStyleType="none">{choosing.map((p) => (
              <Box as="li" key={p.id}><Box as="button" w="full" textAlign="left" p={4} borderWidth="1px" borderRadius="lg" bg={cardBg} _hover={{ borderColor: "blue.400" }} transition="border-color .32s cubic-bezier(.16,1,.3,1)"
                onClick={() => { selectPortal(p.id); window.location.reload(); }}>
                <Text fontWeight="semibold">{p.name}</Text>
                <Text fontSize="sm" color="fg.muted">Your role: {p.role === "admin" ? "Administrator" : p.role === "hiring_manager" ? "Hiring manager / HR (read-only)" : "Recruiter"}</Text>
              </Box></Box>))}</Stack>
          </>) : (<>
            <Text fontSize="2xl" fontWeight="bold">You are not in a portal yet</Text>
            <Text color="fg.muted" mt={2}>Your account belongs to {orgLabel || "your organisation"}, but nobody has given you access to one of its portals. Ask an administrator to invite you; the invitation arrives by e-mail with its own link.</Text>
          </>)}
        </Container>)}
      <Box py={4} display={choosing || noPortal ? "none" : undefined}>
        <Container maxW="100%" mx="auto" px={{ base: 3, lg: 4, xl: 6 }}>
          {portals && portals.length > 1 && (
            <Flex mb={3} align="center" gap={2} fontSize="sm">
              <label htmlFor="portal-select" style={{ fontWeight: 600 }}>Portal</label>
              <select id="portal-select" value={selectedPortal() ?? portals[0].id} onChange={(e) => { selectPortal(e.target.value); window.location.reload(); }} style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--chakra-colors-border, #cbd5e0)", background: "transparent", color: "inherit" }}>
                {portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Text color="text.secondary">Each portal has its own candidates, jobs, batches and upload slots.</Text>
            </Flex>)}
          {/* Shortlist Matching Zone */}
          <Box mb={4} position="relative" data-reveal>
            {!viewOnly && <MatchShortlistZone onMatchMultiple={handleShortlistMatch} candidates={candidateRecords} jobs={jobRecords} busy={progressRunning ? { name: "", against: "" } : null} />}
            
            {/* Help tooltip for shortlist zone */}
            <HoverCard.Root openDelay={200} closeDelay={200} positioning={{ placement: "top-end", gutter: ARROW_GUTTER }}>
              <HoverCard.Trigger asChild>
                <Box position="absolute" top={2} right={2} cursor="pointer">
                  <QuestionIcon color="blue.500" />
                </Box>
              </HoverCard.Trigger>
              <HoverCard.Positioner>
              <HoverCard.Content className="rm-hinge" width="250px" shadow="lg">
                <HoverCard.Arrow><HoverCard.ArrowTip /></HoverCard.Arrow>
                <chakra.header px={3} py={2} borderBottomWidth="1px" fontWeight="semibold">Shortlist Zone</chakra.header>
                <Box px={3} py={2}>
                  Drag a candidate here to match against all jobs, or drag a job here to match against all candidates.
                </Box>
              </HoverCard.Content>
              </HoverCard.Positioner>
            </HoverCard.Root>
          </Box>

          {selectedCandidate && selectedJob && (
            <Flex
              mb={4}
              px={{ base: 4, md: 5 }}
              py={3}
              bg={useColorModeValue("green.50", "green.900")}
              border="1px solid"
              borderColor={useColorModeValue("green.200", "green.700")}
              borderRadius="lg"
              align={{ base: "stretch", md: "center" }}
              justify="space-between"
              direction={{ base: "column", md: "row" }}
              gap={3}
            >
              <Box>
                <Text fontSize="xs" fontWeight="700" color={useColorModeValue("green.700", "green.200")} textTransform="uppercase" letterSpacing="0.08em">{recordedHere ? `Already assessed${recordedHere.at ? ` · ${shortDate(recordedHere.at)}` : ""}` : "Ready to assess"}</Text>
                <Text fontWeight="600">{selectedCandidate.name} <Text as="span" fontWeight="400" color={useColorModeValue("green.800", "green.100")}>with</Text> {selectedJob.title}{selectedJob.company ? <Text as="span" fontWeight="400"> · {selectedJob.company}</Text> : null}</Text>
              </Box>
              <Button tone="green.600" px={8} loading={progressRunning} loadingText="Matching" onClick={() => (viewOnly || recordedHere ? showSavedMatch(selectedCandidate, selectedJob) : handleMatch(selectedCandidate, selectedJob))}>{viewOnly ? "Show saved match" : recordedHere ? "View assessment" : "Match"}</Button>
            </Flex>
          )}

          {/* Where you are (portal / board) and the portal's shared upload allowance: their own row, clear of the matching zone */}
          <Flex justify="space-between" align="center" gap={2} wrap="wrap" mb={3} data-reveal>
            <Box bg={useColorModeValue("white", "gray.800")} py={1} px={3} borderRadius="md" shadow="sm" borderWidth="1px" borderColor={useColorModeValue("gray.100", "gray.700")}>
              <Flex align="center" fontSize="sm" color={useColorModeValue("gray.600", "gray.400")}>
                {activePortal ? <Text title="The portal you are working in: its candidates, jobs, batches and upload slots are its own">{activePortal.name}</Text> : <Text>Dashboard</Text>}
                <Text mx={2}>/</Text>
                {/* While the board shows what an Overview block asked for, its own name takes it back to the whole board. */}
                {focus ? <Box as="button" {...({ type: "button" } as object)} onClick={clearFocus} fontWeight="medium" color={useColorModeValue("blue.600", "blue.300")} textDecoration="underline" textUnderlineOffset="3px" cursor="pointer" title="Back to the full board">Matching Board</Box>
                  : <Text fontWeight="medium" color={useColorModeValue("blue.600", "blue.300")}>Matching Board</Text>}
              </Flex>
            </Box>
            <CapacityBar capacity={capacity} stale={capacityStale} staleSeconds={Math.round((now - capacityAt) / 1000)} />
          </Flex>

          {loadError && (
            <Flex role="alert" align="center" justify="space-between" gap={3} wrap="wrap" mb={3} p={3} borderRadius="md" borderWidth="1px" borderColor="orange.300" bg={useColorModeValue("orange.50", "rgba(251,146,60,0.08)")}>
              <Text fontSize="sm">The board could not be loaded, so nothing is listed below. Nothing has been removed. {loadError}</Text>
              <Button size="sm" variant="outline" onClick={() => reload().catch(() => {})}>Try again</Button>
            </Flex>)}
          {/* Without its settings the board falls back to raw status names, no status choices and only notes and status editable; it says so instead of
              looking like an organisation with no settings (code review, 16 Nov 2026, G-M5). */}
          {settingsCtx.failed && (
            <Flex role="alert" align="center" justify="space-between" gap={3} wrap="wrap" mb={3} p={3} borderRadius="md" borderWidth="1px" borderColor="orange.300" bg={useColorModeValue("orange.50", "rgba(251,146,60,0.08)")} data-testid="settings-failed">
              <Text fontSize="sm">Your organisation's settings could not be loaded, so status names, status choices and what can be edited are not shown as your organisation set them. Nothing has been changed.</Text>
              <Button size="sm" variant="outline" onClick={() => void settingsCtx.reload()}>Try again</Button>
            </Flex>)}

          {focus && (
            <Flex className="rm-reveal" role="status" align="center" gap={3} mb={3} px={4} py={2} borderRadius="xl" borderWidth="1px" borderColor="teal.500" bg={focusBg}>
              <Text fontSize="sm"><Text as="span" color="fg.muted">Showing from the Overview: </Text><Text as="span" fontWeight="semibold">{focus.label}</Text>
                <Text as="span" color="fg.muted"> · {filteredCandidates.length} {filteredCandidates.length === 1 ? nouns.candidate.one.toLowerCase() : nouns.candidate.many.toLowerCase()}, {filteredJobs.length} {filteredJobs.length === 1 ? nouns.job.one.toLowerCase() : nouns.job.many.toLowerCase()}</Text></Text>
              <Button size="sm" ml="auto" onClick={clearFocus} data-testid="show-whole-board">Show the whole board</Button>
            </Flex>
          )}

          {/* Main Content */}
          <Grid data-reveal-children
            // Four columns only where both panels get a readable width (from 1280 px); between 992 and 1280 px, two: each list beside its own panel
            // (candidates with the candidate panel, then the job panel with the jobs). At 1000 px four columns left each panel under 200 px wide (10 Nov 2026).
            templateColumns={{
              base: "minmax(0, 1fr)",
              // The two lists a little wider (owner, 10 Nov 2026: "a tad bit wider"), so a card shows its location, skills and dates without cutting them short.
              lg: "minmax(250px, 0.95fr) minmax(0, 1.5fr)",
              xl: "minmax(250px, 1fr) minmax(0, 1.15fr) minmax(0, 1.15fr) minmax(250px, 1fr)",
            }}
            // Where all four columns stand side by side they are one height and fill the screen below the header (owner, 10 Nov 2026: "fill the panels out
            // a bit more"): the lists scroll inside, the empty panel reaches the bottom, and nothing stops short of its neighbour. A column with more in it
            // (files being read) makes the row taller rather than overflowing.
            gridTemplateRows={{ xl: "minmax(max(640px, calc(100vh - 100px)), auto)" }}
            gap={{ base: 3, xl: 4 }}
            width="100%"
            minW={0}
            position="relative"
          >
            {/* Left Column - Candidates List */}
            <Box
              p={4}
              minW={0}
              bg={useColorModeValue("white", "gray.800")}
              rounded="lg"
              shadow="md"
              height={{ base: "fit-content", xl: "auto" }}
              display="flex"
              flexDirection="column"
              borderWidth="1px"
              borderColor={useColorModeValue("gray.200", "gray.700")}
            >
              <VStack gap={3} align="stretch" mb={4}>
                <Text fontSize="xl" fontWeight="bold">
                  {nouns.candidate.many} ({loadError ? "not loaded" : filteredCandidates.length})
                </Text>
                {listCap.cands && !loadError && <ListCapNotice cap={listCap.cands} noun={nouns.candidate.many.toLowerCase()} />}
                {!viewOnly && <BulkBar picking={!!picked.candidate} count={picked.candidate?.size ?? 0} shown={filteredCandidates.length} onStart={() => setPicked((c) => ({ ...c, candidate: new Set() }))}
                  onAll={() => setPicked((c) => ({ ...c, candidate: new Set(filteredCandidates.map((x) => x.id)) }))} onDelete={() => setBulk({ kind: "candidate", busy: false })} onCancel={() => setPicked((c) => ({ ...c, candidate: null }))} onReadAgain={readAgainPicked} readingAgain={readingAgain} />}
                {rolematchConfig.review.showPrompts && candidatesFlagged > 0 && (
                  <Button size="xs" variant={candidatesNeedReview ? "solid" : "outline"} colorPalette="orange" alignSelf="flex-start" onClick={() => setCandidatesNeedReview((v) => !v)}>
                    {candidatesNeedReview ? "Showing" : "Show only"} needs review ({candidatesFlagged})
                  </Button>
                )}
                <InputGroup size="md" startElement={<SearchIcon color="gray.400" />} startElementProps={{ pointerEvents: "none" }}>
                  <Input 
                    placeholder="Search by name, role, or skills" 
                    value={candidateFilters.searchTerm}
                    onChange={(e) => setCandidateFilters({...candidateFilters, searchTerm: e.target.value})}
                  />
                </InputGroup>
                <HStack gap={2} w="100%">
                  <FilterSelect name="Location" value={candidateFilters.location} options={candidateLocations} label={displayCase} onChange={(v) => setCandidateFilters({ ...candidateFilters, location: v })} />
                  <FilterSelect name={selectedJob ? "Status for role" : "Status"} hint={selectedJob ? `for ${displayCase(selectedJob.title)}` : "for any role"} value={candidateFilters.status} options={candidateStatuses} label={settingsCtx.statusLabel} onChange={(v) => setCandidateFilters({ ...candidateFilters, status: v })} />
                </HStack>
                <HStack w="100%"><FilterSelect name="Departments" value={candidateFilters.department} options={candidateDepartments} onChange={(v) => setCandidateFilters({ ...candidateFilters, department: v })} /></HStack>
              </VStack>
              <Stack gap={2} maxH={{ base: "650px", xl: "none" }} flex={{ xl: "1 1 0" }} minH={{ xl: 0 }} css={FILLS_COLUMN} overflowY="auto" pr={2}>
                {!loadError && filteredCandidates.length === 0 && authChecked && <Text fontSize="sm" color="fg.muted" py={2}>{candidateRecords.length === 0 ? (access === "view" ? `No ${nouns.candidate.many.toLowerCase()} have been shortlisted in this portal yet.` : `No ${nouns.candidate.many.toLowerCase()} in this portal yet.`) : "None match these filters."}</Text>}
                {filteredCandidates.map((candidate) => (
                  // The card itself selects the record, and takes no click while it is being read again ("Locked until the new reading is in"). This
                  // wrapper used to select it as well, so a click on a locked card still opened it with Edit (code review, 16 Nov 2026, E-M3).
                  <Box key={candidate.id}>
                    <Pickable picking={!!picked.candidate} picked={!!picked.candidate?.has(candidate.id)} onToggle={() => togglePick("candidate", candidate.id)}>
                    <CandidateCard
                      candidate={candidate}
                      isSelected={selectedCandidate?.id === candidate.id}
                      onClick={() => setSelectedCandidate(candidate)}
                      onJobMatch={handleDirectMatch}
                      onFindMatches={viewOnly ? undefined : (cid) => handleShortlistMatch(cid, "candidate")}
                    />
                    </Pickable>
                  </Box>
                ))}
              </Stack>
            </Box>

            {/* Candidate Details Column */}
            <VStack gap={4} align="stretch" minW={0}>
              {viewOnly ? <AccessNotice access={access} onRetry={loadPortals} /> : <DropZone 
                onFileUpload={(file) => handleFileUpload("cv", file)} 
                onFilesUpload={(files) => handleFilesUpload("cv", files)}
                locked={blockedFor()}
                label="Upload CVs"
              />}
              {batchPanels("cv")}
              {manyAtOnce("cv") ? <Box borderWidth="1px" borderRadius="xl" px={4} py={1} maxH="340px" overflowY="auto" aria-label="Files being read">{documentCards("cv")}</Box> : documentCards("cv")}
              <CenterPanel 
                selectedCandidate={selectedCandidate} 
                selectedJob={null}
                onClear={() => setSelectedCandidate(null)} 
                onCandidateChange={viewOnly ? undefined : saveCandidate}
                onCandidateReview={selectedCandidate && !viewOnly ? () => confirmCandidateReview(selectedCandidate) : undefined}
                onCandidateDelete={selectedCandidate && !viewOnly ? () => removeCandidate(selectedCandidate) : undefined}
                onDrop={(e) => handleDrop(e, "candidate")}
                dropType="candidate"
              />
            </VStack>

            {/* Job Details Column: in two columns it sits in the wide one, after the jobs list (order), in four it keeps its place */}
            <VStack gap={4} align="stretch" minW={0} order={{ lg: 4, xl: 0 }}>
              {viewOnly ? <AccessNotice access={access} onRetry={loadPortals} /> : <DropZone 
                onFileUpload={(file) => handleFileUpload("jd", file)} 
                onFilesUpload={(files) => handleFilesUpload("jd", files)}
                locked={blockedFor()}
                label={`Upload ${nouns.job.one.toLowerCase()} descriptions`}
              />}
              {batchPanels("jd")}
              {manyAtOnce("jd") ? <Box borderWidth="1px" borderRadius="xl" px={4} py={1} maxH="340px" overflowY="auto" aria-label="Files being read">{documentCards("jd")}</Box> : documentCards("jd")}
              <CenterPanel 
                selectedCandidate={null} 
                selectedJob={selectedJob}
                onClear={() => setSelectedJob(null)} 
                onJobChange={viewOnly ? undefined : saveJob}
                onJobReview={selectedJob && !viewOnly ? () => confirmJobReview(selectedJob) : undefined}
                onJobDelete={selectedJob && !viewOnly ? () => removeJob(selectedJob) : undefined}
                onDrop={(e) => handleDrop(e, "job")}
                dropType="job"
              />
            </VStack>

            {/* Right Column - Jobs List */}
            <Box
              p={4}
              minW={0}
              order={{ lg: 3, xl: 0 }}
              bg={useColorModeValue("white", "gray.800")}
              rounded="lg"
              shadow="md"
              height={{ base: "fit-content", xl: "auto" }}
              display="flex"
              flexDirection="column"
              borderWidth="1px"
              borderColor={useColorModeValue("gray.200", "gray.700")}
            >
              <VStack gap={3} align="stretch" mb={4}>
                <Text fontSize="xl" fontWeight="bold">
                  {nouns.job.many} ({loadError ? "not loaded" : filteredJobs.length})
                </Text>
                {listCap.jobs && !loadError && <ListCapNotice cap={listCap.jobs} noun={nouns.job.many.toLowerCase()} />}
                {!viewOnly && <BulkBar picking={!!picked.job} count={picked.job?.size ?? 0} shown={filteredJobs.length} onStart={() => setPicked((c) => ({ ...c, job: new Set() }))}
                  onAll={() => setPicked((c) => ({ ...c, job: new Set(filteredJobs.map((x) => x.id)) }))} onDelete={() => setBulk({ kind: "job", busy: false })} onCancel={() => setPicked((c) => ({ ...c, job: null }))} onReadAgain={readJobsAgainPicked} readingAgain={readingJobsAgain} />}
                {rolematchConfig.review.showPrompts && jobsFlagged > 0 && (
                  <Button size="xs" variant={jobsNeedReview ? "solid" : "outline"} colorPalette="orange" alignSelf="flex-start" onClick={() => setJobsNeedReview((v) => !v)}>
                    {jobsNeedReview ? "Showing" : "Show only"} needs review ({jobsFlagged})
                  </Button>
                )}
                <InputGroup size="md" startElement={<SearchIcon color="gray.400" />} startElementProps={{ pointerEvents: "none" }}>
                  <Input 
                    placeholder="Search by title, company, or skills" 
                    value={jobFilters.searchTerm}
                    onChange={(e) => setJobFilters({...jobFilters, searchTerm: e.target.value})}
                  />
                </InputGroup>
                <HStack gap={2} w="100%">
                  <FilterSelect name="Location" value={jobFilters.location} options={jobLocations} label={displayCase} onChange={(v) => setJobFilters({ ...jobFilters, location: v })} />
                  <FilterSelect name="Departments" value={jobFilters.department} options={jobDepartments} onChange={(v) => setJobFilters({ ...jobFilters, department: v })} />
                </HStack>
              </VStack>
              <Stack gap={2} maxH={{ base: "650px", xl: "none" }} flex={{ xl: "1 1 0" }} minH={{ xl: 0 }} css={FILLS_COLUMN} overflowY="auto" pr={2}>
                {!loadError && filteredJobs.length === 0 && authChecked && <Text fontSize="sm" color="fg.muted" py={2}>{jobRecords.length === 0 ? `No ${nouns.job.many.toLowerCase()} in this portal yet.` : "None match these filters."}</Text>}

                {filteredJobs.map((job) => (
                  // The card itself selects the job and takes no click while it is being read again; this wrapper no longer selects it too (E-M3).
                  <Box key={job.id}>
                    <Pickable picking={!!picked.job} picked={!!picked.job?.has(job.id)} onToggle={() => togglePick("job", job.id)}>
                    <JobCard
                      job={job}
                      isSelected={selectedJob?.id === job.id}
                      onClick={() => setSelectedJob(job)}
                      onCandidateMatch={handleDirectMatch}
                      onFindMatches={viewOnly ? undefined : (jid) => handleShortlistMatch(jid, "job")}
                    />
                    </Pickable>
                  </Box>
                ))}
              </Stack>
            </Box>
          </Grid>
        </Container>

        {/* Match Result Modal */}
        {/* Single Match Modal */}
        <AssessmentDialog open={isOpen} onClose={onClose} who={matchedCandidate?.name} what={matchedJob?.title}>
          {matchedCandidate && matchedJob && matchResult && <CandidateMatchPanel candidate={matchedCandidate} job={matchedJob} result={matchResult} onAction={viewOnly ? undefined : handleRecruiterAction} />}
        </AssessmentDialog>
        
        {welcomeBack !== null && <WelcomeBackBar name={welcomeBack} />}
        <MatchProgressOverlay state={progress} onCancel={() => cancelRun.current?.()} onRetry={() => lastRun.current()} onClose={() => setProgress(null)} onFinished={() => { finishedRef.current?.(); finishedRef.current = null; }} />

        {/* Shortlist Results Modal */}
        {/* Chakra 2's size 5xl; the width given here (1200px) is the one that applies */}
        <Dialog.Root 
          open={isShortlistOpen} 
          onOpenChange={(e) => { if (!e.open) onShortlistClose(); }} 
          scrollBehavior="inside"
        >
          <Portal>
          <Dialog.Backdrop backdropFilter="blur(10px)" />
          <Dialog.Positioner>
          <Dialog.Content borderRadius="xl" maxW="1200px">
            <Dialog.Body p={0}>
              {shortlistResults.length > 0 && (
                <ShortlistResults
                  results={shortlistResults}
                  matchType={shortlistType}
                  onClose={onShortlistClose}
                  saved={!!savedShortlistOf}
                  onDecide={viewOnly ? undefined : decide}
                />
              )}
            </Dialog.Body>
          </Dialog.Content>
          </Dialog.Positioner>
          </Portal>
        </Dialog.Root>
        
        {/* Getting Started Tutorial Modal */}
        <GettingStartedModal isOpen={isTutorialOpen} onClose={onTutorialClose} readOnly={viewOnly} />
      </Box>
    </Box>
    </StagesContext.Provider>
  );
};

export default Dashboard;
