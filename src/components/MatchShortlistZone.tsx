// The Shortlist Matching Zone: choose one candidate or job (or drop a card here) and find all its matches. Which words go where; how it looks is the
// panel configuration's (src/config/panels.ts), the same colours, sizes and spacing as the panels and cards (owner, 11 Nov 2026).
import React, { useState } from "react";
import { Box, Center, chakra, Flex, Icon, Text } from "@chakra-ui/react";
import { FiArrowDown, FiSearch, FiTarget } from "react-icons/fi";
import { Candidate, Job } from "@/types/records";
import { colour, PANEL_LOOK as L, SPACE } from "../config/panels";
import { useSettings } from "../settings/SettingsContext";
import { displayCase } from "../utils/displayCase";
import { Button } from "./ui/button";
import { PanelText } from "./ui/panel";

/** "a candidate", "an applicant": the organisation chooses the word (Settings, Wording), so the article follows it. */
const withArticle = (word: string) => { const w = word.toLowerCase(); return `${/^[aeiou]/.test(w) ? "an" : "a"} ${w}`; };

interface MatchShortlistZoneProps {
  onMatchMultiple: (itemId: string | Candidate | Job, type: "candidate" | "job") => void;
  /** What the zone offers when clicked, as an alternative to dragging a card up (the records on the board). */
  candidates?: Candidate[];
  jobs?: Job[];
  /** While a comparison is running the zone refuses new drops (the progress pop-up shows what is happening). */
  busy?: { name: string; against: string } | null;
}

