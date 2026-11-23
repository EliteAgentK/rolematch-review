import { Box, Collapsible, Flex, List, Text, useDisclosure } from "@chakra-ui/react";
import { useState } from "react";
import { FiCheck } from "react-icons/fi";
import type { ReviewInfo } from "@/types/records";
import ReviewFlag from "./ReviewFlag";
import { Button } from "./ui/button";

/**
 * One slim line: the flag, "Needs review", a "Why?" link that opens the reasons, and a Mark as reviewed button that clears the flag.
 * The flag never blocks anything; only a person pressing the button clears it.
 */
export default function ReviewNotice({ review, state, onConfirm }: { review?: ReviewInfo; state?: string; onConfirm?: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const why = useDisclosure();
  if (!review || !state) return null;
  if (state === "reviewed") {
    return (
      <Flex align="center" gap={2} mb={3} fontSize="xs" color="green.500">
        <FiCheck />
        <Text>Reviewed{review.reviewedAt ? ` on ${new Date(review.reviewedAt).toLocaleDateString()}` : ""}</Text>
      </Flex>
    );
  }
  if (state !== "needs_review") return null;
  return (
    <Box mb={3} borderWidth="1px" borderColor="yellow.400" bg="yellow.50" _dark={{ bg: "whiteAlpha.100" }} borderRadius="md" px={3} py={2}>
      <Flex align="center" gap={2} wrap="wrap">
        <ReviewFlag size={14} />
        <Text fontSize="sm" fontWeight="semibold">Needs review</Text>
        <Button variant="link" size="xs" onClick={why.onToggle}>{why.open ? "Hide" : "Why?"}</Button>
        {onConfirm && (
          <Button ml="auto" size="xs" colorPalette="yellow" leftIcon={<FiCheck />} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            Mark as reviewed
          </Button>
        )}
      </Flex>
      <Collapsible.Root open={why.open}><Collapsible.Content>
        <Text fontSize="xs" mt={2} mb={1}>Compare this record with the original document before relying on it:</Text>
        <List.Root listStyleType="disc" pl={4} fontSize="xs" css={{ "& > *:not(style) ~ *:not(style)": { mt: 1 } }}>
          {review.reasons.map((r) => <List.Item key={r}>{r}</List.Item>)}
          {review.notes.map((n) => <List.Item key={n} opacity={0.7}>{n}</List.Item>)}
        </List.Root>
      </Collapsible.Content></Collapsible.Root>
    </Box>
  );
}
