// Chakra 2's InputGroup: an element (an icon or a button) placed over the start or end of an input, a square as tall as the input, and the
// input padded so its text never runs under it. Chakra UI 3's InputGroup sizes and colours the element differently.
import { Box, type BoxProps } from "@chakra-ui/react";
import { Children, cloneElement, forwardRef, isValidElement, type ReactElement, type ReactNode } from "react";

const HEIGHT = { xs: "6", sm: "8", md: "10", lg: "12" } as const;
const FONT = { xs: "xs", sm: "sm", md: "md", lg: "lg" } as const;
type Size = keyof typeof HEIGHT;

export interface InputGroupProps extends BoxProps { size?: Size; startElement?: ReactNode; endElement?: ReactNode; startElementProps?: BoxProps; endElementProps?: BoxProps }

export const InputGroup = forwardRef<HTMLDivElement, InputGroupProps>(function InputGroup({ size = "md", startElement, endElement, startElementProps, endElementProps, children, ...rest }, ref) {
  const h = HEIGHT[size];
  const element = (placement: "start" | "end", content: ReactNode, props?: BoxProps) => (
    <Box display="flex" alignItems="center" justifyContent="center" position="absolute" top="0" zIndex={2} {...{ [placement === "start" ? "insetStart" : "insetEnd"]: "0" }}
      width={h} height={h} fontSize={FONT[size]} className={`chakra-input__${placement === "start" ? "left" : "right"}-element`} {...props}>{content}</Box>
  );
  const input = Children.only(children);
  // as in Chakra 2, the input's own padding wins over the room made for the element
  const own = (isValidElement(input) ? input.props : {}) as Record<string, unknown>;
  const has = (...keys: string[]) => keys.some((k) => own[k] !== undefined);
  return (
    <Box ref={ref} className="chakra-input__group" width="100%" display="flex" position="relative" isolation="isolate" data-group="" {...rest}>
      {startElement && element("start", startElement, startElementProps)}
      {isValidElement(input) ? cloneElement(input as ReactElement<any>, { size, ...(startElement && !has("ps", "paddingStart", "pl", "paddingLeft", "paddingInlineStart", "px", "paddingX", "p", "padding") ? { paddingStart: h } : {}), ...(endElement && !has("pe", "paddingEnd", "pr", "paddingRight", "paddingInlineEnd", "px", "paddingX", "p", "padding") ? { paddingEnd: h } : {}), ...(input.props as object) }) : input}
      {endElement && element("end", endElement, endElementProps)}
    </Box>
  );
});
