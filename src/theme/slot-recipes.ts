// Multi-part component styles: Chakra UI 2.10.10's (MIT, Chakra Systems), rewritten as Chakra UI 3 slot recipes so each part looks as it did
// before the move (checked by the pixel capture, e2e/visual.spec.ts). Part names are Chakra 3's; comments give Chakra 2's where they differ.
import { defineSlotRecipe } from "@chakra-ui/react";
import { inputField, inputOutline } from "./recipes";

const sizeVars = (size: string) => ({ "--input-font-size": `fontSizes.${size === "lg" ? "lg" : size === "md" ? "md" : size}`, "--input-padding": `spacing.${size === "xs" ? 2 : size === "sm" ? 3 : 4}`, "--input-border-radius": `radii.${size === "lg" || size === "md" ? "md" : "sm"}`, "--input-height": `sizes.${{ xs: 6, sm: 8, md: 10, lg: 12 }[size]}` });

const alertSlotRecipe = defineSlotRecipe({
  className: "chakra-alert",
  slots: ["root", "indicator", "content", "title", "description"],
  base: {
    root: { width: "100%", display: "flex", alignItems: "center", position: "relative", overflow: "hidden", bg: "var(--alert-bg)", px: "4", py: "3" },
    title: { fontWeight: "bold", lineHeight: "6", marginEnd: "2" },
    description: { display: "inline", lineHeight: "6" },
    // Chakra 2's AlertIcon: a span the size of the icon, in the alert's foreground colour
    indicator: { display: "inherit", color: "var(--alert-fg)", flexShrink: 0, marginEnd: "3", w: "5", h: "6" },
  },
  variants: {
    status: {
      info: { root: { colorPalette: "blue" } },
      warning: { root: { colorPalette: "orange" } },
      success: { root: { colorPalette: "green" } },
      error: { root: { colorPalette: "red" } },
      loading: { root: { colorPalette: "blue" } },
    },
    variant: {
      subtle: { root: { "--alert-fg": "colors.colorPalette.alertSubtleFg", "--alert-bg": "colors.colorPalette.alertSubtleBg" } },
      solid: { root: { "--alert-fg": "colors.colorPalette.alertSolidFg", "--alert-bg": "colors.colorPalette.alertSolidBg", color: "var(--alert-fg)" } },
    },
  },
  defaultVariants: { status: "info", variant: "subtle" },
});

const tagSlotRecipe = defineSlotRecipe({
  className: "chakra-tag",
  slots: ["root", "label", "closeTrigger", "startElement", "endElement"],
  base: {
    root: {
      colorPalette: "gray",
      display: "inline-flex", verticalAlign: "top", alignItems: "center", maxWidth: "100%",
      fontWeight: "medium", lineHeight: 1.2, outline: 0,
      color: "var(--badge-color)", bg: "var(--badge-bg)", boxShadow: "var(--badge-shadow)", borderRadius: "md",
      minH: "var(--tag-min-height)", minW: "var(--tag-min-width)", fontSize: "var(--tag-font-size)", px: "var(--tag-padding-inline)",
      _focusVisible: { "--badge-shadow": "shadows.outline" },
    },
    // Chakra 2's TagLabel was clamped to one line
    label: { lineHeight: 1.2, lineClamp: "1", textOverflow: "ellipsis" },
  },
  variants: {
    size: {
      sm: { root: { "--tag-min-height": "sizes.5", "--tag-min-width": "sizes.5", "--tag-font-size": "fontSizes.xs", "--tag-padding-inline": "spacing.2" } },
      md: { root: { "--tag-min-height": "sizes.6", "--tag-min-width": "sizes.6", "--tag-font-size": "fontSizes.sm", "--tag-padding-inline": "spacing.2" } },
      lg: { root: { "--tag-min-height": "sizes.8", "--tag-min-width": "sizes.8", "--tag-font-size": "fontSizes.md", "--tag-padding-inline": "spacing.3" } },
    },
    variant: {
      subtle: { root: { "--badge-bg": "colors.colorPalette.badgeSubtleBg", "--badge-color": "colors.colorPalette.badgeSubtleFg" } },
      solid: { root: { "--badge-bg": "colors.colorPalette.badgeSolidBg", "--badge-color": "colors.colorPalette.badgeSolidFg" } },
      outline: { root: { "--badge-color": "colors.colorPalette.badgeOutlineFg", "--badge-shadow": "inset 0 0 0px 1px var(--badge-color)" } },
    },
  },
  defaultVariants: { size: "md", variant: "subtle" },
});

