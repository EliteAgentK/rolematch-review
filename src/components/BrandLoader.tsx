import { Box, Flex, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { Image } from "./ui/image";
import { useColorModeValue } from "../theme/color-mode";

// The RoleMatch loading screen (owner, 9 Nov 2026: a blank dark page showed after signing in and when moving between places; "we need a RoleMatch identity
// and loading screen ... with the RoleMatch logo and loading animations"). The wordmark, with a bar in its own colours moving beneath it. It says only
// that the page is loading: it never shows a number, because nothing here is being measured.
const COLOURS = ["#007BA7", "#F55F3C", "#FFD600", "#3DB58C", "#5F3FD1"];
const slide = keyframes`0% { transform: translateX(-100%); } 100% { transform: translateX(300%); }`;
const breathe = keyframes`0%, 100% { opacity: .82; transform: scale(.985); } 50% { opacity: 1; transform: scale(1); }`;

/** The moving bar in RoleMatch's colours on its own, for something that is busy inside a card (a CV being read again). */
/** The RoleMatch logo, the right one for light or dark. */
export function BrandMark({ height }: { height: string }) {
  return <Image src={useColorModeValue("/logo-light.png", "/logo-dark.png")} alt="RoleMatch" height={height} />;
}

export function BrandBar({ width = "180px" }: { width?: string }) {
  const track = useColorModeValue("blackAlpha.100", "whiteAlpha.200");
  return (
    <Box w={width} h="4px" borderRadius="full" bg={track} overflow="hidden" aria-hidden css={{ "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } } }}>
      <Box h="100%" w="34%" borderRadius="full" bgImage={`linear-gradient(90deg, ${COLOURS.join(", ")})`} css={{ animation: `${slide} 1.25s cubic-bezier(.65, 0, .35, 1) infinite` }} />
    </Box>
  );
}

export default function BrandLoader({ label = "Loading", fill = true }: { label?: string; /** fill the whole screen (a page) or only its container (a panel) */ fill?: boolean }) {
  const bg = useColorModeValue("gray.50", "#161a25"), track = useColorModeValue("blackAlpha.100", "whiteAlpha.200"), muted = useColorModeValue("gray.600", "gray.400");
  return (
    <Flex role="status" aria-live="polite" aria-label={label} direction="column" align="center" justify="center" gap={5} bg={bg} minH={fill ? "100vh" : "240px"} w="100%" data-testid="brand-loader"
      css={{ "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } } }}>
      <Box css={{ animation: `${breathe} 1.8s ease-in-out infinite` }}>
        <Image src={useColorModeValue("/logo-light.png", "/logo-dark.png")} alt="RoleMatch" height="52px" />
      </Box>
      <Box w="180px" h="4px" borderRadius="full" bg={track} overflow="hidden" aria-hidden>
        <Box h="100%" w="34%" borderRadius="full" bgImage={`linear-gradient(90deg, ${COLOURS.join(", ")})`} css={{ animation: `${slide} 1.25s cubic-bezier(.65, 0, .35, 1) infinite` }} />
      </Box>
      <Text fontSize="sm" color={muted}>{label}…</Text>
    </Flex>
  );
}
