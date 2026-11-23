// Asks why a field read from the document is being changed, before the change is saved. The server requires the reason (VAL-005) for those fields
// only; the recruiter's own work (notes, workflow status) never asks. Only "the document was read wrongly" counts as a reading error and is kept for
// improving the reader (docs/learning/TRAINING_AND_IMPROVEMENT_PLAN.md, milestone 1); the other answers are recorded with the change and nothing more.
import { Dialog, Portal, Stack, Text } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";
import type { ChangeKind } from "../api/client";
import { Button } from "./ui/button";
import { DialogHeader } from "./ui/dialog";

const REASONS: { kind: ChangeKind; title: string; detail: string }[] = [
  { kind: "extraction_correction", title: "The document was read wrongly", detail: "The CV or job description says something else. This correction helps improve how documents are read." },
  { kind: "candidate_update", title: "There is newer information", detail: "The document was read correctly, but the details have changed since (for example a new phone number)." },
  { kind: "recruiter_preference", title: "I prefer different wording", detail: "Nothing was wrong; this is how my organisation wants it described." },
  { kind: "disputed_interpretation", title: "I read the document differently", detail: "The document can be read more than one way, and I am recording my reading." },
];

/** `ask(labels)` opens the dialog and resolves with the chosen reason, or null if the person cancels (then nothing is saved). */
export function useChangeReason() {
  const [fields, setFields] = useState<string[] | null>(null);
  const resolver = useRef<((k: ChangeKind | null) => void) | null>(null);
  const ask = useCallback((labels: string[]) => new Promise<ChangeKind | null>((resolve) => { resolver.current = resolve; setFields(labels); }), []);
  const answer = (k: ChangeKind | null) => { resolver.current?.(k); resolver.current = null; setFields(null); };
  const firstRef = useRef<HTMLButtonElement>(null);
  const dialog = (
    <Dialog.Root open={!!fields} onOpenChange={(e) => { if (!e.open) answer(null); }} placement="center" initialFocusEl={() => firstRef.current}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="480px">
            <DialogHeader fontSize="lg" fontWeight="bold">Why is this changing?</DialogHeader>
            <Dialog.Body>
              <Text fontSize="sm" color="text.secondary" mb={4}>
                {fields && fields.length ? `You changed ${fields.join(", ")}, which ${fields.length === 1 ? "was" : "were"} read from the document. ` : ""}The original reading is always kept.
              </Text>
              <Stack gap={3}>
                {REASONS.map((r, i) => (
                  <Button key={r.kind} ref={i === 0 ? firstRef : undefined} variant="outline" onClick={() => answer(r.kind)}
                    h="auto" py={3} px={4} whiteSpace="normal" textAlign="left" justifyContent="flex-start" data-reason={r.kind}>
                    <Stack gap={1} align="flex-start">
                      <Text as="span" fontWeight="semibold">{r.title}</Text>
                      <Text as="span" fontSize="sm" fontWeight="normal" opacity={0.85}>{r.detail}</Text>
                    </Stack>
                  </Button>
                ))}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="ghost" onClick={() => answer(null)}>Cancel, don't save</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
  return { ask, dialog };
}