const cardSlotRecipe = defineSlotRecipe({
  className: "chakra-card",
  slots: ["root", "header", "body", "footer", "title", "description"],
  base: {
    root: {
      display: "flex", flexDirection: "column", position: "relative", minWidth: 0, wordWrap: "break-word",
      "--card-bg": "colors.chakra-body-bg", backgroundColor: "var(--card-bg)", boxShadow: "var(--card-shadow)", borderRadius: "var(--card-radius)",
      color: "chakra-body-text", borderWidth: "var(--card-border-width, 0)", borderColor: "var(--card-border-color)",
    },
    body: { padding: "var(--card-padding)", flex: "1 1 0%" },
    header: { padding: "var(--card-padding)" },
    footer: { padding: "var(--card-padding)" },
  },
  variants: {
    size: {
      sm: { root: { "--card-radius": "radii.base", "--card-padding": "spacing.3" } },
      md: { root: { "--card-radius": "radii.md", "--card-padding": "spacing.5" } },
      lg: { root: { "--card-radius": "radii.xl", "--card-padding": "spacing.7" } },
    },
    variant: {
      elevated: { root: { "--card-shadow": "shadows.base", "--card-bg": "colors.v2.cardElevatedBg" } },
      outline: { root: { "--card-border-width": "1px", "--card-border-color": "colors.chakra-border-color" } },
      filled: { root: { "--card-bg": "colors.chakra-subtle-bg" } },
      unstyled: { body: { "--card-padding": 0 }, header: { "--card-padding": 0 }, footer: { "--card-padding": 0 } },
    },
  },
  defaultVariants: { size: "md", variant: "elevated" },
});

// Chakra 2's Avatar; the background colour from the name is worked out in src/components/ui/avatar.tsx, as Chakra 2 did
const avatarSize = (size: string) => ({ root: { "--avatar-size": size, "--avatar-font-size": `calc(${size} / 2.5)` } });
const avatarSlotRecipe = defineSlotRecipe({
  className: "chakra-avatar",
  slots: ["root", "image", "fallback"],
  base: {
    root: {
      borderRadius: "full", display: "inline-flex", alignItems: "center", justifyContent: "center", textAlign: "center", textTransform: "uppercase",
      fontWeight: "medium", position: "relative", flexShrink: 0,
      bg: "var(--avatar-bg)", fontSize: "var(--avatar-font-size)", borderColor: "v2.avatarBorder", verticalAlign: "top",
      width: "var(--avatar-size)", height: "var(--avatar-size)",
    },
    image: { width: "100%", height: "100%", objectFit: "cover", borderRadius: "full" },
    fallback: { fontSize: "var(--avatar-font-size)", lineHeight: "1" },
  },
  variants: {
    size: {
      "2xs": avatarSize("1rem"), xs: avatarSize("1.5rem"), sm: avatarSize("2rem"), md: avatarSize("3rem"), lg: avatarSize("4rem"),
      xl: avatarSize("6rem"), "2xl": avatarSize("8rem"), full: avatarSize("100%"),
    },
  },
  defaultVariants: { size: "md" },
});

