import { Badge, Box, Flex, Stack, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useColorModeValue } from "../theme/color-mode";
import { CheckIcon, TimeIcon } from "./ui/icons";
import { rolematchConfig } from "@/config/rolematch.config";
import { keyframes } from "@emotion/react";

// A card slides in the moment a file is chosen, and each step that finishes ticks in, so the person always sees something happening.
const enter = keyframes`from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: none; }`;
const tick = keyframes`0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.25); } 100% { transform: scale(1); opacity: 1; }`;
const pulse = keyframes`0%, 100% { opacity: 0.55; } 50% { opacity: 1; }`;
const flow = keyframes`0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; }`;

// The bar moves smoothly, in the wordmark's colours like the matching window (owner, 9 Nov 2026: "load up nicely ... not jump from 13 to 88"). Each step has a
// share of the bar by how long it usually takes (measured: the AI's reading of a real CV is most of the time), the bar creeps through the step under way and
// never passes the start of the next one until that step really begins, and it reaches 100% only when the record is published.
const COLOURS = ["#007BA7", "#3DB58C", "#FFD600", "#F55F3C", "#5F3FD1"];
const SECONDS: Record<string, number> = { received: 1, security: 1, optimising: 3, reading: 6, extracting: 3, validating: 1, auditing: 40, ready: 0 };
export interface Goal { floor: number; ceiling: number; seconds: number }
const KEYS = rolematchConfig.processingStages.map((st) => st.key as string);
const TOTAL = KEYS.reduce((a, k) => a + (SECONDS[k] ?? 1), 0), startOf = (i: number) => (i <= 0 ? 0 : (100 * KEYS.slice(0, i).reduce((a, k) => a + (SECONDS[k] ?? 1), 0)) / TOTAL);
/** Where one file's bar may stand at a step: from the step's start, creeping toward (never past) the next step's start. CVs and job descriptions alike
 *  are read by the AI at the "auditing" step, so both bars give it its share. */
