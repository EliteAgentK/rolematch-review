import React from "react";
import { Badge, Box, Flex, Text } from "@chakra-ui/react";
import { Bar, stageGoal, useCreep } from "./DocumentProcessingCard";
import { keyframes } from "@emotion/react";
import type { BatchView } from "../api/client";
import { explainFailure } from "../utils/uploadFailures";
import { Button } from "./ui/button";
import { useColorModeValue } from "../theme/color-mode";
import { batchSubmittedLine, duration } from "../utils/batchReport";
import { rolematchConfig } from "../config/rolematch.config";

// Real counts from the server for one upload batch: every number is a count of documents in that state.
// The bar is the whole upload's progress (owner, 10 Nov 2026: "the top one isn't moving ... I'd rather that than seeing the three underneath, the
// progress for the entire upload"): each file counts for its share, a finished one in full and one being read by how far through its steps it is (the
// same steps and timings as a single file's bar), so it moves while the files move and reaches 100% only when every file has finished. The files of a
// batch have no rows of their own on the board: this panel is the one place a batch is shown, and each record appears on the board as it is added.
// The panel is rebuilt from the server after a refresh, so it is the same on a second browser or after signing in again.
interface Props { canManage: boolean; batch: BatchView; /** this batch's files still being read, from the board's documents */ files: { stage: string }[]; sending: { sent: number; total: number; paused?: boolean } | null; skipped: number; onCancel: () => void; onRetry: () => void; onClose: () => void }

const enter = keyframes`from { opacity: 0; transform: translateY(8px) scale(0.99); } to { opacity: 1; transform: none; }`;
const live = keyframes`0%, 100% { opacity: 0.45; } 50% { opacity: 1; }`;

const Tile: React.FC<{ n: number; label: string; tone: "good" | "warn" | "bad" | "info" | "plain" }> = ({ n, label, tone }) => {
  const bar = { good: "teal.500", warn: "orange.400", bad: "red.500", info: "blue.400", plain: useColorModeValue("gray.300", "gray.600") }[tone];
  return (
    <Box flex="1 1 92px" minW="92px" px={3} py={2} borderRadius="lg" bg={useColorModeValue("blackAlpha.50", "whiteAlpha.100")} borderLeft="3px solid" borderColor={bar} transition="transform 0.15s ease" _hover={{ transform: "translateY(-1px)" }}>
      <Text fontWeight="bold" fontSize="lg" lineHeight="1.1" key={n} css={{ animation: `${enter} 0.25s ease-out` }}>{n}</Text>
      <Text fontSize="xs" color={useColorModeValue("gray.600", "gray.400")}>{label}</Text>
    </Box>
  );
};