// Chakra 2's FormControl, FormLabel, required indicator and FormHelperText
const fieldSlotRecipe = defineSlotRecipe({
  className: "chakra-form",
  slots: ["root", "label", "requiredIndicator", "helperText", "errorText", "input", "select", "textarea"],
  base: {
    root: { width: "100%", position: "relative" },
    label: {
      display: "block", textAlign: "start", fontSize: "md", marginEnd: "3", mb: "2", fontWeight: "medium",
      transitionProperty: "common", transitionDuration: "normal", opacity: 1, _disabled: { opacity: 0.4 },
    },
    requiredIndicator: { marginStart: "1", color: "v2.requiredFg" },
    helperText: { display: "block", mt: "2", color: "v2.helperFg", lineHeight: "normal", fontSize: "sm" },   // Chakra 2's was a <div>
  },
});

// Chakra 2's Select: a native <select> with the chevron drawn over it
const nativeSelectSlotRecipe = defineSlotRecipe({
  className: "chakra-select",
  slots: ["root", "field", "indicator"],
  base: {
    root: { width: "100%", height: "fit-content", position: "relative" },
    // Chakra 2's select background was overridden by the outline look's bg: inherit, so only its options keep it
    field: {
      ...inputField, appearance: "none", paddingBottom: "1px", lineHeight: "normal",
      "& > option, & > optgroup": { bg: "v2.selectBg" },
      paddingEnd: "8", ...inputOutline,
      _focus: { zIndex: "unset" },
    },
    indicator: {
      position: "absolute", display: "inline-flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", top: "50%", transform: "translateY(-50%)",
      width: "6", height: "100%", insetEnd: "2", color: "currentColor", fontSize: "xl", _disabled: { opacity: 0.5 },
      "& svg": { width: "1em", height: "1em", color: "currentColor" },
    },
  },
  variants: {
    size: {
      lg: { field: sizeVars("lg") }, md: { field: sizeVars("md") }, sm: { field: sizeVars("sm") },
      xs: { field: sizeVars("xs"), indicator: { insetEnd: "1" } },
    },
  },
  defaultVariants: { size: "md" },
});

// Chakra 2's Switch: label (root) > track (control) > thumb, then the text
const switchSlotRecipe = defineSlotRecipe({
  className: "chakra-switch",
  slots: ["root", "label", "control", "thumb", "indicator"],
  base: {
    root: {
      colorPalette: "blue",
      display: "inline-block", position: "relative", verticalAlign: "middle", lineHeight: 0,
      "--switch-diff": "calc(var(--switch-track-width) - var(--switch-track-height))", "--switch-thumb-x": "var(--switch-diff)",
      _rtl: { "--switch-thumb-x": "calc(var(--switch-diff) * -1)" },
    },
    control: {
      display: "inline-flex", flexShrink: 0, justifyContent: "flex-start", boxSizing: "content-box", cursor: "pointer",
      borderRadius: "full", p: "0.5", width: "var(--switch-track-width)", height: "var(--switch-track-height)",
      transitionProperty: "common", transitionDuration: "fast",
      bg: "v2.switchTrack",
      _focusVisible: { boxShadow: "outline" },
      _disabled: { opacity: 0.4, cursor: "not-allowed" },
      _checked: { bg: "colorPalette.checkedBg" },
    },
    thumb: {
      bg: "white", transitionProperty: "transform", transitionDuration: "normal", borderRadius: "inherit",
      width: "var(--switch-track-height)", height: "var(--switch-track-height)",
      _checked: { transform: "translateX(var(--switch-thumb-x))" },
    },
    label: { userSelect: "none", marginStart: "0.5rem" },
  },
  variants: {
    size: {
      sm: { root: { "--switch-track-width": "1.375rem", "--switch-track-height": "sizes.3" } },
      md: { root: { "--switch-track-width": "1.875rem", "--switch-track-height": "sizes.4" } },
      lg: { root: { "--switch-track-width": "2.875rem", "--switch-track-height": "sizes.6" } },
    },
  },
  defaultVariants: { size: "md" },
});

