// Chakra 2's ModalHeader and ModalCloseButton on Chakra UI 3's Dialog: the header is a <header> that names the dialog (as Chakra 2's did),
// and the close button is Chakra 2's, in the top right corner.
import { chakra, Dialog, useDialogStyles, type HTMLChakraProps } from "@chakra-ui/react";
import { forwardRef } from "react";
import { CloseButton, type CloseButtonProps } from "./close-button";

export const DialogHeader = forwardRef<HTMLElement, HTMLChakraProps<"header">>(function DialogHeader(props, ref) {
  const styles = useDialogStyles();
  return <Dialog.Title asChild><chakra.header ref={ref} className="chakra-modal__header" css={styles.header} {...props} /></Dialog.Title>;
});

export const DialogCloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function DialogCloseButton(props, ref) {
  return <Dialog.CloseTrigger asChild><CloseButton ref={ref} className="chakra-modal__close-btn" position="absolute" top="2" insetEnd="3" {...props} /></Dialog.CloseTrigger>;
});
