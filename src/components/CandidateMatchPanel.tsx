import { useState } from "react";
import { Badge, Box, Flex, Stack, Table } from "@chakra-ui/react";
import { Button } from "./ui/button";
import AlignmentStars from "./AlignmentStars";
import type { Candidate, Job } from "@/types/records";
import type { LogisticsStatus, MatchEvidence, MatchResult } from "@/api/client";
import { colour, DOT, EVIDENCE, LABEL_PALETTE, PANEL_LOOK as L, SPACE } from "../config/panels";
import { NOT_SUITABLE, useStages } from "../utils/stages";
import { useSettings } from "../settings/SettingsContext";
import { EvidenceBadge, EvidenceBar, EvidenceMark, PanelFold, PanelLead, PanelNote, PanelSubhead, PanelSubtitle, PanelText, PanelTitle } from "./ui/panel";

// Match details, kept simple (owner, 9 Nov 2026: "my eyes don't know where to look"; keep the stars and the percentage; clear cut, but informative enough).
// Read top to bottom: the score and one sentence; what fits beside what to check; what to do next; then, one click away, every requirement with the CV's
// own words, and how the score was reached. Presentation only: every word and number comes from the stored result (server/src/aiMatch.ts). How it looks is
// the panel configuration's (src/config/panels.ts) and the blocks' (ui/panel.tsx), the same as the CV and job panels' (owner, 11 Nov 2026).
interface Props { candidate: Candidate; job: Job; result: MatchResult; onAction?: (action: "shortlist" | "review-cv" | "not-suitable") => void }

const LOGISTICS: Record<LogisticsStatus, string> = { compatible: "compatible", to_confirm: "to confirm", conflict: "a conflict to resolve", not_required: "not required" };
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim();
const reasonOf = (e: MatchEvidence) => e.reason || firstSentence(e.explanation ?? "");
const CAREER_WORDS = { seniority: { below: "below the role", matches: "matches the role", above: "above the role" }, industry: { same: "same industry", related: "related industry", different: "different industry" }, recency: { current: "relevant work is current", "within five years": "relevant work within five years", older: "relevant work is older", none: "no directly relevant work" } } as const;

/** One requirement: its mark, what it asks, and the reason in one line; the CV's own words and the fuller explanation on click. */
function Requirement({ item }: { item: MatchEvidence }) {
  const [open, setOpen] = useState(false), fairness = item.reviewFlags?.some((f) => f.kind === "fairness");
  return (
    <Box py={SPACE.sm}>
      <Flex as="button" {...({ type: "button" } as object)} w="100%" gap={SPACE.sm} textAlign="left" align="start" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <EvidenceMark state={item.state} />
        <Box flex="1" minW={0}>
          <PanelText strong>{item.label}{item.inferred && <Box as="span" color={colour("muted")} fontWeight={L.text.weight}>{DOT}inferred, not shown outright</Box>}</PanelText>
          <PanelText muted>{fairness ? reasonOf(item) : `${EVIDENCE[item.state].label}${reasonOf(item) ? `: ${reasonOf(item)}` : ""}`}</PanelText>
        </Box>
      </Flex>
      {open && (
        <Box ml="1.7em" mt={SPACE.sm} className="rm-reveal">
          {item.explanation && item.explanation !== item.reason && <PanelText>{item.explanation}</PanelText>}
          {fairness ? null : item.source
            ? <Box mt={SPACE.sm} pl={SPACE.md} borderLeftWidth="2px" borderColor={colour("quote")} fontStyle="italic"><PanelText>“{item.source}”</PanelText></Box>
            : <Box mt={SPACE.xxs}><PanelText muted>No line of the CV speaks to this.</PanelText></Box>}
        </Box>)}
    </Box>
  );
}

/** A row of the strengths-and-gaps table: its state, the requirement, and why (under the requirement on a narrow screen). */
function Row({ e, testId }: { e: MatchEvidence; testId: string }) {
  return (
    <Table.Row data-testid={testId}>
      <Table.Cell><EvidenceBadge state={e.state} /></Table.Cell>
      <Table.Cell><PanelText>{e.label}</PanelText><Box display={{ base: "block", md: "none" }}><PanelText muted>{reasonOf(e)}</PanelText></Box></Table.Cell>
      <Table.Cell display={{ base: "none", md: "table-cell" }}><PanelText muted>{reasonOf(e)}</PanelText></Table.Cell>
    </Table.Row>
  );
}