// Chakra 2's Tabs (root, tablist = list, tab = trigger, tabpanel = content); RoleMatch uses the "enclosed" look
const tabsSlotRecipe = defineSlotRecipe({
  className: "chakra-tabs",
  slots: ["root", "trigger", "list", "content", "contentGroup", "indicator"],
  base: {
    root: { colorPalette: "blue", position: "relative", display: "block" },
    trigger: {
      outline: "0", display: "flex", alignItems: "center", justifyContent: "center",
      transitionProperty: "common", transitionDuration: "normal",
      _focusVisible: { zIndex: 1, boxShadow: "outline" },
      _disabled: { cursor: "not-allowed", opacity: 0.4 },
      color: "var(--tabs-color)", fontSize: "md", py: 2, px: 4,
    },
    list: { display: "flex", justifyContent: "flex-start", flexDirection: "row" },
    content: { outline: "0", p: 4 },
  },
  variants: {
    variant: {
      enclosed: {
        trigger: {
          borderTopRadius: "md", border: "1px solid", borderColor: "transparent", mb: "-1px", "--tabs-border-color": "transparent",
          _selected: { "--tabs-color": "colors.colorPalette.selectedFg", "--tabs-border-color": "colors.v2.tabsEnclosedSelectedBorder", borderColor: "inherit", borderBottomColor: "var(--tabs-border-color)" },
        },
        list: { mb: "-1px", borderBottom: "1px solid", borderColor: "inherit" },
      },
      line: {
        list: { borderBottom: "2px solid", borderColor: "inherit" },
        trigger: {
          borderBottom: "2px solid", borderColor: "transparent", marginBottom: "-2px", bg: "var(--tabs-bg)",
          _selected: { "--tabs-color": "colors.colorPalette.selectedFg", borderColor: "currentColor" },
        },
      },
    },
  },
  defaultVariants: { variant: "line" },
});

// Chakra 2's Modal (overlay = backdrop, dialog container = positioner, dialog = content)
const dialogSize = (maxW: string) => ({ content: { maxW } });
const dialogSlotRecipe = defineSlotRecipe({
  className: "chakra-modal",
  slots: ["trigger", "backdrop", "positioner", "content", "title", "description", "closeTrigger", "header", "body", "footer"],
  base: {
    backdrop: { pos: "fixed", left: "0", top: "0", w: "100vw", h: "100vh", bg: "blackAlpha.600", zIndex: "modal" },
    positioner: {
      display: "flex", width: "100vw", height: "var(--chakra-vh)", position: "fixed", left: 0, top: 0,
      zIndex: "modal", justifyContent: "center", overscrollBehaviorY: "none",
    },
    content: {
      display: "flex", flexDirection: "column", position: "relative", width: "100%", outline: 0,
      borderRadius: "md", color: "inherit", zIndex: "modal", bg: "v2.modalBg", boxShadow: "v2.modal",
    },
    header: { flex: 0, px: "6", py: "4", fontSize: "xl", fontWeight: "semibold" },
    // the close button's place is given on it (src/components/ui/dialog.tsx), so the place given in a page wins as in Chakra 2
    body: { px: "6", py: "2", flex: "1" },
    footer: { display: "flex", alignItems: "center", justifyContent: "flex-end", px: "6", py: "4" },
  },
  variants: {
    placement: {
      top: { positioner: { alignItems: "flex-start" }, content: { my: "16" } },
      center: { positioner: { alignItems: "center" }, content: { my: "auto", mx: "auto" } },
    },
    scrollBehavior: {
      outside: { positioner: { overflow: "auto" } },
      inside: { positioner: { overflow: "hidden" }, content: { maxH: "calc(100% - 7.5rem)" }, body: { overflow: "auto" } },
    },
    size: {
      xs: dialogSize("xs"), sm: dialogSize("sm"), md: dialogSize("md"), lg: dialogSize("lg"), xl: dialogSize("xl"), "2xl": dialogSize("2xl"),
      "3xl": dialogSize("3xl"), "4xl": dialogSize("4xl"), "5xl": dialogSize("5xl"), "6xl": dialogSize("6xl"),
      full: { content: { maxW: "100vw", minH: "var(--chakra-vh)", my: "0", borderRadius: "0" } },
    },
  },
  defaultVariants: { size: "md", placement: "top", scrollBehavior: "outside" },
});

