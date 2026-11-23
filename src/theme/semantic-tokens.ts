// Colours that differ between light and dark mode. Chakra UI 2 chose these in JavaScript for the current mode (its mode(light, dark) helper),
// so a colour given directly on a component always won. Here they are CSS variables that switch with the mode, which keeps that behaviour:
// the component style is a plain declaration that a prop can still override. Values are Chakra 2.10.10's (MIT, Chakra Systems) and RoleMatch's own.
import { defineSemanticTokens } from "@chakra-ui/react";
import { PANEL_COLOURS } from "../config/panels";

type Pair = [light: string, dark: string];
const t = ([base, _dark]: Pair) => ({ value: { base: ref(base), _dark: ref(_dark) } });
const ref = (v: string) => (/^(chakra-[\w-]+|[a-zA-Z]+(\.[\w-]+)+)$/.test(v) ? `{colors.${v}}` : v);   // a token, or a plain CSS colour

const SCHEMES = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "cyan", "purple", "pink"] as const;

/** Per colour scheme, used through colorPalette (for example colorPalette.inverseBg). */
function scheme(c: (typeof SCHEMES)[number]) {
  const pairs: Record<string, Pair> = {
    // Outline and ghost buttons: calm ink at rest and taken over by the brand on hover, for every scheme except red, kept for deleting.
    // Colour at rest is reserved for the main action (solid) and for danger, so what matters stands out without a colouring book.
    restFg: c === "red" ? ["red.600", "red.300"] : ["brand.textPrimary", "whiteAlpha.900"],   // calm ink at rest
    inverseBg: c === "red" ? ["red.600", "red.300"] : ["brand.primary", "brand.accent"],          // the brand on hover, never black
    inverseFg: ["white", "gray.900"],
    linkFg: [`${c}.500`, `${c}.200`],
    linkActiveFg: [`${c}.700`, `${c}.500`],
    badgeSubtleBg: [`${c}.100`, `${c}.a200-16`],
    badgeSubtleFg: [`${c}.800`, `${c}.200`],
    badgeSolidBg: [`${c}.500`, `${c}.a500-60`],
    badgeSolidFg: ["white", "whiteAlpha.800"],
    badgeOutlineFg: [`${c}.500`, `${c}.a200-80`],
    alertSubtleFg: [`${c}.600`, `${c}.200`],
    alertSubtleBg: [`${c}.100`, `${c}.a200-16`],
    alertSolidFg: ["white", "gray.900"],
    alertSolidBg: [`${c}.600`, `${c}.200`],
    checkedBg: [`${c}.500`, `${c}.200`],
    selectedFg: [`${c}.600`, `${c}.300`],
    filled: [`${c}.500`, `${c}.200`],
    tableBorder: [`${c}.100`, `${c}.700`],
  };
  return Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, t(v)]));
}

const plain: Record<string, Pair> = {
  // Chakra 2's own
  "chakra-body-text": ["gray.800", "whiteAlpha.900"],
  "chakra-body-bg": ["white", "gray.800"],
  "chakra-border-color": ["gray.200", "whiteAlpha.300"],
  "chakra-inverse-text": ["white", "gray.800"],
  "chakra-subtle-bg": ["gray.100", "gray.700"],
  "chakra-subtle-text": ["gray.600", "gray.400"],
  "chakra-placeholder-color": ["gray.500", "whiteAlpha.400"],
};

// component colours that change with the mode but not with the colour scheme
const v2: Record<string, Pair> = {
  inputHoverBorder: ["gray.300", "whiteAlpha.400"],
  inputFocusBorder: ["blue.500", "blue.300"],
  inputErrorBorder: ["red.500", "red.300"],
  selectBg: ["white", "gray.700"],
  requiredFg: ["red.500", "red.300"],
  helperFg: ["gray.600", "whiteAlpha.600"],
  switchTrack: ["gray.300", "whiteAlpha.400"],
  tabsEnclosedSelectedBorder: ["white", "gray.800"],
  modalBg: ["white", "gray.700"],
  popoverBg: ["white", "gray.700"],
  popoverArrowShadow: ["gray.200", "whiteAlpha.300"],
  tooltipBg: ["gray.700", "gray.300"],
  tooltipFg: ["whiteAlpha.900", "gray.900"],
  menuBg: ["#fff", "gray.700"],
  menuItemFocusBg: ["gray.100", "whiteAlpha.100"],
  menuItemActiveBg: ["gray.200", "whiteAlpha.200"],
  cardElevatedBg: ["white", "gray.700"],
  avatarBorder: ["white", "gray.800"],
  progressTrack: ["gray.100", "whiteAlpha.300"],
  tableHeadFg: ["gray.600", "gray.400"],
  stepperFg: ["chakra-body-text", "whiteAlpha.800"],
  stepperBorder: ["chakra-border-color", "whiteAlpha.300"],
  stepperActiveBg: ["gray.200", "whiteAlpha.300"],
};

export const semanticTokens = defineSemanticTokens({
  colors: {
    ...Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, t(v)])),
    v2: Object.fromEntries(Object.entries(v2).map(([k, v]) => [k, t(v)])),
    ...Object.fromEntries(SCHEMES.map((c) => [c, scheme(c)])),
    // RoleMatch's own (src/theme.js before the move to Chakra UI 3)
    bg: { default: t(["brand.backgroundLight", "gray.900"]) },
    text: { default: t(["brand.textPrimary", "whiteAlpha.900"]), secondary: t(["brand.textSecondary", "gray.400"]) },
    button: { primary: { bg: t(["brand.primary", "brand.primary"]), fg: t(["white", "white"]) },
      take: { bg: t(["brand.accent", "brand.accent"]), fg: t(["gray.900", "gray.900"]) } },   // the teal that takes over a solid button, and its text   // dark text on the dark-mode teal: white on it was too faint to read
    selection: t(["brand.primary", "brand.accent"]),
    // Every record panel's and board card's colours, by meaning (src/config/panels.ts): panel.ink, panel.muted, panel.ground ...
    panel: Object.fromEntries(Object.entries(PANEL_COLOURS).map(([k, v]) => [k, t([v[0], v[1]])])),
  },
  shadows: {
    v2: {
      modal: { value: { base: "{shadows.lg}", _dark: "{shadows.dark-lg}" } },
      menu: { value: { base: "{shadows.sm}", _dark: "{shadows.dark-lg}" } },
    },
  },
});
