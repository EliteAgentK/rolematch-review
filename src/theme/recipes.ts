// Component styles: Chakra UI 2.10.10's (MIT, Chakra Systems) and RoleMatch's own button overrides, rewritten as Chakra UI 3 recipes so every
// component looks exactly as it did before the move (checked by the pixel capture, e2e/visual.spec.ts). Each recipe holds what Chakra 2 put in
// the component itself (display, alignment) as well as its theme. Colours that change with the mode or the colour scheme come from
// src/theme/semantic-tokens.ts (colorPalette.* follows the component's colorPalette, which defaults to Chakra 2's default scheme).
import { defineRecipe } from "@chakra-ui/react";

const disabled = { opacity: 0.4, cursor: "not-allowed", boxShadow: "none" };

// RoleMatch's buttons are taken over on hover: a second colour sweeps in from the left over the first (drawn under the text) while the button
// grows slightly. A solid button, cerulean at rest, is taken over by the brand's teal in both modes; an outline or ghost button, calm ink at
// rest, is taken over by the brand (red for deleting), with the text switching to the opposite colour. Only transform is animated for the
// sweep and the growth, which the graphics card does on its own, so it costs the page nothing measurable; the growth is 3% at most, less on
// small buttons and none on the smallest, so dense screens stay calm.
// --btn-fill is the button's colour and --btn-on the text on it; a button given a tone (src/components/ui/button.tsx) sets them itself.
const focusRing = { outlineWidth: "2px", outlineStyle: "solid", outlineColor: "button.primary.bg", outlineOffset: "2px" };
// Timing, worked out so the takeover reads as one gesture: the layer and the growth take 0.4 s on a symmetric ease (gentle start, gentle
// settle); the text and border colours change over the middle 0.2 s, so they cross over exactly when the layer reaches the button's centre.
const TAKE = { whole: "0.4s", ease: "cubic-bezier(0.65, 0, 0.35, 1)", text: "0.2s", textDelay: "0.1s" };
// The layer that takes over grows from the button's left edge to its right, under the text.
const sweep = { content: '""', position: "absolute", inset: 0, zIndex: -1, bg: "var(--btn-take-paint)",
  transform: "scaleX(0)", transformOrigin: "left", transition: `transform ${TAKE.whole} ${TAKE.ease}` };