// Chakra 2's Popover (popper = positioner, content, arrow)
const popoverSlotRecipe = defineSlotRecipe({
  className: "chakra-popover",
  slots: ["arrow", "arrowTip", "anchor", "trigger", "indicator", "positioner", "content", "title", "description", "closeTrigger", "header", "body", "footer"],
  base: {
    positioner: { zIndex: "popover" },
    content: {
      position: "relative", display: "flex", flexDirection: "column",
      "--popover-bg": "colors.v2.popoverBg", bg: "var(--popover-bg)", "--arrow-background": "var(--popover-bg)", "--popover-arrow-shadow-color": "colors.v2.popoverArrowShadow",
      width: "xs", border: "1px solid", borderColor: "inherit", borderRadius: "md", boxShadow: "sm", zIndex: "inherit",
      _focusVisible: { outline: 0, boxShadow: "outline" },
    },
    header: { px: 3, py: 2, borderBottomWidth: "1px" },
    body: { px: 3, py: 2 },
    footer: { px: 3, py: 2, borderTopWidth: "1px" },
    arrow: { "--arrow-size": "8px" },
    arrowTip: { boxShadow: "var(--arrow-shadow)" },
  },
});

// Chakra 2's Popover opened by hovering (trigger="hover") is Chakra 3's HoverCard: the same look
const hoverCardSlotRecipe = defineSlotRecipe({
  className: "chakra-popover",
  slots: ["arrow", "arrowTip", "trigger", "positioner", "content"],
  base: { positioner: popoverSlotRecipe.base!.positioner!, content: popoverSlotRecipe.base!.content!, arrow: popoverSlotRecipe.base!.arrow!, arrowTip: popoverSlotRecipe.base!.arrowTip! },
});

// Chakra 2's Tooltip
const tooltipSlotRecipe = defineSlotRecipe({
  className: "chakra-tooltip",
  slots: ["trigger", "arrow", "arrowTip", "positioner", "content"],
  base: {
    positioner: { pointerEvents: "none" },
    content: {
      "--tooltip-bg": "colors.v2.tooltipBg", bg: "var(--tooltip-bg)", color: "v2.tooltipFg", "--arrow-background": "var(--tooltip-bg)",
      px: "2", py: "0.5", borderRadius: "sm", fontWeight: "medium", fontSize: "sm", boxShadow: "md", maxW: "xs", zIndex: "tooltip",
    },
    arrow: { "--arrow-size": "8px" },
  },
});

