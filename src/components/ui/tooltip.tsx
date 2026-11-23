// A tooltip as Chakra 2 showed it: no delay unless one is given, below the element, 8px away, allowed to reach the edge of the window,
// an arrow only when asked, and it stays open when the page scrolls or the mouse button goes down (it closes on a click or Escape).
// Built on Chakra UI 3's Tooltip (the shape follows Chakra's own tooltip snippet, MIT).
import { Portal, Tooltip as ChakraTooltip } from "@chakra-ui/react";
import { forwardRef, type ReactNode } from "react";

// Chakra 3 adds half the arrow's height to the gap; Chakra 2 kept 8px with or without an arrow (8px arrow, so 4 + 4)
export const ARROW_GUTTER = 4;

export interface TooltipProps extends ChakraTooltip.RootProps {
  content: ReactNode;
  showArrow?: boolean;
  contentProps?: ChakraTooltip.ContentProps;
}

export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(function Tooltip({ showArrow, children, disabled, content, contentProps, ...rest }, ref) {
  if (!content) return <>{children}</>;
  return (
    <ChakraTooltip.Root openDelay={0} closeDelay={0} closeOnScroll={false} closeOnPointerDown={false} disabled={disabled} {...rest} positioning={{ overflowPadding: 0, ...(showArrow ? { gutter: ARROW_GUTTER } : {}), ...rest.positioning }}>
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content ref={ref} {...contentProps}>
            {content}
            {showArrow && <ChakraTooltip.Arrow><ChakraTooltip.ArrowTip /></ChakraTooltip.Arrow>}
          </ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  );
});