const takenOver = (text: string, extra = {}) => ({
  _before: sweep,
  _hover: { color: text, transform: "scale(var(--btn-grow))", _before: { transform: "scaleX(1)" }, ...extra,
    _disabled: { transform: "none", _before: { transform: "scaleX(0)" } }, _motionReduce: { transform: "none" } },
  _active: { opacity: 0.9 },
});
const buttonRecipe = defineRecipe({
  className: "chakra-button",
  base: {
    colorPalette: "gray",
    display: "inline-flex", appearance: "none", alignItems: "center", justifyContent: "center", userSelect: "none", position: "relative",
    whiteSpace: "nowrap", verticalAlign: "middle", outline: "none", isolation: "isolate", overflow: "hidden",
    lineHeight: "1.2", fontWeight: "semibold", letterSpacing: "0.01em",
    // Soft squares, not pills: the radius grows with the button, and browsers that can draw a squircle (a continuous, Apple-style corner) do,
    // which is what gives RoleMatch's buttons their own shape. Others draw ordinary rounded corners of the same size.
    // A squircle's corner looks tighter than a circular one of the same radius, so it is given 1.5 times the radius to look as soft.
    borderRadius: "var(--btn-radius)",
    "@supports (corner-shape: squircle)": { cornerShape: "squircle", borderRadius: "calc(var(--btn-radius) * 1.5)" },
    transitionProperty: "color, border-color, transform", transitionDuration: `${TAKE.text}, ${TAKE.text}, ${TAKE.whole}`,
    transitionDelay: `${TAKE.textDelay}, ${TAKE.textDelay}, 0s`, transitionTimingFunction: TAKE.ease,
    _motionReduce: { transitionDuration: "0s", transitionDelay: "0s", _before: { transitionDuration: "0s" } },
    _focusVisible: focusRing,
    _disabled: disabled,
    // Coloured text and borders on a dark page are lifted 30% towards white: cerulean on navy measured 3.8:1, below the 4.5:1 that small text needs
    "--btn-lift": "0%", _dark: { "--btn-lift": "30%" },
    "--btn-line": "color-mix(in srgb, var(--btn-rest, var(--btn-fill)), white var(--btn-lift))",
    // Chakra 2 spaced an icon given beside the text by 0.5rem (leftIcon / rightIcon)
    "& > .chakra-button__icon": { display: "inline-flex", alignSelf: "center", flexShrink: 0 },
  },
  variants: {
    size: {
      lg: { h: "12", minW: "12", fontSize: "lg", px: "6", "--btn-grow": "1.03", "--btn-radius": "14px" },
      md: { h: "10", minW: "10", fontSize: "md", px: "4", "--btn-grow": "1.03", "--btn-radius": "12px" },
      sm: { h: "8", minW: "8", fontSize: "sm", px: "3", "--btn-grow": "1.02", "--btn-radius": "10px" },
      xs: { h: "6", minW: "6", fontSize: "xs", px: "2", "--btn-grow": "1", "--btn-radius": "7px" },
    },
    variant: {
      // The main action: the brand's cerulean in both modes whatever the colour scheme, or the button's tone.
      solid: {
        "--btn-fill": "colors.button.primary.bg", "--btn-on": "colors.button.primary.fg",
        "--btn-take-paint": "colors.button.take.bg",
        bg: "var(--btn-fill)", color: "var(--btn-on)",
        ...takenOver("var(--btn-take-on)"),
        "--btn-take-on": "colors.button.take.fg",
      },
      outline: {
        "--btn-rest": "colors.colorPalette.restFg", "--btn-fill": "colors.colorPalette.inverseBg", "--btn-on": "colors.colorPalette.inverseFg", "--btn-take-paint": "var(--btn-fill)",
        borderWidth: "1px", borderStyle: "solid", borderColor: "var(--btn-line)", color: "var(--btn-line)", bg: "transparent",
        ...takenOver("var(--btn-on)", { borderColor: "var(--btn-fill)" }),
      },
      ghost: {
        "--btn-rest": "colors.colorPalette.restFg", "--btn-fill": "colors.colorPalette.inverseBg", "--btn-on": "colors.colorPalette.inverseFg", "--btn-take-paint": "var(--btn-fill)",
        color: "var(--btn-line)", bg: "transparent",
        ...takenOver("var(--btn-on)"),
      },
      link: {
        padding: 0, height: "auto", lineHeight: "normal", verticalAlign: "baseline", color: "colorPalette.linkFg",
        _hover: { textDecoration: "underline", _disabled: { textDecoration: "none" } },
        _active: { color: "colorPalette.linkActiveFg" },
      },
      unstyled: { bg: "none", color: "inherit", display: "inline", lineHeight: "inherit", m: "0", p: "0" },
    },
  },
  defaultVariants: { size: "md", variant: "solid" },
});

const badgeRecipe = defineRecipe({
  className: "chakra-badge",
  base: {
    colorPalette: "gray",
    display: "inline-block", whiteSpace: "nowrap", verticalAlign: "middle",
    px: 1, textTransform: "uppercase", fontSize: "xs", borderRadius: "sm", fontWeight: "bold",
    bg: "var(--badge-bg)", color: "var(--badge-color)", boxShadow: "var(--badge-shadow)",
  },
  variants: {
    variant: {
      solid: { "--badge-bg": "colors.colorPalette.badgeSolidBg", "--badge-color": "colors.colorPalette.badgeSolidFg" },
      subtle: { "--badge-bg": "colors.colorPalette.badgeSubtleBg", "--badge-color": "colors.colorPalette.badgeSubtleFg" },
      outline: { "--badge-color": "colors.colorPalette.badgeOutlineFg", "--badge-shadow": "inset 0 0 0px 1px var(--badge-color)" },
    },
  },
  defaultVariants: { variant: "subtle" },
});

