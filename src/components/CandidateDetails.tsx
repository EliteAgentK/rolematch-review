// The candidate panel. Which of the CV's facts go where; how they look is the panel configuration's (src/config/panels.ts) and the blocks'
// (src/components/ui/panel.tsx), the same as the job panel's (owner, 11 Nov 2026: "configure these panels to look the same, no matter how the CVs look").
// Tabs and sections come from PANEL_LAYOUT.candidate; the design is docs/product/design/cv-panel-tabs.html.
import { Badge, Box, Field, Flex, Input, Stack, Tag, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { FiMail, FiMapPin, FiPhone } from "react-icons/fi";
import type { Candidate } from "@/types/records";
import { colour, LABEL_PALETTE, PANEL_LOOK as L, QUALIFICATION, SPACE, type QualStatus, type QualType, type QualValidity } from "../config/panels";
import { rolematchConfig } from "../config/rolematch.config";
import { useSettings } from "../settings/SettingsContext";
import { profileAtAGlance, snapshotFacts, tidyTitle, whoToday } from "../utils/candidateFacts";
import { displayCase, employerName } from "../utils/displayCase";
import { followServer } from "../utils/serverCopy";
import { uploaded } from "../utils/shortDate";
import { orderSkillsByRecency } from "../utils/skillOrder";
import { NOT_SUITABLE, stagesOfCandidate, useStages } from "../utils/stages";
import { AiReadingNote } from "./AiCheck";
import DeleteButton from "./DeleteButton";
import LockedField from "./LockedField";
import PanelToolbar from "./PanelToolbar";
import ReviewNotice from "./ReviewNotice";
import { Avatar } from "./ui/avatar";
import { EntryMeta, EntryTitle, PanelChips, PanelContact, PanelContacts, PanelEntries, PanelEntry, PanelFooter, PanelFrame, PanelItems, PanelLayout, PanelLink,
  PanelMore, PanelNote, PanelNotice, PanelSubtitle, PanelText, PanelTitle, useFolded } from "./ui/panel";
import { Tooltip } from "./ui/tooltip";

type Qual = { degree: string; institution: string; year: string; type: QualType; level: string; status: QualStatus; statusEvidence: string; validity?: QualValidity; validityEvidence?: string };

/** Why a contact detail is blank: absent, unreadable and conflicting are different problems, and a CV sent by an agency usually leaves these out on purpose. */
function absentContact(candidate: Candidate, field: "email" | "phone", plain: string): string {
  const f = candidate.extraction?.fields?.[field];
  if (f?.state === "unreadable") return "In the document, but it could not be read";
  if (f?.state === "conflict") return "More than one in the document: check the original";
  if (f?.state === "failed") return "Could not be worked out: check the original";
  return candidate.submission ? "Not on this CV: contact through the agency" : plain;
}
/** Who sent this CV and how to reach them, kept apart from the candidate's own details. Only what the document states. */
function SubmissionDetails({ submission }: { submission: NonNullable<Candidate["submission"]> }) {
  const { agency, recruiter } = submission;
  const row = (label: string, value: string) => (
    <Flex gap={SPACE.sm} minW={0} flexWrap="wrap"><Box minW="120px"><PanelText muted>{label}</PanelText></Box><Box minW={0}><PanelText strong={!!value} muted={!value}>{value || "Not stated in the document"}</PanelText></Box></Flex>
  );
  return (
    <Box mt={SPACE.xl} p={SPACE.lg} borderWidth="1px" borderColor={colour("line")} borderRadius={L.section.box.radius} data-testid="agency-details">
      <EntryTitle>Came through a recruitment agency</EntryTitle>
      <Box mb={SPACE.md}><PanelText muted>These are the agency's details, not the candidate's.</PanelText></Box>
      <Stack gap={SPACE.xxs}>
        {row("Agency", agency.name)}
        {row("Recruiter", recruiter.name)}
        {row("Recruiter's e-mail", recruiter.email)}
        {row("Recruiter's phone", recruiter.phone)}
        {(agency.email || agency.phone) && row("Agency's e-mail", agency.email)}
        {(agency.email || agency.phone) && row("Agency's phone", agency.phone)}
      </Stack>
    </Box>
  );
}
/** Always the same order, top to bottom: degrees, diplomas, school, then certifications; within each, the CV's own order. */
function orderQualifications(c: Candidate): Qual[] {
  const entries: Qual[] = (c.education ?? []).map((e) => ({ degree: e.degree, institution: e.institution ?? "", year: e.year ?? "", type: (e.type ?? "other") as QualType, level: e.level ?? "Qualification", status: (e.status ?? "not_stated") as QualStatus, statusEvidence: e.statusEvidence ?? "", validity: e.validity as QualValidity | undefined, validityEvidence: e.validityEvidence }));
  // Certificates kept as plain text (older records): each is shown once, and a certificate listed as held is a completed one.
  const have = new Set(entries.map((e) => e.degree.toLowerCase().trim()));
  for (const cert of c.certifications ?? []) if (!have.has(cert.toLowerCase().trim()) && ![...have].some((h) => h && cert.toLowerCase().startsWith(h))) entries.push({ degree: cert, institution: "", year: "", type: "certificate", level: "Certificate", status: "completed", statusEvidence: "listed as a certificate held" });
  return entries.map((q, i) => ({ q, i })).sort((a, b) => QUALIFICATION.order.indexOf(a.q.type) - QUALIFICATION.order.indexOf(b.q.type) || a.i - b.i).map((x) => x.q);
}

const CandidateDetails = ({ candidate, onClose, onChange, onReview, onDelete }: { candidate: Candidate; onClose: () => void; onChange?: (candidate: Candidate) => unknown; onReview?: () => Promise<void> | void; onDelete?: () => Promise<void> | void }) => {
  const { nouns, statusLabel, settings, canEdit, lockReason } = useSettings();
  const can = (field: string) => canEdit("candidate", field);
  const why = (field: string) => lockReason("candidate", field);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(candidate);
  const [notes, setNotes] = useState(candidate.recruiterNotes || "");
  // The board hands this panel a fresh copy of the record on every reload (every 2 s while a batch runs): what the person is typing is never
  // replaced by it (review 16 Nov 2026). The notepad follows the server only while untouched; the form takes the server's copy whenever it is not open.
  const seen = useRef(candidate);
  useEffect(() => {
    const before = seen.current; seen.current = candidate;
    setNotes((mine) => before.id !== candidate.id ? candidate.recruiterNotes || "" : followServer(before.recruiterNotes || "", candidate.recruiterNotes || "", mine));
  }, [candidate]);
  useEffect(() => { if (!editing) setDraft(candidate); }, [candidate, editing]);
  // a save the person cancels (or that fails) resolves to null: the form stays open with their changes, so nothing typed is lost
  const save = async () => { if ((await onChange?.(draft)) !== null) setEditing(false); };   // the server refuses a change to a locked field, so the form only offers what is allowed
  const names = candidate.displayNames, listLimit = settings?.panels.panelListItems ?? 4;
  const skills = orderSkillsByRecency(candidate.skills, candidate.workHistory), qualifications = orderQualifications(candidate);
  const roles = useFolded(candidate.workHistory ?? [], settings?.panels.panelRoles ?? 3, candidate.id);
  const qualificationsShown = useFolded(qualifications, listLimit, candidate.id);
  // Who they are today (from the dated roles), the AI's short profile (held to the CV's words), and their status for each job.
  const [ownSummaryOpen, setOwnSummaryOpen] = useState(false);
  useEffect(() => setOwnSummaryOpen(false), [candidate.id]);
  const glance = profileAtAGlance(candidate), facts = snapshotFacts(candidate);
  const today = whoToday(candidate.workHistory, names), profile = String((candidate as { profile?: string }).profile ?? "").trim();
  const stages = useStages(), mine = stagesOfCandidate(stages.all, candidate.id), [stagesOpen, setStagesOpen] = useState(true);   // open, so the jobs they are on show at once (owner, 17 Nov 2026)
  const forward = mine.filter((a) => a.status !== NOT_SUITABLE), declined = mine.filter((a) => a.status === NOT_SUITABLE);
  const legacyStage = !mine.length && candidate.status && candidate.status !== "new" ? candidate.status : "";
  const hasNotes = !!(candidate.recruiterNotes ?? "").trim();
  const experience = candidate.experience ? (candidate.experience === "0" ? "under 1 yr dated experience" : `${candidate.experience}+ yrs dated experience`) : "";
  const shownLocation = candidate.location ? displayCase(candidate.location, names) : "";

  // Short by design (owner, 9 Nov 2026: "these summaries are too long"): the AI's summary of at most two sentences where there is one, and the CV's own
  // summary only on request; with no AI summary yet, the CV's own is cut to three lines with Read more.
  const fallback = !profile && !candidate.summary && settings?.panels.summaryFallback !== false && glance ? glance : "";
  const summary = (today || facts.length || profile || candidate.summary || fallback) ? (
    <Box>
      {today && <PanelText strong testId="who-today">{today}</PanelText>}
      {facts.length > 0 && <Box mb={SPACE.xxs}><PanelText muted testId="snapshot-facts">{facts.join(" · ")}</PanelText></Box>}
      {profile && <PanelText testId="ai-profile">{profile}</PanelText>}
      {profile && candidate.summary && <>
        <PanelLink onClick={() => setOwnSummaryOpen((o) => !o)} expanded={ownSummaryOpen}>{ownSummaryOpen ? "Hide the CV's own summary" : "The CV's own summary ▸"}</PanelLink>
        {ownSummaryOpen && <Box mt={SPACE.xxs}><PanelText testId="cv-summary">{candidate.summary}</PanelText></Box>}
      </>}
      {!profile && candidate.summary && <>
        <PanelText clamp={ownSummaryOpen ? undefined : 3} testId="cv-summary">{candidate.summary}</PanelText>
        <PanelLink onClick={() => setOwnSummaryOpen((o) => !o)} expanded={ownSummaryOpen}>{ownSummaryOpen ? "Show less" : "Read more"}</PanelLink>
      </>}
      {fallback && <><PanelText>{fallback}</PanelText><PanelNote>Profile at a glance: put together from the fields read from the CV. The CV has no summary of its own.</PanelNote></>}
      {/* With the profile at a glance switched off, the panel still says plainly that there is no summary, rather than leaving it unsaid (18 Nov 2026). */}
      {!profile && !candidate.summary && !fallback && <PanelNote testId="no-summary">No summary provided.</PanelNote>}
    </Box>
  ) : null;

  const field = (key: string, label: string, value: string, set: (v: string) => void, locked: string, multiline = false) => can(key)
    ? <Field.Root><Field.Label>{label}</Field.Label>{multiline ? <Textarea aria-label={label} value={value} onChange={(e) => set(e.target.value)} /> : <Input aria-label={label} value={value} onChange={(e) => set(e.target.value)} />}</Field.Root>
    : <LockedField label={label} value={locked} reason={why(key)} />;

  return (
    <Box>
      <PanelToolbar title={`${nouns.candidate.one} Resume`} editing={editing} editLabel={`Edit ${nouns.candidate.one.toLowerCase()}`} onEdit={onChange && !candidate.rereading ? () => setEditing(true) : undefined} onSave={save} onCancel={() => { setDraft(candidate); setEditing(false); }} onClose={onClose}>
        {onDelete && <DeleteButton title={candidate.name} what="This removes the candidate, their original CV file, your notes, and every match result that includes them." onConfirm={onDelete} />}
      </PanelToolbar>
      {rolematchConfig.review.showPrompts && <ReviewNotice review={candidate.review} state={candidate.reviewState} onConfirm={onReview} />}

      <PanelFrame>
        {/* Who this is: the same whichever tab is open. */}
        <Flex gap={SPACE.xl} align="start" flexWrap="wrap">
          <Avatar size={L.avatar.size} src={candidate.avatar} name={candidate.name} borderWidth={L.avatar.ring} borderColor={colour("rule")} boxShadow="md" />
          <Box flex={1} minW="200px" maxW="100%">
            {editing && can("name") ? <Input mb={SPACE.sm} aria-label="Name" placeholder={draft.nameUnconfirmed ? "Enter the candidate's name" : undefined} value={draft.nameUnconfirmed && draft.name === candidate.name ? "" : draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              : <PanelTitle testId="panel-title">{candidate.name}</PanelTitle>}
            {editing ? <PanelText muted>Edit the extracted fields below, then save.</PanelText> : <PanelSubtitle testId="panel-subtitle" parts={[tidyTitle(displayCase(candidate.role, names)), experience, shownLocation]} />}
          </Box>
        </Flex>

        {/* While the CV is read again its facts are about to be replaced, so the panel offers no Edit and says why, as the job panel does (code review,
            16 Nov 2026, E-M3). The notepad and statuses are the recruiter's own work and stay open: a new reading never touches them. */}
        {candidate.rereading && <PanelNotice progress testId="candidate-rereading">Being read again by the AI. This panel updates by itself when the new reading is in; anything corrected by hand is kept.</PanelNotice>}

        {editing && (
          <Stack gap={SPACE.md} mt={SPACE.xl} mb={SPACE.sm} data-testid="edit-form">
            <PanelNote>Fields marked with a lock are read from the CV and cannot be edited here. Your organisation decides which can be; administrators change that in Settings.</PanelNote>
            {field("role", "Occupation", draft.role, (v) => setDraft({ ...draft, role: v }), candidate.role)}
            <Flex gap={SPACE.md} wrap="wrap">
              <Box flex={1} minW="180px">{field("email", "Email address", draft.email, (v) => setDraft({ ...draft, email: v }), candidate.email)}</Box>
              <Box flex={1} minW="180px">{field("phone", "Phone number", draft.phone, (v) => setDraft({ ...draft, phone: v }), candidate.phone)}</Box>
              <Box flex={1} minW="180px">{field("location", "Location", draft.location, (v) => setDraft({ ...draft, location: v }), candidate.location)}</Box>
            </Flex>
            {field("skills", can("skills") ? "Skills separated by commas" : "Skills", draft.skills.join(", "), (v) => setDraft({ ...draft, skills: v.split(",").map((x) => x.trim()).filter(Boolean) }), candidate.skills.join(", "), true)}
            {(can("worthNoting") || (candidate.worthNoting ?? []).length > 0) && field("worthNoting", can("worthNoting") ? "Worth noting (one per line)" : "Worth noting", (draft.worthNoting ?? []).join("\n"), (v) => setDraft({ ...draft, worthNoting: v.split("\n").map((x) => x.trim()).filter(Boolean) }), (candidate.worthNoting ?? []).join("\n"), true)}
            {field("summary", "Professional summary", draft.summary || "", (v) => setDraft({ ...draft, summary: v }), candidate.summary || "", true)}
            <LockedField label="Work history, education and projects" value="Shown below exactly as the CV states them." reason={why("workHistory")} />
          </Stack>
        )}

        {/* What stage this person is at, and for which job (owner, 9 Nov 2026): above the tabs, so it shows whichever tab is open. A status is per job. */}
        {(mine.length > 0 || legacyStage) && (
          <Box mt={SPACE.lg} data-testid="candidate-stages">
            <Flex as="button" {...({ type: "button" } as object)} align="center" gap={SPACE.sm} onClick={() => setStagesOpen((v) => !v)} aria-expanded={stagesOpen}
              _focusVisible={{ outline: "2px solid", outlineColor: colour("chosen"), outlineOffset: "2px" }}>
              <Badge colorPalette={forward.length || legacyStage ? LABEL_PALETTE.forward : LABEL_PALETTE.declined} variant="subtle" size={L.badge.status}>
                {legacyStage ? `${statusLabel(legacyStage)} (job not recorded)`
                  : forward.length ? `${statusLabel(candidate.status)} · ${forward.length} ${(forward.length === 1 ? nouns.job.one : nouns.job.many).toLowerCase()}`
                  : `${statusLabel(NOT_SUITABLE)} · ${declined.length} ${(declined.length === 1 ? nouns.job.one : nouns.job.many).toLowerCase()}`}
              </Badge>
              {mine.length > 0 && <Text aria-hidden color={colour("faint")} transform={stagesOpen ? "rotate(90deg)" : undefined} transition="transform .32s cubic-bezier(.16,1,.3,1)">▸</Text>}
            </Flex>
            {stagesOpen && mine.length > 0 && (
              <Stack gap={SPACE.xxs} mt={SPACE.sm} pl={SPACE.xxs} className="rm-reveal">
                {[...forward, ...declined].map((a) => (
                  <Flex key={a.id} align="center" gap={SPACE.sm} wrap="wrap">
                    {/* The job with its company: thirty "Head of Technology" jobs must be told apart (owner, 12 Nov 2026). */}
                    <PanelText strong>{a.jobTitle || nouns.job.one}{a.jobCompany ? ` · ${a.jobCompany}` : ""}</PanelText>
                    <Badge colorPalette={a.status === NOT_SUITABLE ? LABEL_PALETTE.declined : LABEL_PALETTE.forward} variant="outline">{statusLabel(a.status)}</Badge>
                    <PanelNote>{new Date(a.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</PanelNote>
                  </Flex>
                ))}
              </Stack>
            )}
          </Box>
        )}

        <PanelLayout kind="candidate" recordId={candidate.id} title={candidate.name} labels={{ notes: nouns.notes }} content={{
          contact: { node: (
            <>
              <PanelContacts>
                <PanelContact icon={(s) => <FiMail size={s} />} value={candidate.email} wrap missing={absentContact(candidate, "email", "No e-mail address in the CV")} />
                <PanelContact icon={(s) => <FiPhone size={s} />} value={candidate.phone} missing={absentContact(candidate, "phone", "No phone number in the CV")} />
                <PanelContact icon={(s) => <FiMapPin size={s} />} value={shownLocation} missing="No location in the CV" />
              </PanelContacts>
              {candidate.submission && <SubmissionDetails submission={candidate.submission} />}
            </>
          ) },
          summary: { node: summary },
          notes: { count: candidate.worthNoting?.length ?? 0, node: <PanelItems items={candidate.worthNoting ?? []} testId="panel-worth-noting" limit={listLimit} resetKey={candidate.id} noun="notes" /> },
          // No evidence review for the recruiter (owner, 9 Nov 2026): the panel shows the work history as read; how well each role is tied to the CV is
          // checked and measured behind the scenes, never put to the recruiter to settle.
          work: { count: candidate.workHistory?.length ?? 0, node: (
            <>
              <PanelEntries>
                {roles.shown.map((job, i) => (
                  <PanelEntry key={i} tone="role" testId="work-entry">
                    <EntryTitle>{displayCase(job.position, names) || "Title not stated"}</EntryTitle>
                    <EntryMeta gapBelow={job.responsibilities.length > 0} parts={[employerName(job.company, names) || "Employer not stated", [displayCase(job.startDate, names), displayCase(job.endDate, names)].filter(Boolean).join(" – ") || "Dates not stated"]} />
                    {job.responsibilities.length > 0 && <PanelItems items={job.responsibilities} />}
                  </PanelEntry>
                ))}
              </PanelEntries>
              {roles.hidden > 0 && <PanelMore open={roles.open} onToggle={roles.toggle} hidden={roles.hidden} noun="roles" />}
            </>
          ) },
          projects: { count: candidate.projects?.length ?? 0, node: <PanelItems items={candidate.projects ?? []} testId="panel-projects" limit={listLimit} resetKey={candidate.id} noun="projects" /> },
          // Degrees, diplomas, school and certifications in ONE list, each saying what it is and whether it was finished.
          education: { count: qualifications.length, node: (
            <>
              <Box data-testid="panel-education"><PanelEntries>
                {qualificationsShown.shown.map((q, i) => (
                  <PanelEntry key={i} rule={QUALIFICATION.status[q.status].rule} testId="education-entry">
                    <Flex gap={SPACE.sm} wrap="wrap" mb={SPACE.xxs} align="center">
                      <Tag.Root size={L.tag} colorPalette={QUALIFICATION.typeColour[q.type]} borderRadius="md" data-testid="education-type">{q.level}</Tag.Root>
                      <Tooltip content={q.statusEvidence || "The CV does not say whether this was finished."} showArrow openDelay={400}>
                        <Tag.Root size={L.tag} colorPalette={QUALIFICATION.status[q.status].colour} variant={q.status === "not_stated" ? "outline" : "subtle"} borderRadius="md" data-testid="education-status">{QUALIFICATION.status[q.status].label}</Tag.Root>
                      </Tooltip>
                      {q.validity && q.validity !== "unknown" && (
                        <Tooltip content={`${QUALIFICATION.validity[q.validity].why}${q.validityEvidence ? ` The CV says: "${q.validityEvidence}".` : ""}`} showArrow openDelay={400}>
                          <Tag.Root size={L.tag} colorPalette={QUALIFICATION.validity[q.validity].colour} variant={QUALIFICATION.validity[q.validity].variant} borderRadius="md" data-testid="certificate-validity">{QUALIFICATION.validity[q.validity].label}</Tag.Root>
                        </Tooltip>
                      )}
                    </Flex>
                    <EntryTitle>{displayCase(q.degree, names)}</EntryTitle>
                    <EntryMeta parts={[displayCase(q.institution, names), q.year]} />
                  </PanelEntry>
                ))}
              </PanelEntries></Box>
              {qualificationsShown.hidden > 0 && <PanelMore open={qualificationsShown.open} onToggle={qualificationsShown.toggle} hidden={qualificationsShown.hidden} noun="qualifications" />}
            </>
          ) },
          skills: { count: skills.length, node: <PanelChips items={skills} testId="panel-skill" limit={settings?.panels.panelSkills ?? 8} resetKey={candidate.id} /> },
          // The notepad: the recruiter's own work, always editable. The tab's count shows when a colleague has already written something.
          "recruiter-notes": { count: hasNotes ? 1 : 0, node: (
            <Box>
              <Textarea readOnly={!onChange} placeholder={onChange ? "Add recruiter observations, verification outcomes or interview notes" : "View only"} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (candidate.recruiterNotes || "")) onChange?.({ ...candidate, recruiterNotes: notes }); }} />
              <PanelNote>Saved when you click away. Notes are private to your organisation, separate from the extracted evidence, and never change a match result.</PanelNote>
            </Box>
          ) },
        }} />

        <AiReadingNote reading={(candidate as any).aiReading} />
        <PanelFooter original={candidate.originalDocumentUrl ? { href: candidate.originalDocumentUrl, label: "View Original CV" } : undefined} uploaded={uploaded(candidate.uploadedAt, candidate.appliedDate)} />
      </PanelFrame>
    </Box>
  );
};

export default CandidateDetails;
