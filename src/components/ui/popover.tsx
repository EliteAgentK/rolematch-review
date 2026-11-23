// Chakra 2's PopoverCloseButton on Chakra UI 3's Popover: Chakra 2's small close button in the top right corner. It sits above the header: the header
// comes after it and covered it, so a click on the X landed on the title and nothing closed (owner, 9 Nov 2026: "this x isn't working").
import { Popover } from "@chakra-ui/react";
import { forwardRef } from "react";
import { CloseButton, type CloseButtonProps } from "./close-button";

export const PopoverCloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function PopoverCloseButton(props, ref) {
  return <Popover.CloseTrigger asChild><CloseButton ref={ref} size="sm" className="chakra-popover__close-btn" position="absolute" zIndex={1} borderRadius="md" top={1} insetEnd={2} padding={2} {...props} /></Popover.CloseTrigger>;
});
