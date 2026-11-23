// Chakra 2's IconButton: a button with no padding whose only child is an icon hidden from screen readers (the aria-label names it).
// Chakra UI 3's own also enlarges the icon, which changed every icon button's look.
import { Button, type ButtonProps } from "./button";
import { cloneElement, forwardRef, isValidElement, type ReactElement } from "react";

export type IconButtonProps = ButtonProps & { "aria-label": string; isRound?: boolean };
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ children, isRound, ...props }, ref) {
  const icon = isValidElement(children) ? cloneElement(children as ReactElement<any>, { "aria-hidden": true, focusable: false }) : null;
  return <Button px="0" py="0" borderRadius={isRound ? "full" : undefined} ref={ref} {...props}>{icon}</Button>;
});