const headingRecipe = defineRecipe({
  className: "chakra-heading",
  // Sizes set variables: a fontSize or lineHeight given on a heading then replaces the size's at every width, as in Chakra 2
  // (Chakra 3 would merge the two, keeping the size's wider-screen value)
  base: { fontFamily: "heading", fontWeight: "bold", fontSize: "var(--heading-font-size)", lineHeight: "var(--heading-line-height)" },
  variants: {
    size: {
      "4xl": { "--heading-font-size": ["fontSizes.6xl", null, "fontSizes.7xl"], "--heading-line-height": "1" },
      "3xl": { "--heading-font-size": ["fontSizes.5xl", null, "fontSizes.6xl"], "--heading-line-height": "1" },
      "2xl": { "--heading-font-size": ["fontSizes.4xl", null, "fontSizes.5xl"], "--heading-line-height": ["1.2", null, "1"] },
      xl: { "--heading-font-size": ["fontSizes.3xl", null, "fontSizes.4xl"], "--heading-line-height": ["1.33", null, "1.2"] },
      lg: { "--heading-font-size": ["fontSizes.2xl", null, "fontSizes.3xl"], "--heading-line-height": ["1.33", null, "1.2"] },
      md: { "--heading-font-size": "fontSizes.xl", "--heading-line-height": "1.2" },
      sm: { "--heading-font-size": "fontSizes.md", "--heading-line-height": "1.2" },
      xs: { "--heading-font-size": "fontSizes.sm", "--heading-line-height": "1.2" },
    },
  },
  defaultVariants: { size: "xl" },
});

const linkRecipe = defineRecipe({
  className: "chakra-link",
  base: {
    transitionProperty: "common", transitionDuration: "fast", transitionTimingFunction: "ease-out",
    cursor: "pointer", textDecoration: "none", outline: "none", color: "inherit",
    _hover: { textDecoration: "underline" },
    _focusVisible: { boxShadow: "outline" },
  },
});

const containerRecipe = defineRecipe({
  className: "chakra-container",
  base: { w: "100%", mx: "auto", maxW: "prose", px: "4" },
  variants: { centerContent: { true: { display: "flex", flexDirection: "column", alignItems: "center" } } },
});

// Chakra 2's Divider was an <hr>; Chakra 3's Separator is a <span>, made a block here so it takes the same space
const separatorRecipe = defineRecipe({
  className: "chakra-divider",
  base: { display: "block", opacity: 0.6, borderColor: "inherit", borderStyle: "solid", borderWidth: 0 },
  variants: {
    orientation: {
      horizontal: { borderBottomWidth: "1px", width: "100%" },
      vertical: { borderLeftWidth: "1px", height: "100%" },
    },
    variant: { solid: { borderStyle: "solid" }, dashed: { borderStyle: "dashed" } },
  },
  defaultVariants: { orientation: "horizontal", variant: "solid" },
});

const spinnerRecipe = defineRecipe({
  className: "chakra-spinner",
  base: {
    display: "inline-block", borderColor: "currentColor", borderStyle: "solid", borderRadius: "99999px",
    borderWidth: "var(--spinner-thickness, 2px)", borderBottomColor: "transparent", borderLeftColor: "transparent",
    animation: "spin var(--spinner-speed, 0.45s) linear infinite",
    width: "var(--spinner-size)", height: "var(--spinner-size)",
  },
  variants: {
    size: {
      xs: { "--spinner-size": "sizes.3" },
      sm: { "--spinner-size": "sizes.4" },
      md: { "--spinner-size": "sizes.6" },
      lg: { "--spinner-size": "sizes.8" },
      xl: { "--spinner-size": "sizes.12" },
    },
  },
  defaultVariants: { size: "md" },
});

