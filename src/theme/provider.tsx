// Everything the website needs around it for its look: the Chakra UI 3 theme, Chakra 2's reset, light and dark mode, and the toast area.
import { ChakraProvider } from "@chakra-ui/react";
import { Global } from "@emotion/react";
import type { ReactNode } from "react";
import { Toaster } from "../components/ui/toaster";
import { ColorModeProvider } from "./color-mode";
import { system } from "./index";
import { resetCss } from "./reset";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <Global styles={resetCss} />
      <ColorModeProvider>
        {children}
        <Toaster />
      </ColorModeProvider>
    </ChakraProvider>
  );
}
