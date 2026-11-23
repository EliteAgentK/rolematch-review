import { Dialog, Portal, useDisclosure } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { Button } from "./ui/button";
import { DialogHeader } from "./ui/dialog";

/** A delete button that always asks first, says exactly what will be removed, and cannot be undone by accident. */
export default function DeleteButton({ title, what, onConfirm }: { title: string; what: string; onConfirm: () => Promise<void> | void }) {
  const { open, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" colorPalette="red" leftIcon={<FiTrash2 />} onClick={onOpen}>Delete</Button>
      {/* Focus starts on Cancel, the least destructive choice */}
      <Dialog.Root role="alertdialog" open={open} onOpenChange={(e) => { if (!e.open) onClose(); }} placement="center" initialFocusEl={() => cancelRef.current}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
          <Dialog.Content>
            <DialogHeader fontSize="lg" fontWeight="bold">Delete {title} permanently?</DialogHeader>
            <Dialog.Body>
              {what} This cannot be undone.
            </Dialog.Body>
            <Dialog.Footer>
              <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button tone="red.600" toneHover="red.800" ml={3} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>
                Delete permanently
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}
