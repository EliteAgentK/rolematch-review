// RoleMatch's Chakra UI 3 theme. It reproduces the website exactly as it looked under Chakra UI 2 (the pass rule of the move: every screen in
// e2e/visual.spec.ts pixel-identical), so it starts from Chakra 3's bare base (conditions and style properties only) and supplies Chakra 2's
// reset, tokens, state selectors and component styles itself:
//   tokens.ts            sizes, colours, fonts and shadows (generated from Chakra 2's foundations and RoleMatch's own)
//   semantic-tokens.ts   colours that change with light and dark mode
//   conditions.ts        Chakra 2's _hover, _dark, _groupHover and other state selectors
//   recipes.ts, slot-recipes.ts   component styles
//   reset.ts             Chakra 2's CSS reset
//   color-mode.tsx       light and dark mode as Chakra 2 kept it
import { createSystem, defaultBaseConfig, defineConfig } from "@chakra-ui/react";
import { conditions } from "./conditions";
import { recipes } from "./recipes";
import { semanticTokens } from "./semantic-tokens";
import { slotRecipes } from "./slot-recipes";
import { breakpoints, tokens, transitionProperty } from "./tokens";

const config = defineConfig({
  // Chakra 2 styled without CSS layers: a style given on a component simply follows its theme style, so it wins on equal footing
  disableLayers: true,
  preflight: false,   // Chakra 2's own reset is used instead (reset.ts, added by provider.tsx)
  conditions,
  utilities: {
    transitionProperty: { values: transitionProperty },
    // Chakra 2's noOfLines, which Chakra 3 calls lineClamp: the same declarations, ellipsis included
    lineClamp: { transform: (v: unknown) => (v === "none" ? { WebkitLineClamp: "unset" } : { overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: "var(--chakra-line-clamp)", "--chakra-line-clamp": String(v) }) },
    // Chakra 2 drew "no outline" as a transparent one, so it still shows in Windows high-contrast mode
    outline: { transform: (v: string) => (v != null && (String(v) === "0" || String(v) === "none") ? { outline: "2px solid transparent", outlineOffset: "2px" } : { outline: v }) },
  },
  globalCss: {
    body: { fontFamily: "body", color: "text.default", bg: "bg.default", transitionProperty: "background-color", transitionDuration: "normal", lineHeight: "base" },
    "*::placeholder": { color: "chakra-placeholder-color" },
    "*, *::before, *::after": { borderColor: "chakra-border-color" },
    "*::selection": { background: "selection", color: "white" },
  },
  theme: {
    breakpoints,
    tokens,
    semanticTokens,
    recipes,
    slotRecipes,
    keyframes: {
      spin: { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
      "progress-stripe": { from: { backgroundPosition: "1rem 0" }, to: { backgroundPosition: "0 0" } },
    },
  },
});

export const system = createSystem(defaultBaseConfig, config);

// How a component's own styles combine with the styles given on it. Chakra 2 combined them shallowly, each given key replacing the one before
// and moving to the end (its assignAfter): `_hover={{...}}` replaced the theme's whole hover look, a size given as one value replaced a
// responsive one, and `border` followed by `borderColor` kept that order. Chakra 3 deep-merges in place, which changes which declaration wins,
// so the styles are combined Chakra 2's way first. (Within a recipe, base, sizes and variants still merge deeply, as in Chakra 2.)
const deepMerge = system.css;
system.css = ((...styles: unknown[]) => {
  const combined: Record<string, unknown> = {};
  for (const style of styles) {
    if (!style || typeof style !== "object") continue;
    for (const [key, value] of Object.entries(style)) { delete combined[key]; combined[key] = value; }
  }
  return deepMerge(combined as Parameters<typeof deepMerge>[0]);
}) as typeof system.css;