// Chakra 2's Icon: 1em square, inline-block, the text colour
const iconRecipe = defineRecipe({
  className: "chakra-icon",
  base: { w: "1em", h: "1em", display: "inline-block", lineHeight: "1em", flexShrink: 0, color: "currentColor" },
});

const inputSizes = {
  lg: { "--input-font-size": "fontSizes.lg", "--input-padding": "spacing.4", "--input-border-radius": "radii.md", "--input-height": "sizes.12" },
  md: { "--input-font-size": "fontSizes.md", "--input-padding": "spacing.4", "--input-border-radius": "radii.md", "--input-height": "sizes.10" },
  sm: { "--input-font-size": "fontSizes.sm", "--input-padding": "spacing.3", "--input-border-radius": "radii.sm", "--input-height": "sizes.8" },
  xs: { "--input-font-size": "fontSizes.xs", "--input-padding": "spacing.2", "--input-border-radius": "radii.sm", "--input-height": "sizes.6" },
};
export const inputField = {
  width: "100%", height: "var(--input-height)", fontSize: "var(--input-font-size)", px: "var(--input-padding)", borderRadius: "var(--input-border-radius)",
  minWidth: 0, outline: 0, position: "relative", appearance: "none", transitionProperty: "common", transitionDuration: "normal",
  _disabled: { opacity: 0.4, cursor: "not-allowed" },
} as const;
export const inputOutline = {
  border: "1px solid", borderColor: "inherit", bg: "inherit",
  _hover: { borderColor: "v2.inputHoverBorder" },
  _readOnly: { boxShadow: "none !important", userSelect: "all" },
  _invalid: { borderColor: "v2.inputErrorBorder", boxShadow: "0 0 0 1px {colors.v2.inputErrorBorder}" },
  _focusVisible: { zIndex: 1, borderColor: "v2.inputFocusBorder", boxShadow: "0 0 0 1px {colors.v2.inputFocusBorder}" },
} as const;

const inputRecipe = defineRecipe({
  className: "chakra-input",
  base: inputField,
  variants: { size: inputSizes, variant: { outline: inputOutline } },
  defaultVariants: { size: "md", variant: "outline" },
});

// Chakra 2 dropped the height and minimum height when rows were given; pass h="auto" minH="auto" with rows to do the same
const textareaRecipe = defineRecipe({
  className: "chakra-textarea",
  base: { ...inputField, paddingY: "2", minHeight: "20", lineHeight: "short", verticalAlign: "top" },
  variants: { size: inputSizes, variant: { outline: inputOutline } },
  defaultVariants: { size: "md", variant: "outline" },
});

// Chakra 2's CloseButton (Chakra 3's CloseButton is a ghost IconButton): src/components/ui/close-button.tsx
const closeButtonRecipe = defineRecipe({
  className: "chakra-close-button",
  base: {
    outline: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    w: "var(--close-button-size)", h: "var(--close-button-size)", borderRadius: "md",
    _disabled: disabled,
    transitionProperty: "background-color, color", transitionDuration: "0.15s", _motionReduce: { transitionDuration: "0s" },
    _hover: { "--close-button-bg": "colors.gray.inverseBg", color: "gray.inverseFg" },   // inverts like the buttons
    _active: { opacity: 0.85 },
    _focusVisible: focusRing,
    bg: "var(--close-button-bg)",
  },
  variants: {
    size: {
      lg: { "--close-button-size": "sizes.10", fontSize: "md" },
      md: { "--close-button-size": "sizes.8", fontSize: "xs" },
      sm: { "--close-button-size": "sizes.6", fontSize: "2xs" },
    },
  },
  defaultVariants: { size: "md" },
});

export const recipes = {
  button: buttonRecipe, badge: badgeRecipe, heading: headingRecipe, link: linkRecipe, container: containerRecipe, separator: separatorRecipe,
  spinner: spinnerRecipe, icon: iconRecipe, input: inputRecipe, textarea: textareaRecipe, closeButton: closeButtonRecipe,
};
