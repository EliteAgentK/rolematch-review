import { Box, Flex, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import { CloseButton } from "./ui/close-button";

const slideUp = keyframes`from { opacity: 0; transform: translate(-50%, 24px); } to { opacity: 1; transform: translate(-50%, 0); }`;

/** "NALEDI" and "naledi" both read as "Naledi". */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, (c) => c.toUpperCase());

/**
 * A slim, friendly note at the bottom of the page after signing in. It sits on a dark background in both colour modes so every letter of the
 * brand name, including the yellow "l", stays clearly visible; "Match" is white there, as in the dark-mode logo. It fades away by itself.
 */
export default function WelcomeBackBar({ name, seconds = 6 }: { name: string; seconds?: number }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOpen(false), seconds * 1000); return () => clearTimeout(t); }, [seconds]);
  if (!open) return null;
  return (
    <Box
      position="fixed" bottom={6} left="50%" zIndex={1400} role="status" aria-live="polite"
      bg="#1A202C" color="#FFFFFF" borderRadius="full" boxShadow="xl" pl={5} pr={2} py={2} maxW="92vw"
      borderWidth="1px" borderColor="whiteAlpha.300"
      css={{ transform: "translate(-50%, 0)", "@media (prefers-reduced-motion: no-preference)": { animation: `${slideUp} .5s ease-out` } }}
    >
      <Flex align="center" gap={3}>
        <Text fontSize="sm" fontWeight="medium">
          Welcome back to{" "}
          <Box as="span" fontWeight="extrabold"><Box as="span" color="#3AA8D1">R</Box><Box as="span" color="#F55F3C">o</Box><Box as="span" color="#FFD600">l</Box><Box as="span" color="#3DB58C">e</Box><Box as="span" color="#FFFFFF">Match</Box></Box>
          {name ? `, ${titleCase(name)}` : ""}
        </Text>
        <CloseButton size="sm" aria-label="Dismiss" onClick={() => setOpen(false)} _hover={{ bg: "whiteAlpha.200" }} />
      </Flex>
    </Box>
  );
}
