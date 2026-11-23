// The job panel (owner, 10 Nov 2026: "how do we get everything on there but not have such a long panel"; design: docs/product/design/job-panel-tabs.html).
// Which of the job description's facts go where; how they look is the panel configuration's (src/config/panels.ts) and the blocks' (ui/panel.tsx), the
// same as the candidate panel's (owner, 11 Nov 2026). Tabs and sections come from PANEL_LAYOUT.job. Every item is the job description's own words, read
// by the AI (server/src/jobReader.ts); a summary the AI wrote is labelled as such.
import { Badge, Box, Field, Flex, Input, Stack, Textarea } from "@chakra-ui/react";
import { useEffect, useState, type ReactNode } from "react";
import type { Job } from "@/types/records";
import { colour, LABEL_PALETTE, PANEL_LOOK as L, SPACE, type TONES } from "../config/panels";
import { rolematchConfig } from "../config/rolematch.config";
import { useSettings } from "../settings/SettingsContext";
import { displayCase } from "../utils/displayCase";
import { groupsOf } from "../utils/jobGroups";
import { uploaded } from "../utils/shortDate";
import { shortlistedFor, useStages } from "../utils/stages";
import DeleteButton from "./DeleteButton";
import LockedField from "./LockedField";
import PanelToolbar from "./PanelToolbar";
import ReviewNotice from "./ReviewNotice";
import { Button } from "./ui/button";
import { EntryTitle, PanelCaption, PanelChips, PanelEntries, PanelEntry, PanelFacts, PanelFooter, PanelFrame, PanelGroup, PanelItems, PanelLayout, PanelMore,
  PanelNote, PanelNotice, PanelSubtitle, PanelText, PanelTitle } from "./ui/panel";
import { Select } from "./ui/select";

