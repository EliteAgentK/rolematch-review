// A candidate's card on the board. Which facts it shows; how it looks is the card configuration's (CARD_LOOK, src/config/panels.ts) and the blocks'
// (ui/panel.tsx), the same frame, type and chips as a job's card (owner, 11 Nov 2026: "even the panels on the side need the same treatment").
import React from "react";
import { Box, Flex } from "@chakra-ui/react";
import { FiFileText } from "react-icons/fi";
import { CARD_LOOK, colour, DOT, SPACE } from "../config/panels";
import { rolematchConfig } from "../config/rolematch.config";
import { useSettings } from "../settings/SettingsContext";
import { currentEmployer, currentJob, highestQualification, tidyTitle } from "../utils/candidateFacts";
import { displayCase, employerName } from "../utils/displayCase";
import { uploaded } from "../utils/shortDate";
import { orderSkillsByRecency, splitSkills } from "../utils/skillOrder";
import { forwardStagesOf, useStages } from "../utils/stages";
import MoreSkills from "./MoreSkills";
import ReviewFlag from "./ReviewFlag";
import { Avatar } from "./ui/avatar";
import { CardBadge, CardChips, CardDetail, CardFooter, CardSubtitle, CardTitle, RecordCard } from "./ui/panel";
import { Tooltip } from "./ui/tooltip";

interface Candidate {
  displayNames?: Record<string, string>;   // how details the CV writes in capitals are normally written (from the AI's reading)
  rereading?: { since: string };   // being read again: locked until its new reading is in
  id: string; name: string; role: string; status: string; avatar: string; skills: string[]; rating: number; experience: string; location: string;
  email: string; phone: string; appliedDate: string; uploadedAt?: string; reviewState?: string;
  workHistory?: { position?: string; company?: string; startDate?: string; endDate?: string; responsibilities?: string[] }[];
  education?: { degree?: string; institution?: string; year?: string }[];
  recruiterNotes?: string;
}

interface CandidateCardProps {
  candidate: Candidate;
  isSelected: boolean;
  onClick: () => void;
  onJobMatch?: (candidateId: string, jobId: string) => void;
  /** Keyboard alternative to dragging this card into the Shortlist Matching Zone. */
  onFindMatches?: (candidateId: string) => void;
}