export function stageGoal(stageKey: string | null, complete: boolean): Goal {
  const i = stageKey ? KEYS.indexOf(stageKey) : -1;
  return complete ? { floor: 100, ceiling: 100, seconds: 1 } : i < 0 ? { floor: 0, ceiling: 2, seconds: 4 } : { floor: startOf(i), ceiling: startOf(i + 1) - 1, seconds: SECONDS[KEYS[i]] ?? 2 };
}
/** A number that moves smoothly toward its goal: catches up quickly to the floor, then creeps toward the ceiling. Used by a file's bar and a batch's. */
export function useCreep(target: Goal) {
  const [shown, setShown] = useState(0), ref = useRef(0), goal = useRef(target);
  goal.current = target;
  useEffect(() => {
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.5, (now - last) / 1000), { floor, ceiling, seconds } = goal.current; last = now;
      let next = ref.current;
      if (next < floor) next = Math.min(floor, next + Math.max(30, (floor - next) * 2) * dt);            // a step finished: catch up quickly but visibly
      else if (next < ceiling) next = next + ((ceiling - next) * dt) / Math.max(1, seconds * 0.6);    // within a step: creep toward its end, never past it
      if (Math.floor(next) !== Math.floor(ref.current)) setShown(next);
      ref.current = next;
      if (next < 100) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return Math.min(100, Math.floor(shown));
}
/** The bar itself: every brand colour in the filled part from the first moment, flowing while the work goes on (owner, 9 Nov 2026: at 5% only the first
 *  colour, blue, showed, which read as the old plain bar). */
export function Bar({ percent, thin = false, waiting = false }: { percent: number; thin?: boolean; waiting?: boolean }) {
  const track = useColorModeValue("gray.100", "gray.700"), p = Math.max(waiting ? 0 : 2, percent);
  return (
    <Box h={thin ? "6px" : "8px"} bg={track} borderRadius="full" overflow="hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <Box h="100%" w={`${Math.max(p, waiting ? 0 : 6)}%`} borderRadius="full" transition="width .2s linear" bgImage={`linear-gradient(90deg, ${[...COLOURS, COLOURS[0]].join(", ")})`} bgSize="200% 100%"
        css={{ animation: waiting ? `${pulse} 1.2s ease-in-out infinite` : percent < 100 ? `${flow} 2.4s linear infinite` : undefined, "@media (prefers-reduced-motion: reduce)": { animation: "none" } }} />
    </Box>
  );
}

/** `held`: accepted while the service was briefly unavailable and kept, encrypted, on RoleMatch's own server; processing starts when it is back. */
/** `uploading`: the file is on its way to the server (the request has not been answered yet). */
/** `compact`: one line per file, used when several are being read at once, so a batch is a short list rather than a column of tall cards (owner, 8 Nov). */
/** `paused`: the connection was lost while the file was being sent; sending carries on by itself when it is back, and `onCancel` stops it. */
interface Props { fileName: string; documentType: "CV" | "Job description"; stageIndex: number; held?: boolean; uploading?: boolean; compact?: boolean; paused?: boolean; onCancel?: () => void }

export default function DocumentProcessingCard({ fileName, documentType, stageIndex, held = false, uploading = false, compact = false, paused = false, onCancel }: Props) {
  const stages = rolematchConfig.processingStages;
  const muted = useColorModeValue("gray.600", "gray.400");
  if (held || uploading) stageIndex = -1; // nothing has been processed yet, so no step is shown as done
  const complete = stageIndex >= stages.length - 1;
  const progress = useCreep(stageGoal(held || uploading ? null : (stages[Math.max(0, stageIndex)]?.key as string), complete));
  const rowBorder = useColorModeValue("gray.200", "gray.700");
  if (compact) {
    const now = held ? "Waiting" : paused ? "Paused: waiting for the connection" : uploading ? "Sending" : stages[Math.max(0, stageIndex)]?.label ?? "";
    return (
      <Flex align="center" gap={3} py={2} borderBottomWidth="1px" borderColor={rowBorder} minW={0} aria-live="polite">
        <Box flex="1" minW={0}>
          <Text fontSize="sm" fontWeight="medium" lineClamp={1} title={fileName}>{fileName}</Text>
          <Text fontSize="xs" color={muted} lineClamp={1}>{now}</Text>
        </Box>
        <Box w="28%" minW="60px"><Bar percent={held ? 0 : progress} thin waiting={uploading} /></Box>
        <Badge colorPalette={held ? "orange" : complete ? "green" : "blue"} minW="3.2rem" justifyContent="center">{held ? "Held" : uploading ? "…" : complete ? "Ready" : `${progress}%`}</Badge>
        {paused && onCancel && <Box as="button" {...({ type: "button" } as object)} onClick={onCancel} fontSize="xs" fontWeight="semibold" color="red.400" cursor="pointer">Cancel</Box>}
      </Flex>
    );
  }
  return (
    <Box borderWidth="1px" borderColor={useColorModeValue("blue.200", "blue.700")} bg={useColorModeValue("white", "gray.800")} borderRadius="xl" p={4} boxShadow="md" css={{ animation: `${enter} 0.28s ease-out` }} aria-live="polite">
      <Flex justify="space-between" gap={3} mb={3} align="start">
        <Box minW={0}>
          <Text fontSize="xs" textTransform="uppercase" color="blue.500" fontWeight="bold">{documentType} processing</Text>
          <Text fontWeight="bold" lineClamp={1}>{fileName}</Text>
        </Box>
        <Badge colorPalette={held ? "orange" : complete ? "green" : "blue"} css={uploading ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}>{held ? "Waiting" : paused ? "Paused" : uploading ? "Sending" : complete ? "Ready" : `${progress}%`}</Badge>
      </Flex>
      {held && <Text fontSize="sm" mb={3} color={muted}>Saved safely. The service is briefly unavailable, so this file is held, encrypted, on RoleMatch's own server. Processing starts by itself when the service is back; you do not need to upload it again.</Text>}
      {uploading && !paused && <Text fontSize="sm" mb={3} color={muted}>Sending your file securely to the server. The steps below start as soon as it arrives.</Text>}
      {paused && <Flex fontSize="sm" mb={3} color={muted} gap={3} align="start" justify="space-between" data-testid="upload-paused"><Text>Paused: waiting for the connection. Nothing is lost: sending carries on by itself as soon as the connection is back. Keep this page open.</Text>
        {onCancel && <Box as="button" {...({ type: "button" } as object)} onClick={onCancel} fontWeight="semibold" color="red.400" cursor="pointer" flexShrink={0}>Cancel</Box>}</Flex>}
      <Box mb={4}><Bar percent={held ? 0 : progress} waiting={uploading} /></Box>
      <Stack gap={2}>
        {stages.map((stage, index) => {
          if (stage.key === "auditing" && stageIndex !== index) return null;   // shown only for a document at this step: where the auditor is switched off, nothing claims it looked
          const done = index <= stageIndex;
          const active = index === stageIndex && !complete;
          return (
            <Flex key={stage.key} gap={3} opacity={done ? 1 : 0.42} align="start">
              <Box mt="2px" color={done ? "green.500" : "gray.400"} css={done && !active ? { animation: `${tick} 0.3s ease-out` } : active ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}>{done && !active ? <CheckIcon boxSize={3} /> : <TimeIcon boxSize={3} />}</Box>
              <Box>
                <Text fontSize="sm" fontWeight={active || index === stages.length - 1 && complete ? "bold" : "medium"}>{stage.label}</Text>
                {"detail" in stage && (active || index === stages.length - 1 && complete) && <Text fontSize="xs" color={muted}>{stage.detail}</Text>}
              </Box>
            </Flex>
          );
        })}
      </Stack>
      <Text mt={4} fontSize="xs" color={useColorModeValue("gray.500", "gray.400")}>
        Processing runs on the server and continues if you close this page.
      </Text>
    </Box>
  );
}
