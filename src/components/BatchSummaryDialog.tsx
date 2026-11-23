// One summary when a batch finishes, for the person who submitted it, backed by the stored report (GET /api/batches/:id/report), so a missed pop-up,
// a refresh or a later sign-in shows it again until it is acknowledged. "Finished" means every file reached an end state; it does not mean every record
// has been reviewed, and the dialog says which records still need a person.
import { Box, Dialog, Flex, Portal, Stack, Text } from "@chakra-ui/react";
import type { BatchReport, BatchView } from "../api/client";
import { Button } from "./ui/button";
import { DialogHeader } from "./ui/dialog";

import { duration, LABEL, ORDER } from "../utils/batchReport";

interface Props { batch: BatchView | null; report: BatchReport | null; onClose: () => void; onReview: () => void; onRetry: () => void; onDownload: () => void }
export default function BatchSummaryDialog({ batch, report, onClose, onReview, onRetry, onDownload }: Props) {
  const noun = batch?.kind === "cv" ? "candidate" : "job";
  const issues = report?.files.filter((f) => ["failed", "unsupported_or_refused", "added_needs_review", "blocked_needs_review"].includes(f.outcome)) ?? [];
  return (
    <Dialog.Root open={!!batch} onOpenChange={(e) => { if (!e.open) onClose(); }} placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="560px" borderRadius="2xl">
            <DialogHeader fontSize="lg" fontWeight="bold">{batch?.cancelledAt ? "Batch cancelled" : "Batch finished"}</DialogHeader>
            <Dialog.Body>
              {batch && (
                <Stack gap={4}>
                  <Text fontSize="sm" color="text.secondary">
                    {batch.counts.declared} file{batch.counts.declared === 1 ? "" : "s"} · took {duration(batch.elapsedSec)}. Finished means every file reached an end state; it does not mean every record has been checked.
                  </Text>
                  {report && (
                    <Flex gap={2} wrap="wrap">
                      {ORDER.filter((k) => report.tally[k]).map((k) => (
                        <Box key={k} px={3} py={2} borderRadius="lg" borderLeft="3px solid" borderColor={k === "added" ? "teal.500" : k === "added_needs_review" ? "orange.400" : k === "failed" || k === "unsupported_or_refused" ? "red.500" : "gray.400"} bg="blackAlpha.50" _dark={{ bg: "whiteAlpha.100" }}>
                          <Text fontWeight="bold" fontSize="lg" lineHeight="1.1">{report.tally[k]}</Text><Text fontSize="xs">{LABEL[k]}</Text>
                        </Box>))}
                    </Flex>)}
                  {issues.length > 0 && (
                    <Box>
                      <Text fontWeight="semibold" fontSize="sm" mb={1}>Needs your attention</Text>
                      <Stack as="ul" gap={2} maxH="220px" overflowY="auto" pl={0} listStyleType="none">
                        {issues.slice(0, 50).map((f, i) => (
                          <Box as="li" key={i} fontSize="sm" borderBottom="1px solid" borderColor="blackAlpha.100" pb={2}>
                            <Text fontWeight="medium" lineClamp={1}>{f.fileName}</Text>
                            <Text color="text.secondary">{f.problem}</Text>
                            <Text fontSize="xs">{f.recordSaved ? `A ${noun} record was saved.` : `No ${noun} record was saved.`} {f.nextAction}{f.reference ? ` Reference ${f.reference.slice(0, 8)}.` : ""}</Text>
                          </Box>))}
                        {issues.length > 50 && <Text fontSize="xs">…and {issues.length - 50} more in the downloadable report.</Text>}
                      </Stack>
                    </Box>)}
                </Stack>)}
            </Dialog.Body>
            <Dialog.Footer gap={2} flexWrap="wrap">
              {(report?.tally.added_needs_review ?? 0) > 0 && <Button size="sm" variant="outline" onClick={onReview}>Review flagged records</Button>}
              {report?.files.some((f) => f.retryEligible) && <Button size="sm" variant="outline" onClick={onRetry}>Retry failed files</Button>}
              <Button size="sm" variant="outline" onClick={onDownload}>Download report</Button>
              <Button size="sm" onClick={onClose}>Done</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
