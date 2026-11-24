import type { Candidate, Job } from "@/types/records";
import type { SettingsResponse } from "../settings/types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public retryAfterSec?: number) { super(message); }
}

/** The portal this browser is working in. Only a REQUEST: the server checks membership on every call and the database enforces it. */
// Which portal this tab is in. Each tab keeps its own: with one choice shared between tabs, switching portal in one silently moved the others, whose next read or upload then went somewhere their screen did not show (register R117). A new tab starts from the last choice made anywhere.
export const selectedPortal = (): string | null => { try { return sessionStorage.getItem("rolematch.portal") ?? localStorage.getItem("rolematch.portal"); } catch { return null; } };
export const selectPortal = (id: string | null) => { for (const store of [() => sessionStorage, () => localStorage]) { try { if (id) store().setItem("rolematch.portal", id); else store().removeItem("rolematch.portal"); } catch { /* storage unavailable: the server's default portal is used */ } } };

/** A request that a person is waiting on can be given a bounded wait; when it runs out the caller gets code "TIMEOUT" (the server may still have acted, so callers must not assume either way). */
let changes: BroadcastChannel | null = null;
try { changes = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("rolematch-changes") : null; } catch { changes = null; }
const boardChanged = () => { try { changes?.postMessage("changed"); } catch { /* another tab may have closed it */ } window.dispatchEvent(new Event("rolematch:changed")); };
/** Calls `fn` when a change is saved in this browser, in this tab or another. Returns the way to stop listening. */
export function onBoardChange(fn: () => void): () => void {
  const local = () => fn(); window.addEventListener("rolematch:changed", local);
  let ch: BroadcastChannel | null = null; try { ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("rolematch-changes") : null; if (ch) ch.onmessage = () => fn(); } catch { ch = null; }
  return () => { window.removeEventListener("rolematch:changed", local); ch?.close(); };
}
/** `quiet`: a request that changes nothing on the board (a status check, signing in, a lookup), so it must not tell the Overview to fetch its figures again. */
async function request<T>(path: string, init: RequestInit & { timeoutMs?: number; quiet?: boolean } = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const { timeoutMs, quiet, ...rest } = init;
  let res: Response;
  // A server too busy to take the request says so before doing anything (x-rolematch-not-started), so asking again is always safe: the person waits a
  // few seconds instead of seeing an error (owner, 23 Nov 2026, after the load test: "it shouldn't be a cap"). Each wait is the server's own, spread a
  // little so a crowd does not come back all at once; after four tries the busy answer is shown as before.
  for (let attempt = 1; ; attempt++) {
  try { res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    ...rest,
    headers: { "x-client-contract": "1", ...(init.body && !isForm ? { "content-type": "application/json" } : {}), ...(selectedPortal() ? { "x-portal-id": selectedPortal()! } : {}), ...(init.headers ?? {}) },
  }); } catch (e: any) {
    if (timeoutMs && (e?.name === "TimeoutError" || e?.name === "AbortError")) throw new ApiError(0, "TIMEOUT", "This is taking longer than usual. Nothing is lost, and what you asked for may still happen: wait a minute and check before asking again.");
    throw e;
  }
  if (res.status !== 503 || res.headers.get("x-rolematch-not-started") !== "1" || attempt >= 4) break;
  const waitSec = Number(res.headers.get("retry-after")) || 5;
  await new Promise((r) => setTimeout(r, waitSec * 1000 * (0.5 + Math.random() * 0.5)));
  }
  // A change saved here tells an Overview open in this browser at once, so it shows the new figures without waiting for its next check (owner, 10 Nov 2026:
  // "if I do something in the matching board ... it should immediately reflect that side"). Only that a change happened, never what it was.
  // Only a request that saves a change says so: a POST that only reads (the AI-status check polled every 3 s while matches are scored) or that signs in
  // used to say so too, and every Overview open in the browser then fetched its figures again each time (code review, 16 Nov 2026, E-M9).
  if (res.ok && !quiet && (rest.method ?? "GET") !== "GET") boardChanged();
  // While the main database is unreachable the server reads from a copy and pauses saving; ReadOnlyNotice shows that to the recruiter.
  window.dispatchEvent(new CustomEvent("rolematch:mode", { detail: { mode: res.headers.get("x-rolematch-mode") === "read-only" ? "read-only" : "normal", copyAt: res.headers.get("x-rolematch-copy-at") ?? "" } }));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `Request failed (${res.status})`, body?.error?.requestId, Number(res.headers.get("retry-after")) || undefined);
    // SessionGuard asks the person to log in again where they are, so nothing on the page is lost (AUTH-005: the session ran its full length)
    if (res.status === 401) window.dispatchEvent(new CustomEvent("rolematch:signed-out", { detail: { code: error.code, message: error.message } }));
    throw error;
  }
  const body = await res.json();
  // When this sign-in ends (8 hours from signing in): every sign-in and "who am I" answer carries it
  if (body?.session?.endsAt) window.dispatchEvent(new CustomEvent("rolematch:session", { detail: { ...body.session, user: body.user } }));
  return body;
}

