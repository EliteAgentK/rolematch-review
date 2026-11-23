// A list of matches: a job's saved shortlist, or the results of Find matches. Which facts go where; how it looks is the panel configuration's
// (src/config/panels.ts) and the blocks' (ui/panel.tsx), the same as the panels' and cards' (owner, 11 Nov 2026: "I don't want this one differing from the next").
import type { MatchResult } from "@/api/client";
import { useState } from "react";
import { Badge, Box, Flex, Icon, Table, Text, useBreakpointValue, useDisclosure } from "@chakra-ui/react";
import { FiCalendar, FiEye, FiMapPin } from "react-icons/fi";
import { Candidate, Job } from "@/types/records";
import { CARD_LOOK, colour, LABEL_PALETTE, LOGISTICS_PALETTE, PANEL_LOOK as L, SPACE } from "../config/panels";
import { rolematchConfig } from "../config/rolematch.config";
import { useSettings } from "../settings/SettingsContext";
import { displayCase } from "../utils/displayCase";
import { NOT_SUITABLE, useStages } from "../utils/stages";
import AlignmentStars from "./AlignmentStars";
import CandidateMatchPanel from "./CandidateMatchPanel";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import AssessmentDialog from "./AssessmentDialog";
import { BrandMark } from "./BrandLoader";
import { CardBadge, PanelNote, PanelSelect, PanelSubhead, PanelSubtitle, PanelText, PanelTitle } from "./ui/panel";

interface ShortlistResultsProps {
  results: Array<{ candidate: Candidate; job: Job; matchResult: any }>;
  matchType: "candidate-to-jobs" | "job-to-candidates";
  onClose: () => void;
  /** A job's saved shortlist (not a fresh run): each row shows the person's status for this job, which a recruiter can move on or clear. */
  saved?: boolean;
  /** Shortlist or Not suitable, chosen from a candidate's details here: recorded for that job only. */
  onDecide?: (candidate: Candidate, job: Job, action: "shortlist" | "review-cv" | "not-suitable") => void;
}

// Logistics (place, on-site, hybrid) is shown beside the score, never inside it. Older stored results only have locationMatch.
const logisticsOf = (m: MatchResult): { text: string; palette: string } => {
  const l = m.logistics;
  if (l) {
    if (!l.required) return { text: "No location requirement", palette: LOGISTICS_PALETTE.none };
    const where = l.level === "same city" ? "Same city" : l.level === "same province" ? "Same province" : l.level === "same country" ? "Other province" : l.level === "different country" ? "Other country" : "Location";
    if (l.status === "conflict") return { text: "Logistics conflict to resolve", palette: LOGISTICS_PALETTE.conflict };
    if (l.status === "compatible") return { text: `${where}: compatible`, palette: LOGISTICS_PALETTE.compatible };
    return { text: `${where}: to confirm`, palette: LOGISTICS_PALETTE.to_confirm };
  }
  return m.locationMatch === true ? { text: "Location aligns", palette: LOGISTICS_PALETTE.compatible } : m.locationMatch === false ? { text: "Location to confirm", palette: LOGISTICS_PALETTE.none } : { text: "Location not assessed", palette: LOGISTICS_PALETTE.none };
};

/** A detail with its small round icon, the icon in the colour of what it says. */
function Detail({ icon, palette, children }: { icon: typeof FiMapPin; palette: string; children: string }) {
  return (
    <Flex align="center" gap={SPACE.sm}>
      <Flex align="center" justify="center" w="24px" h="24px" borderRadius="full" colorPalette={palette} bg="colorPalette.badgeSubtleBg" color="colorPalette.badgeSubtleFg" flexShrink={0}><Icon as={icon} boxSize="12px" /></Flex>
      <PanelText strong>{children}</PanelText>
    </Flex>
  );
}
const COLUMN = { textTransform: "uppercase" as const, fontSize: L.facts.label.fontSize, letterSpacing: L.facts.label.letterSpacing, color: colour("muted") };

