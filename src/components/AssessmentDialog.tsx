// The one window a match assessment opens in, wherever it is opened from: the board's Match, a strongest match on the Overview, and a row of a shortlist
// (owner, 11 Nov 2026: "I don't want this one differing from the next"). The same band, heading, size and buttons every time; the assessment inside is
// CandidateMatchPanel. Its look is the panel configuration's (src/config/panels.ts).
import type { ReactNode } from "react";
import { Box, Dialog, Flex, Portal } from "@chakra-ui/react";
import { colour, PANEL_LOOK as L, SPACE } from "../config/panels";
import { displayCase } from "../utils/displayCase";
import { Button } from "./ui/button";
import { DialogCloseButton, DialogHeader } from "./ui/dialog";
import { PanelSubhead } from "./ui/panel";

export default function AssessmentDialog({ open, onClose, who, what, children, extraAction, testId }: {
  open: boolean; onClose: () => void;
  /** whose assessment and for which job, for the heading; while it is still opening, the heading says only "Match Assessment" */
  who?: string; what?: string;
  children: ReactNode;
  /** a second button beside Close, such as "Open on the Matching Board" */
  extraAction?: { label: string; onClick: () => void };
  testId?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onClose(); }} size={L.dialog.size} placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop bg={colour("backdrop")} backdropFilter="blur(10px)" />
        <Dialog.Positioner>
          <Dialog.Content borderRadius="xl" maxW="min(1040px, 94vw)" overflow="hidden" data-testid={testId}>
            <Box w="full" h={L.frame.bar} bg={colour("bar")} flexShrink={0} />
            <DialogHeader><PanelSubhead>{who && what ? `Match Assessment: ${who} & ${displayCase(what)}` : "Match Assessment"}</PanelSubhead></DialogHeader>
            <DialogCloseButton size={L.dialog.close} />
            <Dialog.Body pb={SPACE.xxl}>{children}</Dialog.Body>
            <Dialog.Footer>
              <Flex gap={SPACE.md} justify="flex-end" w="full" wrap="wrap">
                {extraAction && <Button variant="outline" size={L.dialog.button} onClick={extraAction.onClick}>{extraAction.label}</Button>}
                <Button colorPalette={L.more.palette} size={L.dialog.button} width="120px" onClick={onClose}>Close</Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