interface Page<T> { items: T[]; nextCursor: string | null; total: number }

/** The server sends lists in pages; the dashboard works on the whole list, so read every page (up to a safety cap). */
const NAME_UNCONFIRMED = "Name not confirmed";
/** A record whose name could not be confirmed stays blank on the server, so nothing is ever saved as if it were a person's name. Lists and panels show this wording in its place. */
const forDisplay = (c: Candidate): Candidate => (c.name ? c : { ...c, name: NAME_UNCONFIRMED, nameUnconfirmed: true });
const forSaving = ({ nameUnconfirmed, ...c }: Candidate): Candidate => (nameUnconfirmed && c.name === NAME_UNCONFIRMED ? { ...c, name: "" } : c);

/** Lists read only in part because they reached the safety cap, with how many there are in all. Held beside the list, never inside it. */
const capped = new WeakMap<object, { shown: number; total: number }>();
/** Whether this list stopped at the safety cap (and how many records there are in all), so the board can say it is incomplete; null when it is whole. */
export const listCapped = (list: object | null | undefined): { shown: number; total: number } | null => (list && capped.get(list)) || null;
const keepCap = <A extends object>(from: object, to: A): A => { const c = capped.get(from); if (c) capped.set(to, c); return to; };

/** `fresh`: the caller knows something has changed, so it must not be given the page the portal shares for people arriving. */
async function allPages<T>(path: string, fresh = false): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null, total = 0;
  for (let i = 0; i < 50; i++) {
    const page: Page<T> = await request<Page<T>>(`${path}?limit=100${fresh ? "&fresh=1" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...page.items);
    cursor = page.nextCursor; total = page.total;
    if (!cursor) break;
  }
  // Past the cap the rest used to be left out without a word, while the board counted what it had as if it were everything (code review, 16 Nov 2026,
  // E-M10). The list is still the first 5,000, newest first; it is now marked, and the board says so.
  if (cursor) capped.set(out, { shown: out.length, total: Math.max(total, out.length) });
  return out;
}

/** Where Claude's scoring of a saved match stands (server/src/aiMatch.ts): pending until it is scored, checked once the final score is in, not_checked when it
 *  could not be scored (with the reason). Matching is the AI's alone: a match that is not checked has no score. */
export interface AiCheck { state: "pending" | "checked" | "not_checked"; model?: string; reason?: string; at?: string }
export interface Application { id: string; candidateId: string; jobId: string; jobTitle: string; jobCompany?: string; status: string; updatedAt: string }
export type EvidenceState = "verified" | "partial" | "not_demonstrated" | "contradicted" | "not_applicable";
export interface ReviewFlag { code: string; kind: "fairness" | "justification" | "unclear" | "excessive"; matched: string; reason: string }
export interface MatchEvidence { judgedBy?: "ai"; importance?: "must_have" | "important" | "nice_to_have"; inferred?: boolean; dimension?: "role" | "experience" | "skills" | "qualification"; credit?: { low: number; exp: number; high: number }; duplicateOf?: string; label: string; state: EvidenceState; points: number; possible: number; explanation: string; source?: string; mandatory?: boolean; share?: number; pointsProved?: number; covered?: number; reviewFlags?: ReviewFlag[]; reason?: string }
export type LogisticsStatus = "compatible" | "to_confirm" | "conflict" | "not_required";
export type PlaceLevel = "same city" | "same province" | "same country" | "different country" | "unknown";
export interface Logistics { arrangement: "on-site" | "hybrid" | "remote" | "not stated"; required: boolean; status: LogisticsStatus; level?: PlaceLevel; checks: { label: string; status: LogisticsStatus; explanation: string; source?: string; level?: PlaceLevel }[] }
export interface EmploymentEvidence {
  version: number; employment: { state: string; reasons: string[] } | null; originalDocumentUrl: string | null;
  unconfirmedRoles: { position: string; company: string; startDate?: string; endDate?: string }[];
  roles: { index: number; position: string; company: string; startDate?: string; endDate?: string; status: string | null; agreement: string | null; rulesReading: { position: string; company: string } | null; pages: number[]; lines: { n: number; text: string; cited: boolean }[] }[];
}
export interface MatchResult {
  /** Claude's scoring, and what it says the recruiter should check or ask next. */
  ai?: AiCheck; actions?: string[];
  /** The recruiter's brief of the job, and the AI's view of the career as a whole against it. */
  brief?: { role: string; seniority: string; industry: string };
  career?: { seniority: "below" | "matches" | "above"; industry: "same" | "related" | "different"; recency: "current" | "within five years" | "older" | "none"; note: string };
  id?: string; assessment?: { state: "complete" | "incomplete"; reasons: string[]; affected: string[] }; candidateVersion?: number; jobVersion?: number; score: number; scoreFloor?: number; scoreCeiling: number; band: string; confidence: "High" | "Medium" | "Low"; confidenceScore: number; confidenceReasons: string[];
  evidence: MatchEvidence[]; matchingSkills: string[]; locationMatch: boolean | null; experienceYears: number;
  recommendation: string; counts: { verified: number; partial: number; notDemonstrated: number; contradicted: number }; disclaimer: string; warnings: string[]; engineVersion: string; rulesVersion: string; rulesFingerprint: string;
  coverage?: number; logistics?: Logistics; referenceDate?: string; context?: string[];
  /** The warnings with a code; consequential ones stay in view, the rest belong with the method notes. */
  notices?: { code: string; text: string; consequential: boolean }[];
  /** The at-a-glance view, written by the server from the structured assessment only. */
  overview?: { summary: string; strengths: string[]; gaps: { label: string; state: EvidenceState; reason: string }[] };
}
export interface BatchView {
  id: string; kind: "cv" | "jd"; createdAt: string; cancelledAt: string | null; closedAt: string | null; complete: boolean; active: boolean; abandoned: boolean; createdBy: string; submittedByEmail: string; reservedSlots: number; reservationState: "held" | "released"; finishedAt: string | null; parentBatchId: string | null; notYetSent: number;
  counts: { declared: number; received: number; waiting: number; processing: number; completed: number; needsReview: number; failed: number; blocked: number; cancelled: number; duplicates: number; refused: number };
  refusals: { fileName: string; code: string; message: string; reference?: string }[];
  /** `retryable`: asking again can fix it (server/src/batches.ts, RETRYABLE); otherwise the document itself needs replacing. */
  failures: { id: string; fileName: string; errorCode: string | null; errorMessage: string | null; reference: string | null; retryable?: boolean }[];
  skipped: { fileName: string; reason: string }[]; duplicateNames: string[]; acknowledgedByMe: boolean; elapsedSec: number;
  eta: { state: "none" } | { state: "calculating"; finished: number } | { state: "estimating"; lowSec: number; highSec: number; finished: number } | { state: "stalled"; sinceSec: number };
}
export type HistoryScope = "portal" | "org";
export interface UploadHistoryItem { id: string; kind: "cv" | "jd"; fileName: string; at: string; uploadedBy: string; portal: string; portalId: string; recordId: string | null; viaBatch: boolean; outcome: "added" | "added_needs_review" | "added_reviewed" | "not_added" | "held_for_review" | "cancelled" | "being_read" | "deleted"; reason: string | null }
export interface InvitationHistoryItem { id: string; email: string; role: string; portal: string; invitedBy: string; sentAt: string; expiresAt: string; acceptedAt: string | null; status: "accepted" | "withdrawn" | "expired" | "waiting"; emailState: string; resends: number }
export interface Capacity { total: number; reserved: number; available: number; cvReserved: number; jdReserved: number; batches: { id: string; kind: "cv" | "jd"; reserved: number; submittedBy: string; createdAt: string; state: "sending" | "processing" }[] }
export interface BatchReportFile { fileName: string; outcome: string; recordSaved: boolean; recordId: string | null; uploadedBy: string | null; admittedAt: string; finishedAt: string | null; problem: string | null; retryEligible: boolean; retries: number; nextAction: string | null; reference?: string | null }
export interface BatchReport { batch: { id: string; kind: "cv" | "jd"; submittedByEmail: string; createdAt: string; cancelledAt: string | null; complete: boolean; elapsedSec: number; declared: number; notYetSent: number }; tally: Record<string, number>; files: BatchReportFile[] }
export interface PendingDocument {
  batchId?: string | null;
  id: string; kind: "cv" | "jd"; fileName: string; status: "processing" | "published" | "exception"; stage: string;
  scanResult?: string | null; errorCode?: string | null; errorMessage?: string | null; recordId?: string | null; duplicate?: boolean;
}
export interface ActivityItem { id: string; at: string; who: string; what: string; portal: string }
export interface InvitationLookup { portalName: string; orgName: string; email: string; inviterEmail: string; role: string; expiresAt: string }
export interface PortalInvitationView { id: string; email: string; role: string; invitedBy: string; createdAt: string; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired"; emailState: "not_sent" | "queued" | "accepted" | "previewed" | "failed" | "expired"; emailAttempts: number; emailSentAt: string | null; resends: number }
export interface PortalMembers { portal: { id: string; name: string; role: string }; members: { userId: string; email: string; name: string; role: string; since: string; lastSeen: string | null; hereNow: boolean }[]; invitations: PortalInvitationView[]; canManage: boolean; mail?: { state: "available" | "preview" | "unavailable"; reason?: string; appUrlLocalOnly: boolean } }
export const ROLE_LABEL: Record<string, string> = { admin: "Portal administrator", recruiter: "Recruiter", hiring_manager: "Hiring manager / HR" };
export interface OrgPeople { organisation: { name: string; since: string }; portals: { id: string; name: string; members: number; admins: number }[];
  people: { userId: string; name: string; email: string; orgRole: string; canCreatePortals: boolean; since: string; portals: { id: string; name: string; role: string }[] }[] }
export interface SessionUser { userId: string; orgId: string; email: string; name: string; role: string }
/** Why a field read from a document was changed (the server requires one for those fields; see server/src/store.ts CHANGE_KINDS). */
export type ChangeKind = "extraction_correction" | "candidate_update" | "recruiter_preference" | "disputed_interpretation";
/** When this sign-in ends (8 hours from signing in, for everyone), and how many minutes before that the person is warned. */
export interface SessionWindow { endsAt: string; warnMinutes: number }

export interface PasskeyItem { id: string; label: string; createdAt: string; lastUsedAt: string | null }


export const api = {
  /** Claude's checks of saved matches, for up to 100 at once: the whole result for each one no longer pending. */
  cancelMatches: (ids: string[]) => request<{ cancelled: number; notSent: number; started: number }>("/matches/cancel", { method: "POST", body: JSON.stringify({ ids }) }),
  aiStatus: (ids: string[]) => request<{ id: string; ai: AiCheck | null; result?: MatchResult }[]>("/matches/ai-status", { method: "POST", quiet: true, body: JSON.stringify({ ids }) }),
  authMethods: () => request<{ passkey: boolean }>("/auth/methods"),
  passkeySignInOptions: () => request<{ challengeId: string; options: any }>("/auth/passkey/options", { method: "POST", quiet: true }),
  passkeySignIn: (challengeId: string, credential: unknown) => request<{ user: SessionUser; session: SessionWindow }>("/auth/passkey/verify", { method: "POST", quiet: true, body: JSON.stringify({ challengeId, credential }) }),
  passkeys: () => request<{ passkeys: PasskeyItem[]; recent: boolean }>("/auth/passkeys"),
  passkeyEnrolOptions: () => request<{ challengeId: string; options: any }>("/auth/passkeys/options", { method: "POST", quiet: true }),
  passkeyEnrolVerify: (challengeId: string, credential: unknown) => request<PasskeyItem>("/auth/passkeys/verify", { method: "POST", quiet: true, body: JSON.stringify({ challengeId, credential }) }),
  passkeyRemove: (id: string) => request<{ ok: true }>(`/auth/passkeys/${id}`, { method: "DELETE", quiet: true }),
  reauthenticate: (password: string) => request<{ session: SessionWindow }>("/auth/reauthenticate", { method: "POST", quiet: true, body: JSON.stringify({ password }) }),
  me: () => request<{ user: SessionUser; session: SessionWindow; portals?: { id: string; name: string; role: string }[] }>("/auth/me"),
  login: (email: string, password: string) => request<{ user: SessionUser; session: SessionWindow }>("/auth/login", { method: "POST", quiet: true, body: JSON.stringify({ email, password }) }),
  signup: (body: { name: string; orgName?: string; email: string; password: string; website?: string; inviteToken?: string }) => request<{ status: string; user?: SessionUser }>("/auth/signup", { method: "POST", quiet: true, timeoutMs: 20_000, body: JSON.stringify(body) }),
  verifySignup: (email: string, code: string) => request<{ user: SessionUser }>("/auth/verify", { method: "POST", quiet: true, timeoutMs: 20_000, body: JSON.stringify({ email, code }) }),
  forgotPassword: (email: string) => request<{ status: string }>("/auth/forgot", { method: "POST", quiet: true, timeoutMs: 20_000, body: JSON.stringify({ email }) }),
  resetPassword: (email: string, code: string, password: string) => request<{ status: string }>("/auth/reset", { method: "POST", quiet: true, timeoutMs: 20_000, body: JSON.stringify({ email, code, password }) }),
  resendSignup: (email: string) => request<{ status: string }>("/auth/resend", { method: "POST", quiet: true, timeoutMs: 20_000, body: JSON.stringify({ email }) }),
  // Signing out also forgets that the portal was opened, so the next sign-in shows the two-second opening screen again (src/overview/OverviewPage.tsx).
  logout: () => { try { sessionStorage.removeItem("rolematch.portalOpened"); } catch { /* nothing kept */ } return request<{ ok: boolean }>("/auth/logout", { method: "POST", quiet: true }); },
  candidates: (fresh = false) => allPages<Candidate>("/candidates", fresh).then((list) => keepCap(list, list.map(forDisplay))),
  jobs: (fresh = false) => allPages<Job>("/jobs", fresh),
  markReviewed: <T,>(kind: "candidates" | "jobs", id: string, version?: number) => request<T>(`/${kind}/${id}/review`, { method: "POST", body: JSON.stringify({ version }) }),
  getCandidate: (id: string) => request<Candidate>(`/candidates/${id}`).then(forDisplay),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  settings: () => request<SettingsResponse>("/settings"),
  saveSettings: (body: Record<string, unknown>) => request<SettingsResponse>("/settings", { method: "PUT", body: JSON.stringify(body) }),
  activityHistory: (scope: HistoryScope) => request<ActivityItem[]>(`/history/activity?scope=${scope}`),
  uploadHistory: (scope: HistoryScope) => request<UploadHistoryItem[]>(`/history/uploads?scope=${scope}`),
  invitationHistory: (scope: HistoryScope) => request<InvitationHistoryItem[]>(`/history/invitations?scope=${scope}`),
  dismissDocument: (id: string) => request<{ ok: boolean }>(`/documents/${id}/dismiss`, { method: "POST" }),
  deleteRecord: (kind: "candidates" | "jobs", id: string) => request<{ ok: boolean }>(`/${kind}/${id}`, { method: "DELETE" }),
  saveCandidate: (c: Candidate, changeKind?: ChangeKind) => request<Candidate>(`/candidates/${c.id}`, { method: "PUT", body: JSON.stringify(changeKind ? { ...forSaving(c), changeKind } : forSaving(c)) }).then(forDisplay),
  saveJob: (j: Job, changeKind?: ChangeKind) => request<Job>(`/jobs/${j.id}`, { method: "PUT", body: JSON.stringify(changeKind ? { ...j, changeKind } : j) }),
  upload: (kind: "cv" | "jd", file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    return request<PendingDocument>("/documents", { method: "POST", body: form });
  },
  batches: () => request<BatchView[]>("/batches"),
  /** `requestKey` is one per submission: a repeat of the same submission (double click, retry after an uncertain answer) reserves nothing new. */
  createBatch: (kind: "cv" | "jd", files: number, bytes: number, skipped: { fileName: string; reason: string }[] = [], requestKey: string = crypto.randomUUID()) => request<BatchView>("/batches", { method: "POST", body: JSON.stringify({ kind, files, bytes, skipped, requestKey }) }),
  capacity: () => request<Capacity>("/capacity"),
  invitation: (token: string) => request<InvitationLookup>("/auth/invitation", { method: "POST", quiet: true, body: JSON.stringify({ token }) }),
  acceptInvitation: (token: string) => request<{ portalId: string }>("/invitations/accept", { method: "POST", body: JSON.stringify({ token }) }),
  /** The portal is named explicitly: the server still checks that this person may manage it. */
  portalMembers: (portalId: string) => request<PortalMembers>("/portal/members", { headers: { "x-portal-id": portalId } }),
  invite: (portalId: string, emails: string[], role: string) => request<{ email: string; status: "invited" | "already_member" | "invalid" | "already_invited" }[]>("/portal/invitations", { method: "POST", headers: { "x-portal-id": portalId }, body: JSON.stringify({ emails, role }) }),
  resendInvitation: (portalId: string, id: string) => request<{ email: string }>(`/portal/invitations/${id}/resend`, { method: "POST", headers: { "x-portal-id": portalId } }),
  setMemberRole: (portalId: string, userId: string, role: string) => request<{ role: string }>(`/portal/members/${userId}`, { method: "PATCH", headers: { "x-portal-id": portalId }, body: JSON.stringify({ role }) }),
  removeMember: (portalId: string, userId: string) => request<{ ok: boolean }>(`/portal/members/${userId}`, { method: "DELETE", headers: { "x-portal-id": portalId } }),
  leavePortal: (portalId: string) => request<{ ok: boolean }>("/portal/leave", { method: "POST", headers: { "x-portal-id": portalId } }),
  orgPeople: () => request<OrgPeople>("/org/people"),
  leaveOrganisation: () => request<{ ok: boolean }>("/org/leave", { method: "POST" }),
  removeFromOrganisation: (userId: string) => request<{ ok: boolean }>(`/org/members/${userId}`, { method: "DELETE" }),
  appointPortalAdmin: (portalId: string, userId: string) => request<{ ok: boolean }>(`/org/portals/${portalId}/admins`, { method: "POST", body: JSON.stringify({ userId }) }),
  revokeInvitation: (portalId: string, id: string) => request<{ ok: boolean }>(`/portal/invitations/${id}/revoke`, { method: "POST", headers: { "x-portal-id": portalId } }),
  portals: () => request<{ id: string; name: string; role: string }[]>("/portals"),
  batchReport: (id: string) => request<BatchReport>(`/batches/${id}/report`),
  ackBatch: (id: string) => request<{ ok: boolean }>(`/batches/${id}/ack`, { method: "POST" }),
  batch: (id: string) => request<BatchView>(`/batches/${id}`),
  cancelBatch: (id: string) => request<{ stopped: number; view: BatchView }>(`/batches/${id}/cancel`, { method: "POST" }),
  retryBatch: (id: string) => request<{ retried: number; notRetryable: number; view: BatchView }>(`/batches/${id}/retry`, { method: "POST" }),
  closeBatch: (id: string) => request<{ ok: boolean }>(`/batches/${id}/close`, { method: "POST" }),
  uploadToBatch: (batchId: string, kind: "cv" | "jd", file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    return request<PendingDocument>(`/documents?batch=${batchId}&name=${encodeURIComponent(file.name.slice(0, 200))}`, { method: "POST", body: form });
  },
  documents: () => request<PendingDocument[]>("/documents"),
  document: (id: string) => request<PendingDocument>(`/documents/${id}`),
  employmentEvidence: (id: string) => request<EmploymentEvidence>(`/candidates/${id}/employment`),
  reviewEmployment: (id: string, body: Record<string, unknown>) => request<{ candidate: Candidate; recalculated: number }>(`/candidates/${id}/employment-review`, { method: "POST", body: JSON.stringify(body) }),
  readJobAgain: (id: string) => request<{ queued: boolean }>(`/jobs/${id}/read-again`, { method: "POST" }),
  readAgain: (id: string) => request<{ queued: boolean }>(`/candidates/${id}/read-again`, { method: "POST" }),
  /** The records behind one Needs attention item on the Overview (server/src/attention.ts). */
  attentionRecords: (rule: string) => request<{ candidateIds: string[]; jobIds: string[]; count: number; about: ("candidates" | "jobs")[]; items?: { candidateId?: string; jobId?: string; name?: string; title?: string; score?: number; status?: string }[] }>(`/attention/${encodeURIComponent(rule)}`),
  /** A candidate's status for one job (server/src/applications.ts): shortlisted, not suitable, interviewed, hired; null clears it. */
  applications: () => request<Application[]>("/applications"),
  setApplication: (candidateId: string, jobId: string, status: string | null) => request<{ application: Application | null; candidate: Candidate | null }>("/applications", { method: "PUT", body: JSON.stringify({ candidateId, jobId, status }) }).then((r) => ({ ...r, candidate: r.candidate ? forDisplay(r.candidate) : null })),
  /** The Overview's figures for this organisation's portal over the last 7, 30 or 90 days (server/src/orgOverview.ts). */
  overview: (days: number) => request<import("../overview/types").OverviewData>(`/overview?days=${days}`),
  /** A job's shortlist: the candidates a recruiter moved past New for it, each with the saved match, in review order. Nothing is calculated. */
  jobShortlist: (jobId: string) => request<{ candidate: Candidate; job: Job; status: string; matchResult: MatchResult | null }[]>(`/jobs/${jobId}/shortlist`).then((rows) => rows.map((r) => ({ ...r, candidate: forDisplay(r.candidate) }))),
  /** The ids a job (or a candidate) already has a match with, for the "Not yet matched" filter. */
  savedMatch: (candidateId: string, jobId: string) => request<MatchResult>(`/matches?candidateId=${candidateId}&jobId=${jobId}`),
  match: (candidateId: string, jobId: string) => request<MatchResult>("/matches", { method: "POST", body: JSON.stringify({ candidateId, jobId }) }),
  matchBulk: (body: { candidateId?: string; jobId?: string }) => request<{ candidate: Candidate; job: Job; matchResult: MatchResult }[]>("/matches/bulk", { method: "POST", body: JSON.stringify(body) }),
  audit: (entityId: string) => request<{ id: string; action: string; actor: string | null; detail: any; created_at: string }[]>(`/audit?entityId=${entityId}`),
};