const BatchPanel: React.FC<Props> = ({ canManage, batch: b, files, sending, skipped, onCancel, onRetry, onClose }) => {
  const c = b.counts, noun = b.kind === "cv" ? (c.declared === 1 ? "CV" : "CVs") : (c.declared === 1 ? "job description" : "job descriptions");
  const working = c.waiting + c.processing;
  const finished = c.completed + c.needsReview + c.failed + c.blocked + c.refused + c.duplicates + c.cancelled;
  const done0 = b.complete || !!b.cancelledAt, share = (g: (x: ReturnType<typeof stageGoal>) => number) => c.declared
    ? Math.min(100, (finished * 100 + files.slice(0, Math.max(0, c.declared - finished)).reduce((a, f) => a + g(stageGoal(f.stage === "held" ? null : f.stage, false)), 0)) / c.declared) : 0;
  const pct = useCreep(done0 ? { floor: 100, ceiling: 100, seconds: 1 } : { floor: share((x) => x.floor), ceiling: share((x) => x.ceiling), seconds: Math.max(2, ...files.map((f) => stageGoal(f.stage, false).seconds)) });
  const retryable = b.failures.some((f) => f.retryable);   // the server says which (batches.ts, RETRYABLE): one rule, not a copy of it here
  const done = b.complete || !!b.cancelledAt;
  const status = b.cancelledAt ? (working ? "Cancelled: files already being read will finish" : "Cancelled") : b.abandoned ? "Stopped before every file was sent" : b.complete ? "Finished" : sending?.paused ? "Paused: waiting for the connection" : sending ? `Sending ${sending.sent} of ${sending.total}` : working ? "Reading files" : "Waiting for files";
  const border = useColorModeValue("blue.100", "whiteAlpha.200"), bg = useColorModeValue("white", "gray.800"), muted = useColorModeValue("gray.600", "gray.400");
  return (
    <Box id={"batch-" + b.id} border="1px solid" borderColor={border} bg={bg} borderRadius="2xl" p={4} fontSize="sm" boxShadow="sm" role="region" aria-label={`Batch of ${noun}`} css={{ animation: `${enter} 0.3s ease-out` }}>
      <Flex justify="space-between" align="start" mb={3} gap={3} wrap="wrap">
        <Box minW={0} flex="1 1 220px">
          <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.06em" color="blue.500" fontWeight="bold">Batch · {c.declared} {noun}</Text>
          {/* One line, so a CV batch and a job batch side by side are always the same height (owner, 10 Nov 2026: "different sizes, why"); in full on hover. */}
          <Text fontSize="xs" color={useColorModeValue("gray.600", "gray.400")} truncate title={batchSubmittedLine(b)}>{batchSubmittedLine(b)}</Text>
          <Flex align="center" gap={2} mt={0.5}>
            {!done && <Box w="8px" h="8px" borderRadius="full" bg="teal.400" css={{ animation: `${live} 1.4s ease-in-out infinite` }} aria-hidden />}
            <Text fontWeight="semibold" fontSize="md">{status}</Text>
          </Flex>
        </Box>
        <Flex gap={2} align="center">
          {canManage && !b.complete && !b.cancelledAt && <Button size="xs" variant="outline" onClick={onCancel}>Cancel remaining</Button>}
          {canManage && retryable && !b.cancelledAt && <Button size="xs" variant="outline" onClick={onRetry}>Retry failed</Button>}
          {canManage && done && !working && <Button size="xs" variant="ghost" onClick={onClose}>Close</Button>}
        </Flex>
      </Flex>
      <Flex justify="space-between" mb={1} color={muted} fontSize="xs" gap={2} wrap="wrap"><span>{finished} of {c.declared} files finished · {duration(b.elapsedSec)} elapsed{!done && <> · {b.eta.state === "calculating" ? "Calculating estimate…" : b.eta.state === "estimating" ? `About ${duration(b.eta.lowSec)} to ${duration(b.eta.highSec)} left` : b.eta.state === "stalled" ? `Nothing has finished for ${duration(b.eta.sinceSec)}: taking longer than usual` : ""}</>}</span><Badge variant="subtle" colorPalette={done && c.failed + c.refused === 0 ? "teal" : "blue"}>{pct}%</Badge></Flex>
      <Box mb={3} aria-label="The whole upload's progress"><Bar percent={pct} /></Box>
      <Flex gap={2} wrap="wrap" aria-live="polite">
        <Tile n={rolematchConfig.review.showPrompts ? c.completed : c.completed + c.needsReview} label="added" tone="good" />
        {rolematchConfig.review.showPrompts && c.needsReview > 0 && <Tile n={c.needsReview} label="added, needs review" tone="warn" />}
        <Tile n={c.processing} label="being read" tone="info" />
        <Tile n={c.waiting} label="waiting" tone="plain" />
        {c.failed + c.refused > 0 && <Tile n={c.failed + c.refused} label="not added" tone="bad" />}
        {c.blocked > 0 && <Tile n={c.blocked} label="held for review (not read)" tone="warn" />}
        {c.duplicates > 0 && <Tile n={c.duplicates} label="already in" tone="plain" />}
        {c.cancelled > 0 && <Tile n={c.cancelled} label="cancelled" tone="plain" />}
        {b.notYetSent > 0 && !b.cancelledAt && <Tile n={b.notYetSent} label={sending ? "not sent yet" : "never sent"} tone="plain" />}
      </Flex>
      {/* The same words for both kinds, so the two panels wrap alike and stand at the same height. */}
      <Text mt={3} fontSize="xs" color={muted}>Every file becomes its own record as soon as it is read, and you can open records while the rest are processed. The {b.reservedSlots} upload slots held for this batch return when the whole batch closes.</Text>
      {/* Every file is sent straight away; once they are all on the server, reading carries on without this page (owner, 9 Nov 2026). */}
      {!done && !b.cancelledAt && (sending
        ? <Text mt={2} fontWeight="medium" data-testid="batch-sending">{sending.paused ? `The connection was lost after ${sending.sent} of ${sending.total} files. Nothing is lost: sending carries on by itself as soon as the connection is back. Keep this page open.` : "Sending files to the server: keep this page open until they are all in."}</Text>
        : b.notYetSent === 0 && <Text mt={2} fontWeight="medium" color="green.600" data-testid="batch-all-in">All {c.declared} files are on the server. You can close this page; reading continues.</Text>)}
      {!sending && b.notYetSent > 0 && !b.cancelledAt && <Text mt={2} color="orange.600">{b.notYetSent} file{b.notYetSent === 1 ? " was" : "s were"} never sent (the browser tab was closed or refreshed while sending; moving to another screen does not stop it). Add {b.notYetSent === 1 ? "it" : "them"} again (files already in are recognised and not processed twice), or choose Cancel remaining to unlock uploads now. Otherwise uploads unlock by themselves a few minutes after the last file arrived.</Text>}
      {skipped > 0 && <Text mt={2} color={muted}>{skipped} file{skipped === 1 ? " was" : "s were"} left out before sending (unsupported type, empty, or too large).</Text>}
      {(b.failures.length > 0 || b.refusals.length > 0) && (
        <Box as="details" mt={2}><Box as="summary" cursor="pointer" fontWeight="medium">Why {c.failed + c.refused} {c.failed + c.refused === 1 ? "file was" : "files were"} not added</Box>
          <Box as="ul" mt={1} pl={4} maxH="160px" overflowY="auto">
            {b.failures.map((f) => <li key={f.id}><b>{f.fileName}</b>: {explainFailure(f.errorCode, f.errorMessage).reason} {explainFailure(f.errorCode, f.errorMessage).hint}{f.reference ? ` (Reference ${f.reference.slice(0, 8)})` : ""}</li>)}
            {b.refusals.map((f, i) => <li key={"r" + i}><b>{f.fileName}</b>: {f.message}{f.reference ? ` (Reference ${f.reference.slice(0, 8)})` : ""}</li>)}
          </Box>
        </Box>)}
    </Box>
  );
};
export default BatchPanel;
