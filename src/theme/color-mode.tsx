// Light and dark mode, behaving as it did under Chakra UI 2: the person's choice is kept in localStorage ("chakra-ui-color-mode", so choices
// made before the move to Chakra UI 3 still apply); without a choice the device's setting is followed, and a change of the device's setting
// is followed too (Chakra 2's useSystemColorMode). The page is marked the way Chakra 2 marked it (data-theme and color-scheme on <html>,
// chakra-ui-light / chakra-ui-dark on <body>); the "dark" condition in src/theme/index.ts reads those marks.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type ColorMode = "light" | "dark";
const KEY = "chakra-ui-color-mode";

const system = (): ColorMode => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function stored(): ColorMode | null {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}
function mark(mode: ColorMode) {
  const html = document.documentElement;
  html.dataset.theme = mode;
  html.style.colorScheme = mode;
  document.body.classList.add(`chakra-ui-${mode}`);
  document.body.classList.remove(`chakra-ui-${mode === "dark" ? "light" : "dark"}`);
}

interface Context { colorMode: ColorMode; setColorMode: (mode: ColorMode | "system") => void; toggleColorMode: () => void }
const ColorModeContext = createContext<Context | null>(null);

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [colorMode, setMode] = useState<ColorMode>(() => stored() ?? system());
  const setColorMode = useCallback((value: ColorMode | "system") => {
    const mode = value === "system" ? system() : value;
    setMode(mode);
    try { localStorage.setItem(KEY, mode); } catch { /* storage may be blocked; the mode still applies for this visit */ }
  }, []);
  useLayoutEffect(() => mark(colorMode), [colorMode]);
  useEffect(() => { if (!stored()) setColorMode("system"); }, [setColorMode]);   // Chakra 2 saved the device's mode on the first visit
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (e: MediaQueryListEvent) => setColorMode(e.matches ? "dark" : "light");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [setColorMode]);
  const value = useMemo(() => ({ colorMode, setColorMode, toggleColorMode: () => setColorMode(colorMode === "dark" ? "light" : "dark") }), [colorMode, setColorMode]);
  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode(): Context {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error("useColorMode must be used inside ColorModeProvider (src/theme/provider.tsx)");
  return context;
}

/** The light value in light mode, the dark value in dark mode. */
export function useColorModeValue<L, D>(light: L, dark: D): L | D {
  return useColorMode().colorMode === "dark" ? dark : light;
}