/** How a finished score was reached and that it stays. The first finished match of a pair is its recorded match: editing the CV or the job, or matching them
 *  again, shows this same assessment (server/src/index.ts, recordedMatch; owner, 10 Nov 2026). It used to say the score "changes only if either is edited",
 *  which was not true (code review, 16 Nov 2026, E-M6). */
export const recordedNote = (at: string) => `Scored${at ? ` on ${at}` : ""} against the job's requirements, with every finding tied to the CV's own lines. This is the recorded assessment for this CV and this job, and it does not change: editing either of them, or matching them again, shows this same assessment.`;

const CandidateMatchPanel: React.FC<Props> = ({ candidate, job, result, onAction }) => {
  const [open, setOpen] = useState({ all: false, how: false });
  const evidence = (result.evidence ?? []).filter((e) => !e.duplicateOf);
  const scored = result.ai ? result.ai.state === "checked" : result.assessment?.state !== "incomplete";
  const byLabel = (label: string) => evidence.find((e) => e.label === label);
  const strengths = (result.overview?.strengths ?? evidence.filter((e) => e.state === "verified").slice(0, 3).map((e) => e.label)).map((l) => byLabel(l) ?? ({ label: l, state: "verified", explanation: "" } as MatchEvidence));
  const gaps = (result.overview?.gaps ?? []).map((g) => byLabel(g.label) ?? ({ label: g.label, state: g.state, reason: g.reason, explanation: "" } as MatchEvidence));
  const actions = result.actions ?? [];
  const counted = evidence.filter((e) => e.state !== "not_applicable");
  const tally = (["verified", "partial", "not_demonstrated", "contradicted"] as const).map((state) => ({ state, n: counted.filter((e) => e.state === state).length }));
  // Grouped as a recruiter screens: must-haves, then what is important, then what is nice to have (older results, with no importance, by "required").
  const tierOf = (e: MatchEvidence) => e.importance ?? (e.mandatory ? "must_have" : "important");
  // The must-haves are shown in full above the fold; the other requirements are grouped below, one click away, and none is listed twice.
  const mustHaves = evidence.some((e) => e.importance) ? evidence.filter((e) => e.importance === "must_have") : [], rest = mustHaves.length ? evidence.filter((e) => e.importance !== "must_have") : evidence;
  const groups = ([["must_have", "Must-haves"], ["important", "Important"], ["nice_to_have", "Nice to have"]] as const).map(([k, title]) => ({ title, items: rest.filter((e) => tierOf(e) === k) })).filter((g) => g.items.length);
  // This person's status for this job, where a recruiter has set one.
  const stage = useStages().all.find((a) => a.candidateId === candidate.id && a.jobId === job.id)?.status, { statusLabel } = useSettings();
  const at = result.ai?.at ? new Date(result.ai.at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  const section = (title: string) => <Table.Row><Table.Cell colSpan={3} pt={SPACE.md}><PanelSubhead>{title}</PanelSubhead></Table.Cell></Table.Row>;
  const none = (words: string) => <Table.Row><Table.Cell colSpan={3}><PanelText muted>{words}</PanelText></Table.Cell></Table.Row>;

  return (
    <Box bg={colour("surface")} borderWidth="1px" borderColor={colour("line")} borderRadius="lg" px={{ base: SPACE.lg, md: SPACE.xxl }} pt={SPACE.xl} pb={SPACE.sm}>
      {/* 1. The answer: who and what, the stars and percentage, and one sentence. */}
      <Flex justify="space-between" align="start" gap={SPACE.xl} wrap="wrap">
        <Box flex="1 1 320px" minW={0}>
          <PanelTitle>{candidate.name}</PanelTitle>
          <PanelSubtitle parts={[job.title, job.company, result.brief ? [result.brief.seniority, result.brief.industry].filter(Boolean).join(", ") : ""]} />
          {scored && (result.overview?.summary || result.recommendation) && <Box mt={SPACE.md}><PanelLead>{result.overview?.summary || result.recommendation}</PanelLead></Box>}
          {scored && result.career && <Box mt={SPACE.sm}><PanelText muted testId="match-career">{["Seniority " + CAREER_WORDS.seniority[result.career.seniority], CAREER_WORDS.industry[result.career.industry], CAREER_WORDS.recency[result.career.recency]].join(DOT)}</PanelText></Box>}
        </Box>
        <Box flex="0 0 auto" textAlign={{ base: "left", md: "right" }}>
          {scored ? <>
            <AlignmentStars percent={result.score} size={L.stars} label="Alignment with this role" />
            <Box mt={SPACE.xxs}><PanelSubhead>{result.band}</PanelSubhead></Box>
            <PanelText muted>Evidence confidence: {result.confidence.toLowerCase()}</PanelText>
          </> : <Box data-testid="match-not-scored" maxW="22rem">
            <PanelSubhead>{result.ai?.state === "pending" ? "Being scored by the AI…" : "Not scored"}</PanelSubhead>
            <PanelText muted>{result.ai?.state === "pending" ? "The score appears here when it is final." : result.ai?.reason ?? "This match has no score."}</PanelText>
          </Box>}
        </Box>
      </Flex>

      {scored && <>
        {/* 2. The requirements in one line. */}
        <Box mt={SPACE.xl}>
          <EvidenceBar tally={tally} />
          <Box mt={SPACE.sm} css={{ fontVariantNumeric: "tabular-nums" }}>
            <PanelText muted>{counted.length} requirement{counted.length === 1 ? "" : "s"}: {tally.filter((t) => t.n).map((t) => `${t.n} ${EVIDENCE[t.state].label.toLowerCase().replace(/\bcv\b/, "CV")}`).join(DOT)}</PanelText>
          </Box>
        </Box>

        {/* 3. Strengths and gaps, in one table (owner, 9 Nov 2026: "strength and gaps in the details table is a must"): what the CV shows and what to check, each with its reason. */}
        <Table.Root size={L.table.assessment} variant="line" mt={SPACE.lg} aria-label="Strengths and gaps" css={{ "& td": { verticalAlign: "top" } }}>
          <Table.Header><Table.Row>
            <Table.ColumnHeader w="170px" color={colour("muted")}>Status</Table.ColumnHeader>
            <Table.ColumnHeader color={colour("muted")}>Requirement</Table.ColumnHeader>
            <Table.ColumnHeader color={colour("muted")} display={{ base: "none", md: "table-cell" }}>Reason</Table.ColumnHeader>
          </Table.Row></Table.Header>
          <Table.Body>
            {section("Strengths")}
            {strengths.length === 0 ? none("The CV does not yet show any of the requirements met.") : strengths.map((e) => <Row key={e.label} e={e} testId="match-strength" />)}
            {section("Gaps to Check")}
            {gaps.length === 0 ? none("None: the CV shows every requirement.") : gaps.map((e) => <Row key={e.label} e={e} testId="match-gap" />)}
          </Table.Body>
        </Table.Root>

        {/* Must-haves, always in view (owner, 9 Nov 2026: "must-haves ... should always be present in details, and whether they're met or not ... can't be
            hidden"). The whole checklist, each with its state and reason; select one for the CV's own words. */}
        {mustHaves.length > 0 && <Box mt={SPACE.xl} data-testid="match-must-haves">
          <PanelSubhead>Must-Haves: {mustHaves.filter((e) => e.state === "verified").length} of {mustHaves.length} met</PanelSubhead>
          {mustHaves.map((e) => <Requirement key={e.label} item={e} />)}
        </Box>}

        {/* 4. What to do next. */}
        {actions.length > 0 && <Box bg={colour("nextGround")} borderRadius={L.section.box.radius} p={SPACE.lg} mt={SPACE.md}>
          <Box mb={SPACE.xxs}><PanelSubhead>Next Steps</PanelSubhead></Box>
          <Stack as="ol" gap={SPACE.xxs} pl={SPACE.xl}>{actions.map((a, i) => <li key={i}><PanelText>{a}</PanelText></li>)}</Stack>
        </Box>}
      </>}

      {/* 5. One click away: every requirement with the CV's own words, and how the score was reached. */}
      {scored && rest.length > 0 && <PanelFold title={mustHaves.length ? `Other requirements (${rest.length})` : `Every requirement (${rest.length})`} open={open.all} onToggle={() => setOpen((o) => ({ ...o, all: !o.all }))}>
        <PanelNote>Select a requirement to see the CV's own words.</PanelNote>
        {groups.map((g) => <Box key={g.title} mt={SPACE.md}><PanelSubhead>{g.title} ({g.items.length})</PanelSubhead>{g.items.map((e) => <Requirement key={e.label} item={e} />)}</Box>)}
      </PanelFold>}
      <PanelFold title="How this score was reached" open={open.how} onToggle={() => setOpen((o) => ({ ...o, how: !o.how }))}>
        <Stack gap={SPACE.sm}>
          {scored && result.ai?.state === "checked" && <PanelText muted>{recordedNote(at)}</PanelText>}
          {scored && result.confidenceReasons?.length > 0 && <><PanelText>Evidence confidence is {result.confidence.toLowerCase()} because:</PanelText><Stack as="ul" gap={SPACE.xxs} pl={SPACE.xl}>{result.confidenceReasons.map((r, i) => <li key={i}><PanelText>{r}</PanelText></li>)}</Stack></>}
          {result.brief?.role && <PanelText>The role, as the AI briefed it: {result.brief.role}</PanelText>}
          {result.career?.note && <PanelText>The career as a whole: {result.career.note}</PanelText>}
          {evidence.some((e) => e.reviewFlags?.some((f) => f.kind === "fairness")) && <PanelText>Some of the job's requirements concern a protected characteristic. They are listed but not scored, for or against anyone: whether they apply is the recruiter's decision.</PanelText>}
          {!result.ai && result.logistics?.required && <PanelText>Not part of the score: location and working arrangement ({result.logistics.arrangement}) are {LOGISTICS[result.logistics.status]}. {result.logistics.checks.map((c) => c.explanation).join(" ")}</PanelText>}
          <PanelText><b>Met</b>: the CV shows it. <b>Partly met</b>: some of it is shown. <b>Not shown in the CV</b>: a gap in evidence, not proof the candidate lacks it. <b>CV says otherwise</b>: the CV states the opposite.</PanelText>
          <PanelText muted>{result.disclaimer}</PanelText>
        </Stack>
      </PanelFold>
      {/* The actions stay in reach at the bottom of the window however far the lists are scrolled (owner, 9 Nov 2026: "where'd the option to shortlist go?").
          Held at the very bottom edge of the window's scrolling area: the window pads its bottom by 24 px, and with bottom 0 the bar stopped that far short,
          so rows of the table showed in the strip beneath the buttons (owner, 10 Nov 2026). */}
      <Flex gap={SPACE.sm} wrap="wrap" align="center" position="sticky" bottom={-6} zIndex={1} bg={colour("surface")} borderTopWidth="1px" borderColor={colour("line")} mx={{ base: -SPACE.lg, md: -SPACE.xxl }} px={{ base: SPACE.lg, md: SPACE.xxl }} py={SPACE.md} mt={SPACE.md} data-testid="match-actions">
        <Button size={L.button} variant="outline" href={candidate.originalDocumentUrl} target="_blank" rel="noreferrer" disabled={!candidate.originalDocumentUrl} onClick={() => onAction?.("review-cv")}>View CV</Button>
        <Button size={L.button} variant="outline" href={job.originalDocumentUrl} target="_blank" rel="noreferrer" disabled={!job.originalDocumentUrl}>View job</Button>
        {stage && <Badge colorPalette={stage === NOT_SUITABLE ? LABEL_PALETTE.declined : LABEL_PALETTE.forward} variant="subtle" data-testid="match-stage">{statusLabel(stage)} for this job</Badge>}
        {onAction && <Flex gap={SPACE.sm} ml={{ base: 0, md: "auto" }} wrap="wrap">
          <Button size={L.button} onClick={() => onAction("shortlist")} disabled={stage === "shortlisted"}>{stage === "shortlisted" ? "Shortlisted" : "Shortlist"}</Button>
          <Button size={L.button} variant="outline" colorPalette={LABEL_PALETTE.declined} onClick={() => onAction("not-suitable")} disabled={stage === NOT_SUITABLE}>Not suitable</Button>{/* red, like Delete (owner, 9 Nov 2026) */}
        </Flex>}
      </Flex>
    </Box>
  );
};

export default CandidateMatchPanel;