const JobDetails = ({ job, onClose, onChange, onReview, onDelete }: { job: Job; onClose: () => void; onChange?: (job: Job) => unknown; onReview?: () => Promise<void> | void; onDelete?: () => Promise<void> | void }) => {
  const { nouns, canEdit, lockReason } = useSettings();
  // Who a recruiter has shortlisted for this job (or moved further): the button beside Edit opens the list, with the saved scores.
  const stages = useStages(), onShortlist = shortlistedFor(stages.all, job.id).length;
  const can = (field: string) => canEdit("job", field);
  const why = (field: string) => lockReason("job", field);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(job);
  const [allFacts, setAllFacts] = useState(false);
  const [openGroup, setOpenGroup] = useState<Record<string, number>>({});
  useEffect(() => { if (!editing) setDraft(job); }, [job, editing]);   // a reload never replaces an open form (review 16 Nov 2026)
  useEffect(() => { setAllFacts(false); setOpenGroup({}); }, [job.id]);
  // a save the person cancels (or that fails) resolves to null: the form stays open with their changes, so nothing typed is lost
  const save = async () => { if ((await onChange?.(draft)) !== null) setEditing(false); };

  const facts = ([["Location", job.location], ["Employment", job.type], ["Work arrangement", job.workArrangement], ["Reports to", job.reportsTo], ["Pay", job.remuneration]] as [string, string | undefined][])
    .filter(([, v]) => String(v ?? "").trim()) as [string, string][];
  const more = (job.keyFacts ?? []).filter((f) => f.value?.trim()).map((f) => [f.label, f.value] as [string, string]);
  const requirementGroups = groupsOf(job.requirements, job.requirementGroups), preferredGroups = groupsOf(job.preferredRequirements, job.preferredGroups);
  const responsibilityGroups = groupsOf(job.responsibilities, job.responsibilityGroups);
  const extras = (job.extras ?? []).filter((e) => e.items.length), competencies = job.competencies ?? [];
  // One group open at a time in a tab: the first opens by itself, so a tab never opens on a column of closed headings.
  const isOpen = (tab: string, i: number) => (openGroup[tab] ?? 0) === i;
  const toggle = (tab: string, i: number) => setOpenGroup((o) => ({ ...o, [tab]: (o[tab] ?? 0) === i ? -1 : i }));
  const grouped = (tab: string, groups: { heading: string; items: string[] }[], tone: keyof typeof TONES, testId: string): ReactNode => {
    if (!groups.length) return null;
    // One group: shown open, with its heading as a caption only when it says more than the section it sits in ("Advantageous" under Advantageous).
    if (groups.length === 1) {
      const h = groups[0].heading.trim(), same = !h || [tab, testId.replace(/^job-/, ""), "advantageous", "preferred"].some((x) => h.toLowerCase().includes(x) || x.includes(h.toLowerCase()));
      return <Box data-testid={testId}>{!same && <PanelCaption>{h}</PanelCaption>}<PanelItems items={groups[0].items} tone={tone} /></Box>;
    }
    return <Box data-testid={testId}>{groups.map((g, i) => <PanelGroup key={i} heading={g.heading || "Also listed"} count={g.items.length} open={isOpen(tab, i)} onToggle={() => toggle(tab, i)} testId={`${testId}-group`}><PanelItems items={g.items} tone={tone} /></PanelGroup>)}</Box>;
  };
  const field = (key: string, label: string, value: string, set: (v: string) => void, locked: string, multiline = false) => can(key)
    ? <Field.Root><Field.Label>{label}</Field.Label>{multiline ? <Textarea aria-label={label} minH={multiline ? "120px" : undefined} value={value} onChange={(e) => set(e.target.value)} /> : <Input aria-label={label} value={value} onChange={(e) => set(e.target.value)} />}</Field.Root>
    : <LockedField label={label} value={locked} reason={why(key)} />;
  const lines = (v: string) => v.split("\n").filter(Boolean);

  return (
    <Box>
      <PanelToolbar title={`${nouns.job.one} Details`} editing={editing} editLabel={`Edit ${nouns.job.one.toLowerCase()}`} onEdit={onChange && !job.rereading ? () => setEditing(true) : undefined} onSave={save} onCancel={() => { setDraft(job); setEditing(false); }} onClose={onClose}
        beside={<Button size={L.button} variant="outline" onClick={() => stages.openShortlist(job)} data-testid="view-shortlist">View shortlist{onShortlist ? ` (${onShortlist})` : ""}</Button>}>
        {onDelete && <DeleteButton title={job.title} what="This removes the job, its original file, and every match result for it." onConfirm={onDelete} />}
      </PanelToolbar>
      {rolematchConfig.review.showPrompts && <ReviewNotice review={job.review} state={job.reviewState} onConfirm={onReview} />}

      <PanelFrame>
        {/* Who and where: the same whichever tab is open. A job with no title in its document waits for a recruiter to add one; it is never guessed. */}
        <Box>
          {editing && can("title") ? <Input mb={SPACE.sm} aria-label="Job title" placeholder="Enter the job title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            : job.title?.trim() ? <PanelTitle testId="panel-title">{displayCase(job.title)}</PanelTitle>
            : (
              <Box mb={SPACE.sm} p={SPACE.md} border="1px dashed" borderColor={colour("noticeLine")} bg={colour("noticeGround")} color={colour("noticeInk")} borderRadius="md" data-testid="needs-title">
                <EntryTitle>Needs a title</EntryTitle>
                <PanelText>The job description does not give the job's title, so none was guessed.{onChange && can("title") ? " Use Edit to add it." : " Someone who may edit jobs can add it."}</PanelText>
              </Box>
            )}
          <PanelSubtitle testId="panel-subtitle" parts={[displayCase(job.company), job.department]} />
        </Box>

        {job.rereading && <PanelNotice progress testId="job-rereading">Being read again by the AI. This panel updates by itself when the new reading is in; anything corrected by hand is kept.</PanelNotice>}
        {job.rereadFailed && !job.rereading && <PanelNotice>The last Read again could not be finished, so this is the earlier reading. Try Read again later.</PanelNotice>}

        {editing && (
          <Stack gap={SPACE.md} mt={SPACE.xl} mb={SPACE.sm} data-testid="edit-form">
            <PanelNote>Fields marked with a lock are worked out from the document and cannot be edited here. Your organisation decides which can be; administrators change that in Settings.</PanelNote>
            <Flex gap={SPACE.md} wrap="wrap">
              <Box flex={1} minW="180px">{field("company", "Company", draft.company, (v) => setDraft({ ...draft, company: v }), job.company)}</Box>
              <Box flex={1} minW="180px">{field("department", "Department", draft.department, (v) => setDraft({ ...draft, department: v }), job.department)}</Box>
            </Flex>
            <Flex gap={SPACE.md} wrap="wrap">
              <Box flex={1} minW="180px">{field("location", "Location", draft.location, (v) => setDraft({ ...draft, location: v }), job.location)}</Box>
              <Box flex={1} minW="180px">{field("workArrangement", "Work arrangement", draft.workArrangement || "", (v) => setDraft({ ...draft, workArrangement: v }), job.workArrangement || "")}</Box>
              <Box flex={1} minW="180px">{field("type", "Employment type", draft.type, (v) => setDraft({ ...draft, type: v }), job.type)}</Box>
            </Flex>
            <Field.Root><Field.Label>Job status</Field.Label><Select aria-label="Job status" value={draft.status || "draft"} onChange={(e) => setDraft({ ...draft, status: e.target.value as Job["status"] })}><option value="draft">Draft</option><option value="open">Open</option><option value="paused">Paused</option><option value="closed">Closed</option></Select></Field.Root>
            {field("description", "Summary", draft.description, (v) => setDraft({ ...draft, description: v }), job.description, true)}
            {field("skills", can("skills") ? "Skills separated by commas" : "Skills", (draft.skills || []).join(", "), (v) => setDraft({ ...draft, skills: v.split(",").map((x) => x.trim()).filter(Boolean) }), (job.skills || []).join(", "), true)}
            {field("requirements", can("requirements") ? "Mandatory requirements - one per line" : "Mandatory requirements", draft.requirements.join("\n"), (v) => setDraft({ ...draft, requirements: lines(v) }), job.requirements.join("\n"), true)}
            {field("preferredRequirements", can("preferredRequirements") ? "Preferred requirements - one per line" : "Preferred requirements", (draft.preferredRequirements || []).join("\n"), (v) => setDraft({ ...draft, preferredRequirements: lines(v) }), (job.preferredRequirements || []).join("\n"), true)}
            {field("responsibilities", can("responsibilities") ? "Responsibilities - one per line" : "Responsibilities", (draft.responsibilities || []).join("\n"), (v) => setDraft({ ...draft, responsibilities: lines(v) }), (job.responsibilities || []).join("\n"), true)}
          </Stack>
        )}

        <PanelLayout kind="job" recordId={job.id} title={displayCase(job.title) || "Untitled job"} content={{
          // Each label above its value, in as many columns as the panel's width holds; the further facts of the job's own table one click away.
          facts: { node: facts.length + more.length ? (
            <Box data-testid="job-overview">
              <PanelFacts facts={allFacts || !facts.length ? [...facts, ...more] : facts} testId="job-key-facts" />
              {facts.length > 0 && more.length > 0 && <PanelMore open={allFacts} onToggle={() => setAllFacts((v) => !v)} hidden={more.length} noun="facts" testId="more-facts" />}
            </Box>
          ) : null },
          summary: { node: job.description?.trim() ? (
            <Box>
              <Badge size={L.badge.label} variant="outline" colorPalette={job.summarySource === "ai" ? LABEL_PALETTE.writtenByAi : LABEL_PALETTE.fromDocument} mb={SPACE.sm} data-testid="summary-source">
                {job.summarySource === "ai" ? "Written by AI from the job description" : "From the job description"}
              </Badge>
              <PanelText testId="job-summary">{job.description}</PanelText>
            </Box>
          ) : null },
          requirements: { count: job.requirements?.length ?? 0, node: grouped("requirements", requirementGroups, "requirement", "job-requirements") },
          preferred: { count: job.preferredRequirements?.length ?? 0, node: grouped("preferred", preferredGroups, "preferred", "job-preferred") },
          responsibilities: { count: job.responsibilities?.length ?? 0, node: grouped("responsibilities", responsibilityGroups, "responsibility", "job-responsibilities") },
          skills: { count: job.skills?.length ?? 0, node: <Box data-testid="job-skills"><PanelChips items={job.skills ?? []} testId="job-skill" /></Box> },
          competencies: { count: competencies.length, node: (
            <Box data-testid="job-competencies"><PanelEntries>
              {competencies.map((c, i) => <PanelEntry key={i} tone="competency"><EntryTitle>{c.name}</EntryTitle>{c.description && <PanelText>{c.description}</PanelText>}</PanelEntry>)}
            </PanelEntries></Box>
          ) },
          extras: { count: extras.reduce((n, e) => n + e.items.length, 0), node: (
            <Box data-testid="job-extras">{extras.map((e, i) => <PanelGroup key={i} heading={e.heading} count={e.items.length} open={isOpen("more", i)} onToggle={() => toggle("more", i)}><PanelItems items={e.items} tone="other" /></PanelGroup>)}</Box>
          ) },
        }} />

        {/* How it was read, and the original: the same at the bottom of every tab. */}
        <PanelFooter readBy={{ testId: "job-read-by", text: job.aiReading?.state === "read" || job.extraction?.method === "ai" ? "Read by AI · every item is the job description's own words" : "Read from the job description" }}
          original={job.originalDocumentUrl ? { href: job.originalDocumentUrl, label: "View original job", testId: "view-original-job" } : undefined}
          uploaded={uploaded(job.uploadedAt, job.postedDate)} />
      </PanelFrame>
    </Box>
  );
};

export default JobDetails;