// Chakra 2's Menu (list = content)
const menuSlotRecipe = defineSlotRecipe({
  className: "chakra-menu",
  slots: ["arrow", "arrowTip", "content", "contextTrigger", "indicator", "item", "itemGroup", "itemGroupLabel", "itemIndicator", "itemText", "positioner", "separator", "trigger", "triggerItem", "itemCommand"],
  base: {
    // (Chakra 2's own menu button styles are not used: RoleMatch's menu opens from an avatar, which keeps its own look)
    positioner: { zIndex: "dropdown" },
    content: {
      outline: 0, color: "inherit", minW: "3xs", py: "2", zIndex: "dropdown", borderRadius: "md", borderWidth: "1px",
      bg: "v2.menuBg", boxShadow: "v2.menu",
    },
    item: {
      textDecoration: "none", color: "inherit", userSelect: "none", display: "flex", width: "100%", alignItems: "center", textAlign: "start", flex: "0 0 auto", outline: 0,
      py: "1.5", px: "3", transitionProperty: "background", transitionDuration: "ultra-fast", transitionTimingFunction: "ease-in",
      bg: "var(--menu-item-bg)",
      _highlighted: { "--menu-item-bg": "colors.v2.menuItemFocusBg" },
      _active: { "--menu-item-bg": "colors.v2.menuItemActiveBg" },
      _expanded: { "--menu-item-bg": "colors.v2.menuItemFocusBg" },
      _disabled: { opacity: 0.4, cursor: "not-allowed" },
    },
    // Chakra 2's MenuItem icon, 0.75rem before the text
    itemIndicator: { display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.8em", marginEnd: "0.75rem" },
    separator: { border: 0, borderBottom: "1px solid", borderColor: "inherit", my: "2", opacity: 0.6 },
  },
});

// Chakra 2's Accordion (container = item, button = itemTrigger, panel = itemContent)
const accordionSlotRecipe = defineSlotRecipe({
  className: "chakra-accordion",
  slots: ["root", "item", "itemTrigger", "itemContent", "itemIndicator", "itemBody"],
  base: {
    item: { borderTopWidth: "1px", borderColor: "inherit", _last: { borderBottomWidth: "1px" }, overflowAnchor: "none" },
    itemTrigger: {
      display: "flex", alignItems: "center", width: "100%", outline: 0,
      transitionProperty: "common", transitionDuration: "normal", fontSize: "md",
      _focusVisible: { boxShadow: "outline" }, _hover: { bg: "blackAlpha.50" }, _disabled: { opacity: 0.4, cursor: "not-allowed" },
      px: "4", py: "2",
    },
    itemBody: { pt: "2", px: "4", pb: "5" },
    itemIndicator: { fontSize: "1.25em", transition: "transform 0.2s", transformOrigin: "center", _open: { transform: "rotate(-180deg)" } },
  },
});

// Chakra 2's Progress (track, filled track = range)
const progressSlotRecipe = defineSlotRecipe({
  className: "chakra-progress",
  slots: ["root", "label", "track", "range", "valueText", "view", "circle", "circleTrack", "circleRange"],
  base: {
    root: { colorPalette: "blue" },
    track: { overflow: "hidden", position: "relative", bg: "v2.progressTrack" },
    range: { height: "100%", transitionProperty: "common", transitionDuration: "slow", bgColor: "colorPalette.filled" },
  },
  variants: {
    size: { xs: { track: { h: "1" } }, sm: { track: { h: "2" } }, md: { track: { h: "3" } }, lg: { track: { h: "4" } } },
    // Chakra 2's hasStripe: white stripes in light mode, dark in dark mode
    striped: {
      true: {
        range: {
          bgImage: "linear-gradient(45deg, var(--stripe-color) 25%, transparent 25%, transparent 50%, var(--stripe-color) 50%, var(--stripe-color) 75%, transparent 75%, transparent)",
          bgSize: "1rem 1rem", "--stripe-color": "rgba(255, 255, 255, 0.15)", _dark: { "--stripe-color": "rgba(0,0,0,0.1)" },
        },
      },
    },
    animated: { true: { range: { animation: "progress-stripe 1s linear infinite" } } },
  },
  defaultVariants: { size: "md" },
});

// Chakra 2's Table (simple variant, gray), sizes md
const tableSlotRecipe = defineSlotRecipe({
  className: "chakra-table",
  slots: ["root", "header", "body", "row", "columnHeader", "cell", "footer", "caption"],
  base: {
    root: { colorPalette: "gray", fontVariantNumeric: "lining-nums tabular-nums", borderCollapse: "collapse", width: "full" },
    columnHeader: { fontFamily: "heading", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "wider", textAlign: "start" },
    cell: { textAlign: "start" },
  },
  variants: {
    variant: {
      simple: {
        columnHeader: { color: "v2.tableHeadFg", borderBottom: "1px", borderColor: "colorPalette.tableBorder" },
        cell: { borderBottom: "1px", borderColor: "colorPalette.tableBorder" },
      },
      unstyled: {},
    },
    size: {
      sm: { columnHeader: { px: "4", py: "1", lineHeight: "4", fontSize: "xs" }, cell: { px: "4", py: "2", fontSize: "sm", lineHeight: "4" } },
      md: { columnHeader: { px: "6", py: "3", lineHeight: "4", fontSize: "xs" }, cell: { px: "6", py: "4", lineHeight: "5" } },
      lg: { columnHeader: { px: "8", py: "4", lineHeight: "5", fontSize: "sm" }, cell: { px: "8", py: "5", lineHeight: "6" } },
    },
  },
  defaultVariants: { variant: "simple", size: "md" },
});

// Chakra 2's List: no bullets unless asked, the icon 0.5rem before the text
const listSlotRecipe = defineSlotRecipe({
  className: "chakra-list",
  slots: ["root", "item", "indicator"],
  base: {
    root: { listStyleType: "none" },
    indicator: { marginEnd: "2", display: "inline", verticalAlign: "text-bottom", w: "1em", h: "1em", lineHeight: "1em", flexShrink: 0, color: "currentColor" },
  },
});

// Chakra 2's NumberInput (field = input, stepper group = control, steppers = increment/decrement triggers)
const numberInputSlotRecipe = defineSlotRecipe({
  className: "chakra-numberinput",
  slots: ["root", "label", "input", "control", "valueText", "incrementTrigger", "decrementTrigger", "scrubber"],
  base: {
    root: { position: "relative", zIndex: 0, "--number-input-stepper-width": "sizes.6", "--number-input-input-padding": "calc(var(--number-input-stepper-width) + 0.5rem)" },
    input: { ...inputField, ...inputOutline, paddingInlineEnd: "var(--number-input-input-padding)", verticalAlign: "top" },
    control: {
      display: "flex", flexDirection: "column", position: "absolute", top: "0", insetEnd: "0px", margin: "1px", height: "calc(100% - 2px)", zIndex: 1,
      width: "var(--number-input-stepper-width)",
    },
    incrementTrigger: {},
    decrementTrigger: {},
  },
  variants: {
    size: {
      md: {
        input: sizeVars("md"),
        incrementTrigger: { borderTopEndRadius: "md" },
        decrementTrigger: { borderBottomEndRadius: "md", mt: "-1px", borderTopWidth: 1 },
      },
      sm: {
        input: sizeVars("sm"),
        incrementTrigger: { borderTopEndRadius: "sm" },
        decrementTrigger: { borderBottomEndRadius: "sm", mt: "-1px", borderTopWidth: 1 },
      },
    },
  },
  defaultVariants: { size: "md" },
});
const stepper = {
  display: "flex", justifyContent: "center", alignItems: "center", flex: 1, transitionProperty: "common", transitionDuration: "normal", userSelect: "none", cursor: "pointer", lineHeight: "normal",
  borderStart: "1px solid", borderStartColor: "v2.stepperBorder", color: "v2.stepperFg", bg: "var(--stepper-bg)",
  _active: { "--stepper-bg": "colors.v2.stepperActiveBg" }, _disabled: { opacity: 0.4, cursor: "not-allowed" },
  fontSize: "calc(1rem * 0.75)",
} as const;
Object.assign(numberInputSlotRecipe.base!.incrementTrigger!, stepper);
Object.assign(numberInputSlotRecipe.base!.decrementTrigger!, stepper);

// Chakra 2's toast: a solid alert, at the bottom centre (src/components/ui/toaster.tsx)
const toastSlotRecipe = defineSlotRecipe({
  className: "chakra-toast",
  slots: ["root", "title", "description", "indicator", "closeTrigger", "actionTrigger"],
  base: {
    root: { pointerEvents: "auto", maxWidth: "560px", minWidth: "300px" },
  },
});

export const slotRecipes = {
  alert: alertSlotRecipe, tag: tagSlotRecipe, card: cardSlotRecipe, avatar: avatarSlotRecipe, field: fieldSlotRecipe, nativeSelect: nativeSelectSlotRecipe,
  switch: switchSlotRecipe, tabs: tabsSlotRecipe, dialog: dialogSlotRecipe, popover: popoverSlotRecipe, hoverCard: hoverCardSlotRecipe, tooltip: tooltipSlotRecipe, menu: menuSlotRecipe,
  accordion: accordionSlotRecipe, progress: progressSlotRecipe, table: tableSlotRecipe, list: listSlotRecipe, numberInput: numberInputSlotRecipe, toast: toastSlotRecipe,
};
