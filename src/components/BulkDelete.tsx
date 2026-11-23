import { Box, Dialog, Flex, Portal, Stack, Text } from "@chakra-ui/react";
import { FiTrash2 } from "react-icons/fi";
import { useColorModeValue } from "../theme/color-mode";
import { Button } from "./ui/button";
import { DialogHeader } from "./ui/dialog";

// Acting on several records at once (owner, 9 Nov 2026: "doing everything one by one is kind of ridiculous"). Select turns on tick boxes on the cards; the bar
// says how many are ticked; Delete asks once, plainly, and then removes each one through the same route a single delete uses, so each is recorded. Read again
// (candidates) asks the AI to read each ticked CV again, one request each, through the same route as the panel's own button.
export function BulkBar({ picking, count, shown, onStart, onAll, onDelete, onCancel, onReadAgain, readingAgain }: { picking: boolean; count: number; shown: number; onStart: () => void; onAll: () => void; onDelete: () => void; onCancel: () => void;
  /** Reads each ticked record again: CVs by the AI (owner, 9 Nov 2026: re-read every CV to see the new summaries), jobs by the parser. */ onReadAgain?: () => void; readingAgain?: { sent: number; of: number } | null }) {
  const bg = useColorModeValue("gray.50", "whiteAlpha.100");
  if (!picking) return <Button size="xs" variant="ghost" alignSelf="flex-start" onClick={onStart} disabled={shown === 0}>Select</Button>;
  // Two set rows, so nothing wraps at whatever width the column has (owner, 9 Nov 2026: "css issue when pressing select, on both sides"): what is chosen and how
  // to choose, then what to do with it. Delete looks like the panels' Delete.
  return (
    <Stack gap={1.5} bg={bg} borderRadius="md" px={2} py={2} data-testid="bulk-bar">
      <Flex align="center" gap={1}>
        <Text fontSize="sm" fontWeight="medium" mr="auto" whiteSpace="nowrap">{count} selected</Text>
        <Button size="xs" variant="ghost" onClick={onAll}>All {shown}</Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </Flex>
      <Flex gap={2}>
        {onReadAgain && <Button size="xs" flex="1" variant="outline" disabled={count === 0 || !!readingAgain} onClick={onReadAgain}>{readingAgain ? `Sending ${readingAgain.sent} of ${readingAgain.of}` : "Read again"}</Button>}
        <Button size="xs" flex="1" variant="outline" colorPalette="red" leftIcon={<FiTrash2 />} disabled={count === 0} onClick={onDelete}>Delete</Button>
      </Flex>
    </Stack>
  );
}

/** A tick box laid over a card while selecting: the whole card is the target, and nothing underneath it opens. */
export function Pickable({ picking, picked, onToggle, children }: { picking: boolean; picked: boolean; onToggle: () => void; children: React.ReactNode }) {
  const ring = useColorModeValue("red.400", "red.300");   // red, as for deleting (owner, 9 Nov 2026: "i liked the red for the option of deleting")
  if (!picking) return <>{children}</>;
  return (
    <Box position="relative" borderRadius="lg" onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }} cursor="pointer">
      {/* the ring lies over the card, inside its edge: drawn on the wrapper it was hidden by the card, and outside it was clipped by the scrolling list */}
      {picked && <Box position="absolute" inset={0} borderRadius="lg" border="2px solid" borderColor={ring} pointerEvents="none" zIndex={1} />}
      <Box position="absolute" top={2} right={2} zIndex={2}><input type="checkbox" readOnly checked={picked} aria-label="Select" style={{ width: 18, height: 18, accentColor: "#007BA7" }} /></Box>
      <Box pointerEvents="none">{children}</Box>
    </Box>
  );
}

export function ConfirmBulkDelete({ count, noun, what, busy, onConfirm, onClose }: { count: number; /** "candidates" or "jobs" */ noun: string; what: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog.Root open={count > 0} onOpenChange={(e) => { if (!e.open && !busy) onClose(); }} placement="center" size="sm" role="alertdialog">
      <Portal>
        <Dialog.Backdrop backdropFilter="blur(6px)" />
        <Dialog.Positioner>
          <Dialog.Content borderRadius="xl" data-testid="bulk-delete-confirm">
            <DialogHeader fontSize="lg" fontWeight="bold">Delete {count} {noun}?</DialogHeader>
            <Dialog.Body><Text fontSize="sm">{what} This cannot be undone.</Text></Dialog.Body>
            <Dialog.Footer gap={2}>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button colorPalette="red" loading={busy} onClick={onConfirm}>Delete {count}</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