const ShortlistResults: React.FC<ShortlistResultsProps> = ({ results, matchType, onClose, saved = false, onDecide }) => {
  const stages = useStages(), { settings, statusLabel, nouns } = useSettings();
  const stageOf = (candidateId: string, jobId: string) => stages.all.find((a) => a.candidateId === candidateId && a.jobId === jobId)?.status;
  // The stages a recruiter can move someone to for a job: the organisation's own statuses, past the first.
  const stageChoices = (settings?.statuses ?? []).filter((x) => x.active && x.key !== "new").map((x) => x.key);
  const { open: isOpen, onOpen, onClose: closeModal } = useDisclosure();
  // The match open in the Details window, by its pair, never by its row: on a saved shortlist a person marked not suitable leaves the list at once,
  // and a row number then pointed at the next person, whom a second click would also have marked (review 16 Nov 2026). The window keeps showing
  // the person it was opened for, from the full list.
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const pairOf = (r: { candidate: { id: string }; job: { id: string } }) => `${r.candidate.id}:${r.job.id}`;
  const selected = selectedPair === null ? undefined : results.find((r) => pairOf(r) === selectedPair);
  // On a phone each match is a card of its own, everything in one column (owner, 11 Nov 2026: the five-column table was cut off on a phone, "can't
  // even see the details"). The same pieces as the table's, in the same order; only the arrangement changes. Read at once, never after a first frame.
  const phone = useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false;

  // The list opens only when every score is final (Dashboard waits for the AI), already in the approved review order (src/utils/reviewOrder.ts). It is
  // never re-sorted here by the headline score; the stars never rank anything; a match the AI could not score comes last, with no score.
  // On a saved shortlist, someone taken off it (cleared, or marked not suitable) leaves the list at once.
  const sortedResults = saved ? results.filter((r) => { const st = stageOf(r.candidate.id, r.job.id); return !!st && st !== NOT_SUITABLE; }) : results;
  const unscored = results.filter((r) => r.matchResult.ai && r.matchResult.ai.state !== "checked").length;
  // Who or what everyone here is matched against: one candidate against many jobs, or one job against many candidates.
  const first = results[0], source = !first ? null : matchType === "candidate-to-jobs"
    ? { kind: "candidate" as const, name: first.candidate.name, line: displayCase(first.candidate.role, first.candidate.displayNames), avatar: first.candidate.avatar }
    : { kind: "job" as const, name: displayCase(first.job.title), line: displayCase(first.job.department), avatar: "" };
  const heading = saved ? `Shortlist for This ${nouns.job.one}` : matchType === "candidate-to-jobs" ? `${nouns.job.many} Matching This ${nouns.candidate.one}` : `${nouns.candidate.many} Matching This ${nouns.job.one}`;

  return (
    <Box borderRadius="xl" overflow="hidden" boxShadow="xl" bg={colour("surface")}>
      {/* Who or what this list is about, under the logo. */}
      <Box p={phone ? SPACE.lg : SPACE.xxl} borderBottom="1px solid" borderColor={colour("line")}>
        <Flex direction="column" align="center" gap={SPACE.md} mb={SPACE.md}>
          <BrandMark height={L.listLogo} />
          <Badge colorPalette={L.more.palette} variant="solid" size={L.badge.status}>{saved ? `${sortedResults.length} on the shortlist` : `${sortedResults.length} compared`}</Badge>
        </Flex>
        {source && (
          <Flex justify="center">
            <Flex align="center" gap={SPACE.md} bg={colour("heroGround")} color={colour("heroInk")} p={SPACE.lg} borderRadius="lg" boxShadow="sm" textAlign={source.kind === "job" ? "center" : "left"}>
              {source.kind === "candidate" && <Avatar size={CARD_LOOK.avatar.size} name={source.name} src={source.avatar} />}
              <Box><PanelTitle>{source.name}</PanelTitle><PanelSubtitle parts={[source.line]} /></Box>
            </Flex>
          </Flex>
        )}
      </Box>

      {/* What this list is. */}
      <Box p={SPACE.md} bg={colour("band")} color={colour("bandInk")} textAlign="center">
        <Text fontWeight={L.fold.fontWeight} fontSize={L.fold.fontSize}>{heading}</Text>
        {saved ? <Text fontSize={L.text.fontSize} mt={SPACE.xxs}>Everyone a recruiter has shortlisted for this job, with their saved scores. Nothing is matched again.</Text>
          : <Text fontSize={L.text.fontSize} mt={SPACE.xxs} data-testid="ai-progress">Every score is the AI's final assessment of the CV against the role{unscored ? `; ${unscored} could not be scored and ${unscored === 1 ? "is" : "are"} listed last` : ""}.</Text>}
      </Box>

      {(() => {
        const columns = [
          "Review order", matchType === "candidate-to-jobs" ? nouns.job.one : nouns.candidate.one,
          matchType === "candidate-to-jobs" ? "This candidate's alignment with the role" : "Alignment with this role", "Key details", "Action",
        ];
        const rows = sortedResults.map((result, index) => {
          const st = stageOf(result.candidate.id, result.job.id), place = logisticsOf(result.matchResult), scoredByAi = !result.matchResult.ai || result.matchResult.ai.state === "checked";
          const consequential = (result.matchResult.notices ?? []).filter((x: { consequential: boolean }) => x.consequential);
          const order = <Box w="36px" textAlign={phone ? "left" : "center"}><PanelText muted strong>{index + 1}</PanelText></Box>;
          const who = matchType === "candidate-to-jobs" ? (
            <Flex align="center" gap={SPACE.sm} wrap="wrap" minW={0}>
              <PanelSubhead>{displayCase(result.job.title)}</PanelSubhead>
              {String(result.job.department ?? "").trim() && <CardBadge palette={LABEL_PALETTE.department} title={result.job.department}>{displayCase(result.job.department)}</CardBadge>}
            </Flex>
          ) : (
            <Flex align="center" gap={SPACE.sm} minW={0}>
              <Avatar size={CARD_LOOK.avatar.size} name={result.candidate.name} src={result.candidate.avatar} />
              <Box minW={0}><PanelSubhead>{result.candidate.name}</PanelSubhead><PanelNote>{displayCase(result.candidate.role, result.candidate.displayNames)}</PanelNote></Box>
            </Flex>
          );
          const score = (
            <Flex direction="column" align="flex-start" gap={SPACE.xxs}>
              {!scoredByAi
                ? <><PanelSubhead testId="match-not-scored">Not scored</PanelSubhead><Box maxW="18rem"><PanelNote>{result.matchResult.ai.reason ?? "The AI could not score this match."}</PanelNote></Box></>
                : <><AlignmentStars percent={result.matchResult.score} /><PanelNote>Evidence confidence: {result.matchResult.confidence.toLowerCase()}</PanelNote></>}
              {/* What must be read before relying on this result, kept to one quiet line here; the details list each one. */}
              {rolematchConfig.review.showPrompts && consequential.length > 0 && <Text fontSize={L.note.fontSize} color={colour("caution")} title={consequential.map((x: { text: string }) => x.text).join("\n")}><Box as="span" aria-hidden>⚠ </Box>{consequential.length === 1 ? "1 point to check" : `${consequential.length} points to check`} before relying on it</Text>}
            </Flex>
          );
          const details = (
            <Flex direction="column" align="flex-start" gap={SPACE.sm}>
              <Detail icon={FiMapPin} palette={place.palette}>{place.text}</Detail>
              <Detail icon={FiCalendar} palette={LOGISTICS_PALETTE.to_confirm}>{result.matchResult.experienceYears ? `${result.matchResult.experienceYears} years of dated experience` : "Experience duration unknown"}</Detail>
            </Flex>
          );
          const actions = (
            <Flex direction="column" align="stretch" gap={SPACE.sm}>
              <Button size={L.button} leftIcon={<FiEye />} colorPalette={L.more.palette} variant="outline" onClick={() => { setSelectedPair(pairOf(result)); onOpen(); }}>Details</Button>
              {/* This person's status for this job: shown wherever there is one; changed here on a saved shortlist. */}
              {saved && !stages.readOnly
                ? <PanelSelect label={`Status of ${result.candidate.name} for this job`} value={st ?? ""} onChange={(v) => void stages.set(result.candidate.id, result.job.id, v || null)} testId="stage-select"
                    options={[...stageChoices.map((k) => ({ value: k, label: statusLabel(k) })), { value: "", label: "Remove from shortlist" }]} />
                : st ? <Badge alignSelf="flex-start" colorPalette={st === NOT_SUITABLE ? LABEL_PALETTE.declined : LABEL_PALETTE.forward} variant="subtle" data-testid="stage-badge">{statusLabel(st)}</Badge> : null}
            </Flex>
          );
          return { index, cells: [order, who, score, details, actions] };
        });
        const stripe = (index: number) => (index % 2 === 0 ? colour("rowAlt") : undefined);
        return phone ? (
          <Box role="list" aria-label={heading} data-testid="match-list">
            {rows.map(({ index, cells: [order, who, score, details, actions] }) => (
              <Flex key={index} role="listitem" direction="column" gap={SPACE.md} p={SPACE.lg} bg={stripe(index)} borderBottom="1px solid" borderColor={colour("line")} data-testid="match-row">
                <Flex align="flex-start" gap={SPACE.sm}>{order}<Box flex="1" minW={0}>{who}</Box></Flex>
                <Box><Text {...COLUMN} mb={SPACE.xxs}>{columns[2]}</Text>{score}</Box>
                <Box><Text {...COLUMN} mb={SPACE.xxs}>{columns[3]}</Text>{details}</Box>
                {actions}
              </Flex>
            ))}
          </Box>
        ) : (
          <Table.Root size={L.table.list} data-testid="match-list">
            <Table.Header bg={colour("listHead")}>
              <Table.Row>{columns.map((c) => <Table.ColumnHeader key={c} {...COLUMN}>{c}</Table.ColumnHeader>)}</Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map(({ index, cells }) => (
                <Table.Row key={index} bg={stripe(index)} _hover={{ bg: colour("rowHover") }} transition="all 0.2s ease" data-testid="match-row">
                  {cells.map((c, i) => <Table.Cell key={i}>{c}</Table.Cell>)}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        );
      })()}

      <Flex justify="flex-end" p={SPACE.lg} borderTop="1px solid" borderColor={colour("line")}>
        <Button onClick={onClose} colorPalette={L.more.palette}>Close Shortlist</Button>
      </Flex>

      {/* One match in full: the same assessment as everywhere else. */}
      {selected && (
        <AssessmentDialog open={isOpen} onClose={closeModal} who={selected.candidate.name} what={selected.job.title}>
          <CandidateMatchPanel candidate={selected.candidate} job={selected.job} result={selected.matchResult}
            onAction={onDecide ? (action) => onDecide(selected.candidate, selected.job, action) : undefined} />
        </AssessmentDialog>
      )}
    </Box>
  );
};

export default ShortlistResults;
