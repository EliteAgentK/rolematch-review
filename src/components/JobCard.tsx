// A job's card on the board. Which facts it shows; how it looks is the card configuration's (CARD_LOOK, src/config/panels.ts) and the blocks'
// (ui/panel.tsx), the same frame, type and chips as a candidate's card (owner, 11 Nov 2026: "even the panels on the side need the same treatment").
import React from "react";
import { Box, Flex } from "@chakra-ui/react";
import { CARD_LOOK, DOT, LABEL_PALETTE, SPACE } from "../config/panels";
import { rolematchConfig } from "../config/rolematch.config";
import { displayCase } from "../utils/displayCase";
import { uploaded } from "../utils/shortDate";
import { splitSkills } from "../utils/skillOrder";
import { useStages } from "../utils/stages";
import MoreSkills from "./MoreSkills";
import ReviewFlag from "./ReviewFlag";
import { Button } from "./ui/button";
import { CardBadge, CardChips, CardDetail, CardFooter, CardSubtitle, CardTitle, RecordCard } from "./ui/panel";

interface Job {
  id: string; title: string; company: string; location: string; type: string; department: string;
  town?: string;    // the town of its location (server/src/places.ts): "Johannesburg", never "Johannesburg, Gauteng"
  group?: string;   // the standard department (jobReader.ts); the job's own unit stays in department
  description: string; requirements: string[]; postedDate: string; uploadedAt?: string; skills?: string[];
  rereading?: { since: string };   // being read again by the AI: locked until its new reading is in
}

interface JobCardProps {
  job?: Job;
  isSelected: boolean;
  onClick: () => void;
  onCandidateMatch?: (candidateId: string, jobId: string) => void;
  /** Keyboard alternative to dragging this card into the Shortlist Matching Zone. */
  onFindMatches?: (jobId: string) => void;
}

const JobCard: React.FC<JobCardProps> = ({ job, isSelected, onClick, onCandidateMatch, onFindMatches }) => {
  const stages = useStages(), shortlisted = job ? stages.all.filter((a) => a.jobId === job.id && a.status === "shortlisted").length : 0;
  if (!job) return null;
  const { shown, hidden, hiddenCount } = splitSkills(job.skills ?? []);
  const placeAndType = [displayCase(job.town || job.location), job.type].filter(Boolean).join(DOT), when = uploaded(job.uploadedAt, job.postedDate);

  return (
    <RecordCard kind="job" id={job.id} label={`Job ${job.title} at ${job.company}`} selected={isSelected} busy={!!job.rereading} height={CARD_LOOK.height.job}
      onClick={onClick} onFindMatches={onFindMatches} onDropOther={onCandidateMatch ? (candidateId) => onCandidateMatch(candidateId, job.id) : undefined}>
      <Flex direction="column" h="100%">
        {/* Title and company may wrap to two lines and always keep both, so every card is the same height. */}
        <CardTitle title={job.title}>{displayCase(job.title)}</CardTitle>
        <CardSubtitle title={job.company}>{displayCase(job.company)}</CardSubtitle>
        <CardDetail title={placeAndType}>{placeAndType}</CardDetail>
        <Flex align="center" gap={SPACE.sm} mt={SPACE.sm} h="20px">
          {rolematchConfig.review.showPrompts && (job as any).reviewState === "needs_review" && <ReviewFlag />}
          {(job.group || job.department) && <CardBadge palette={LABEL_PALETTE.department} title={[job.group, job.department].filter(Boolean).join(DOT)}>{job.group || displayCase(job.department)}</CardBadge>}
        </Flex>
        <Box mt={SPACE.sm}><CardDetail lines={2}>{job.description}</CardDetail></Box>
        <CardChips items={shown} max={3} none="No skills listed" />
        <MoreSkills all={[...shown, ...hidden]} count={hiddenCount} subject={job.title} kind="skills" />
        <CardFooter>
          <span title={when.title}>{when.text}</span>
          {/* Who is shortlisted for this role, one click from the list (owner, 10 Nov 2026). Opens the role's saved shortlist; shown only when someone is on it. */}
          {shortlisted > 0 && <Button size={CARD_LOOK.button} variant="outline" data-testid="card-shortlisted" onClick={(e: React.MouseEvent) => { e.stopPropagation(); stages.openShortlist(job as any); }}
            title={`Open the ${shortlisted} shortlisted for this role`}>Shortlisted{DOT}{shortlisted}</Button>}
        </CardFooter>
      </Flex>
    </RecordCard>
  );
};

export default JobCard;