const CandidateCard: React.FC<CandidateCardProps> = ({ candidate, isSelected, onClick, onJobMatch, onFindMatches }) => {
  const { statusLabel, statusColour, settings, nouns } = useSettings();
  const names = candidate.displayNames, cardSkills = settings?.panels.cardSkills ?? 3;   // the organisation's own count (3 until its settings have loaded)
  const { shown, hidden, hiddenCount } = splitSkills(orderSkillsByRecency(candidate.skills, candidate.workHistory), cardSkills);
  // A recruiter's snapshot (owner, 9 Nov 2026): the job they hold now and since when, their highest qualification, then the AI's summary of the career.
  const employer = employerName(currentEmployer(candidate.workHistory), names);
  const since = (() => { const j = currentJob(candidate.workHistory); return /present|current|now/i.test(j?.endDate ?? "") ? (j?.startDate ?? "").match(/(?:19|20)\d\d/)?.[0] ?? "" : ""; })();
  const qualification = displayCase(highestQualification(candidate.education), names);
  const profile = String((candidate as { profile?: string }).profile ?? "").trim();
  const today = displayCase((currentJob(candidate.workHistory)?.position ?? "").trim(), names);
  // Their status is per job: the card says the furthest stage, and for how many jobs, and names the job (owner, 17 Nov 2026: "a way to be able to see
  // what they were shortlisted for, not only on the job"), so no one has to hover or open the person to find it.
  const stagesHere = useStages(), onShortlists = forwardStagesOf(stagesHere.all, candidate.id), latest = onShortlists[0];
  const jobName = (a: { jobTitle: string; jobCompany?: string }) => `${a.jobTitle || nouns.job.one}${a.jobCompany ? `${DOT}${a.jobCompany}` : ""}`;
  const stageList = onShortlists.map((a) => `${statusLabel(a.status)} for ${jobName(a)}`).join("\n");
  const note = (candidate.recruiterNotes ?? "").trim();
  const experience = candidate.experience ? (candidate.experience === "0" ? "under 1 yr" : `${candidate.experience}+ yrs`) : "";
  // One title for a person everywhere (owner, 10 Nov 2026): the card shows the panel's title; the current job is the line below.
  const occupation = tidyTitle(displayCase(candidate.role, names)) || tidyTitle(today);
  const place = displayCase(candidate.location, names), when = uploaded(candidate.uploadedAt, candidate.appliedDate);

  return (
    <RecordCard kind="candidate" id={candidate.id} label={`Candidate ${candidate.name}`} selected={isSelected} busy={!!candidate.rereading} height={CARD_LOOK.height.candidate}
      onClick={onClick} onFindMatches={onFindMatches} onDropOther={onJobMatch ? (jobId) => onJobMatch(candidate.id, jobId) : undefined}>
      <Flex align="flex-start" gap={SPACE.md}>
        <Avatar src={candidate.avatar} name={candidate.name} size={CARD_LOOK.avatar.size} flexShrink={0} borderWidth={CARD_LOOK.avatar.ring} borderColor={isSelected ? colour("chosen") : "transparent"} />
        {/* Name and occupation may wrap to two lines and always keep both, so every card is the same height. */}
        <Box flex="1" minW={0}>
          <CardTitle title={candidate.name}>{candidate.name}</CardTitle>
          <CardSubtitle title={occupation}>{occupation}</CardSubtitle>
          <CardDetail title={employer ? `Current or last employer: ${employer}` : undefined}>{employer ? `at ${employer}${since ? `${DOT}since ${since}` : ""}` : ""}</CardDetail>
          <CardDetail italic title={qualification || undefined} testId="card-qualification">{qualification}</CardDetail>
          {/* The AI's short summary of the career (held to the CV's words), or nothing: the lines above already say who they are today. */}
          <CardDetail lines={2} title={profile || undefined} testId="card-profile">{profile}</CardDetail>
        </Box>
      </Flex>

      <CardChips items={shown} max={cardSkills} none="No skills found" />
      <Flex align="center" justify="space-between" gap={SPACE.sm} minH="22px">
        <MoreSkills all={[...shown, ...hidden]} count={hiddenCount} subject={candidate.name} kind="skills" />
        <Flex align="center" gap={SPACE.sm} flexShrink={0}>
          {note && (
            <Tooltip content={note.length > 120 ? note.slice(0, 120) + "…" : note} openDelay={400} showArrow>
              <Box as="span" role="img" aria-label="Has recruiter notes" color={colour("muted")} display="inline-flex"><FiFileText size={14} /></Box>
            </Tooltip>
          )}
          {rolematchConfig.review.showPrompts && candidate.reviewState === "needs_review" && <ReviewFlag />}
          <CardBadge palette={statusColour(candidate.status)} title={stageList || undefined}>
            {statusLabel(candidate.status)}{onShortlists.length > 1 ? `${DOT}${onShortlists.length}` : ""}
          </CardBadge>
        </Flex>
      </Flex>

      {/* Which job their stage is for, the most recent first; a click opens that saved match, as recorded (nothing is matched again). With more than one,
          "+ n more" opens the person, whose panel lists every job. The line keeps its place when empty, so every card stays the same height. */}
      <Flex align="center" gap={SPACE.sm} minW={0} minH="18px" fontSize={CARD_LOOK.detail.fontSize} lineHeight={CARD_LOOK.detail.lineHeight} color={colour("muted")} data-testid="card-stage-for">
        {latest && (
          <>
            <Box as="button" {...({ type: "button" } as object)} minW={0} truncate textAlign="left" cursor="pointer" title={`Open the saved match: ${statusLabel(latest.status)} for ${jobName(latest)}`}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); void stagesHere.openMatch(candidate.id, latest.jobId); }} onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
              _hover={{ textDecoration: "underline" }} _focusVisible={{ outline: "2px solid", outlineColor: colour("chosen"), outlineOffset: "1px" }} data-testid="card-stage-job">
              {statusLabel(latest.status)} for <Box as="span" color={colour("chosen")} fontWeight={CARD_LOOK.stageJob.fontWeight}>{jobName(latest)}</Box>
            </Box>
            {onShortlists.length > 1 && (
              <Box as="button" {...({ type: "button" } as object)} flexShrink={0} cursor="pointer" color={colour("chosen")} title={stageList}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }} onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
                _hover={{ textDecoration: "underline" }} _focusVisible={{ outline: "2px solid", outlineColor: colour("chosen"), outlineOffset: "1px" }} data-testid="card-stage-more">
                +{onShortlists.length - 1} more
              </Box>
            )}
          </>
        )}
      </Flex>

      <CardFooter>
        <Tooltip content={place} openDelay={400} disabled={!place}>
          <Box lineClamp={1} minW={0} title={place}>{place}</Box>
        </Tooltip>
        {/* The date as a recruiter says it ("10 Nov", with the year only when it is not this year), so the location keeps the room it needs. */}
        <Box flexShrink={0} title={when.title}>{[experience, when.text].filter(Boolean).join(DOT)}</Box>
      </CardFooter>
    </RecordCard>
  );
};

export default CandidateCard;