const MatchShortlistZone: React.FC<MatchShortlistZoneProps> = ({ onMatchMultiple, busy, candidates = [], jobs = [] }) => {
  const { nouns } = useSettings();
  // Clicking the zone opens a chooser: pick one candidate or job, then press the button. Choosing alone never starts matching.
  const [picking, setPicking] = useState(false);
  const [side, setSide] = useState<"candidate" | "job">("candidate");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const openPicker = () => { if (busy || picking) return; setPicking(true); setChosen(null); setQuery(""); setSide(candidates.length || !jobs.length ? "candidate" : "job"); };
  const closePicker = () => { setPicking(false); setChosen(null); };
  const q = query.trim().toLowerCase();
  // Names, titles and companies by the one display rule, as everywhere else.
  const rows = (side === "candidate"
    ? candidates.map((c) => ({ id: c.id, main: c.name, sub: displayCase(c.role, c.displayNames) }))
    : jobs.map((j) => ({ id: j.id, main: displayCase(j.title), sub: displayCase(j.company) }))
  ).filter((r) => !q || `${r.main} ${r.sub ?? ""}`.toLowerCase().includes(q));
  const chosenRow = rows.find((r) => r.id === chosen) ?? null;
  const start = () => { if (!chosen || busy) return; onMatchMultiple(chosen, side); closePicker(); };
  const drop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    if (busy) return;   // one comparison at a time
    const type = e.dataTransfer.getData("type") as "candidate" | "job", id = e.dataTransfer.getData("text/plain");
    if (type === "candidate" || type === "job") onMatchMultiple(id, type);
  };
  const plural = (k: "candidate" | "job") => (k === "candidate" ? nouns.candidate.many : nouns.job.many);

  return (
    <Box p={SPACE.lg} mb={SPACE.lg} bg={colour(over ? "dropping" : "surface")} border="1px solid" borderColor={colour(over ? "chosen" : "line")} borderRadius="lg" textAlign="center"
      boxShadow={over ? "0 0 5px var(--chakra-colors-panel-chosen)" : "sm"} transition="all 0.2s ease" cursor={picking || busy ? "default" : "pointer"}
      _hover={picking || busy ? undefined : { borderColor: colour("chosen"), boxShadow: "md", bg: colour("dropping") }}
      onDragOver={(e) => { e.preventDefault(); if (busy) { e.dataTransfer.dropEffect = "none"; return; } setOver(true); e.dataTransfer.dropEffect = "copy"; }} onDragLeave={() => setOver(false)} onDrop={drop}
      onClick={openPicker} onKeyDown={(e) => { if (!picking && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPicker(); } }}
      role={picking ? undefined : "button"} tabIndex={picking ? undefined : 0}
      aria-label={picking ? undefined : `Shortlist Matching Zone: choose ${withArticle(nouns.candidate.one)} or ${nouns.job.one.toLowerCase()} to find all potential matches`}>
      <Center>
        <Flex direction="column" align="center" justify="center" py={SPACE.xxs} maxW={picking ? "560px" : "640px"} w="100%">
          <Icon as={FiTarget} boxSize={6} color={colour("chosen")} mb={SPACE.sm} opacity={over ? 1 : 0.8} transform={over ? "scale(1.1)" : "scale(1)"} transition="all 0.2s ease" />
          <Text fontWeight={L.fold.fontWeight} fontSize={L.text.fontSize} mb={SPACE.xxs} color={colour("chosen")}>Shortlist Matching Zone</Text>
          <Box mb={SPACE.sm}><PanelText>Click to choose {withArticle(nouns.candidate.one)} or {nouns.job.one.toLowerCase()}, or drop one here, to find all potential matches</PanelText></Box>
          <Flex align="center" justify="center" gap={SPACE.sm} bg={over ? colour("dropping") : "transparent"} py={SPACE.xxs} px={SPACE.md} borderRadius="md" opacity={over ? 1 : 0.7} transition="all 0.2s ease">
            <Icon as={FiArrowDown} color={colour("chosen")} boxSize={3} />
            <Text fontSize={L.note.fontSize} color={colour("faint")}>Find all possible matches</Text>
          </Flex>

          {picking && (
            <Box className="rm-reveal" mt={SPACE.sm} w="100%" textAlign="left" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose what to find matches for"
              onKeyDown={(e) => { if (e.key === "Escape") closePicker(); }}>
              <Flex gap={SPACE.xxs} mb={SPACE.sm} role="tablist">
                {(["candidate", "job"] as const).map((k) => (
                  <Box as="button" key={k} role="tab" aria-selected={side === k} onClick={() => { setSide(k); setChosen(null); }}
                    flex={1} py={SPACE.xxs} fontSize={L.text.fontSize} fontWeight={side === k ? "semibold" : "normal"} color={colour(side === k ? "chosen" : "faint")}
                    borderBottom="2px solid" borderColor={side === k ? colour("chosen") : "transparent"}>
                    {plural(k)} ({k === "candidate" ? candidates.length : jobs.length})
                  </Box>))}
              </Flex>
              <Flex align="center" gap={SPACE.sm} px={SPACE.sm} mb={SPACE.sm} border="1px solid" borderColor={colour("line")} borderRadius="md">
                <Icon as={FiSearch} color={colour("faint")} boxSize={3.5} />
                <chakra.input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setChosen(null); }} placeholder={side === "candidate" ? "Search by name or role" : "Search by title or company"}
                  aria-label="Search" flex={1} py={SPACE.xs} bg="transparent" border={0} outline="none" color="inherit" fontSize={L.text.fontSize} />
              </Flex>
              <Box maxH="220px" overflowY="auto" border="1px solid" borderColor={colour("line")} borderRadius="md" role="listbox" aria-label={plural(side)}>
                {rows.length === 0 ? (
                  <Box p={SPACE.md}><PanelText muted>{(side === "candidate" ? candidates : jobs).length === 0 ? `No ${plural(side).toLowerCase()} on the board yet.` : "Nothing matches that search."}</PanelText></Box>
                ) : rows.map((r) => (
                  <Box as="button" key={r.id} role="option" aria-selected={chosen === r.id} onClick={() => setChosen(r.id)}
                    display="block" w="100%" textAlign="left" px={SPACE.md} py={SPACE.sm} bg={chosen === r.id ? colour("dropping") : "transparent"} _hover={{ bg: chosen === r.id ? colour("dropping") : colour("rowAlt") }}>
                    <Text fontSize={L.text.fontSize} fontWeight={L.text.strong} color={colour("body")} lineClamp={1}>{r.main}</Text>
                    {r.sub && <Text fontSize={L.note.fontSize} color={colour("faint")} lineClamp={1}>{r.sub}</Text>}
                  </Box>))}
              </Box>
              <Flex justify="flex-end" gap={SPACE.sm} mt={SPACE.md}>
                <Button size={L.button} variant="ghost" onClick={closePicker}>Cancel</Button>
                {/* The same short words whatever was picked (owner, 11 Nov 2026: "Find matches for this role. That's it."): a long title made the button
                    overflow. The picked row stays highlighted above. */}
                <Button size={L.button} disabled={!chosenRow || !!busy} onClick={start}>
                  {chosenRow ? `Find matches for this ${(side === "candidate" ? nouns.candidate.one : nouns.job.one).toLowerCase()}` : "Choose one to find matches"}
                </Button>
              </Flex>
            </Box>
          )}
        </Flex>
      </Center>
    </Box>
  );
};

export default MatchShortlistZone;
