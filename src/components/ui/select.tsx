// Chakra 2's Select on Chakra UI 3's NativeSelect: a native <select> with Chakra 2's chevron over its end. As in Chakra 2, layout props
// (width, margins, flex and the like) go to the wrapper and the rest to the <select> itself.
import { NativeSelect } from "@chakra-ui/react";
import { forwardRef, type ReactElement, type ReactNode } from "react";

// Chakra 2's layoutPropNames, less height and minimum height (Chakra 2 gave those to the <select>)
const LAYOUT = new Set(["margin", "marginTop", "marginBlockStart", "marginRight", "marginInlineEnd", "marginBottom", "marginBlockEnd", "marginLeft", "marginInlineStart", "marginX", "marginInline", "marginY", "marginBlock", "padding", "paddingTop", "paddingBlockStart", "paddingRight", "paddingBottom", "paddingBlockEnd", "paddingLeft", "paddingInlineStart", "paddingInlineEnd", "paddingX", "paddingInline", "paddingY", "paddingBlock", "m", "mt", "mr", "me", "marginEnd", "mb", "ml", "ms", "marginStart", "mx", "my", "p", "pt", "py", "px", "pb", "pl", "ps", "paddingStart", "pr", "pe", "paddingEnd", "width", "inlineSize", "blockSize", "boxSize", "minWidth", "minInlineSize", "minBlockSize", "maxWidth", "maxInlineSize", "maxHeight", "maxBlockSize", "overflow", "overflowX", "overflowY", "display", "verticalAlign", "boxSizing", "float", "visibility", "isolation", "w", "minW", "maxW", "maxH", "alignItems", "alignContent", "justifyItems", "justifyContent", "flexWrap", "flexDirection", "flex", "flexFlow", "flexGrow", "flexShrink", "flexBasis", "justifySelf", "alignSelf", "order", "gap", "rowGap", "columnGap", "gridColumn", "gridRow", "gridArea", "position", "pos", "zIndex", "inset", "top", "bottom", "left", "right", "insetStart", "insetEnd"]);

const Chevron = () => (
  <svg viewBox="0 0 24 24" role="presentation" className="chakra-select__icon" focusable="false" aria-hidden="true" style={{ width: "1em", height: "1em", color: "currentColor" }}>
    <path fill="currentColor" d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
  </svg>
);

export interface SelectProps extends Omit<NativeSelect.FieldProps, "size"> { size?: "xs" | "sm" | "md" | "lg"; placeholder?: string; disabled?: boolean; icon?: ReactElement; iconColor?: string; iconSize?: string; children?: ReactNode }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = "md", disabled, color, icon, iconColor, iconSize, children, ...rest }, ref) {
  const layout: Record<string, unknown> = {}, field: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) (LAYOUT.has(k) ? layout : field)[k] = v;
  return (
    <NativeSelect.Root size={size} disabled={disabled} color={color as any} className="chakra-select__wrapper" {...layout}>
      <NativeSelect.Field ref={ref} className="chakra-select" {...field}>{children}</NativeSelect.Field>
      <NativeSelect.Indicator className="chakra-select__icon-wrapper" {...((iconColor || color) ? { color: (iconColor || color) as any } : {})} {...(iconSize ? { fontSize: iconSize } : {})}>{icon ?? <Chevron />}</NativeSelect.Indicator>
    </NativeSelect.Root>
  );
});
