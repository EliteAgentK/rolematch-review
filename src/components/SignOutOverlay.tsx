import { Box, Dialog, Flex, Portal, Text } from "@chakra-ui/react";
import { Image } from "./ui/image";
import { keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import { useColorModeValue } from "../theme/color-mode";

const COLOURS = ["#007BA7", "#F55F3C", "#FFD600", "#3DB58C", "#5F3FD1", "#FF5555"];
const TEXT_ON_LIGHT = ["#007BA7", "#D9481F", "#9A7400", "#2A8F68", "#5F3FD1", "#D63A3A"];
const rise = keyframes`from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); }`;
const wave = keyframes`0%,60%,100% { transform: rotate(0deg); } 10%,30% { transform: rotate(16deg); } 20%,40% { transform: rotate(-10deg); } 50% { transform: rotate(8deg); }`;
const drain = keyframes`from { stroke-dashoffset: 0; } to { stroke-dashoffset: 276; }`;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, (c) => c.toUpperCase());

/** The goodbye after signing out: a waving hand, the brand, a few honest lines (the session really has ended and the work is saved), and a ring that runs out as we leave. */
export default function SignOutOverlay({ isOpen, name, seconds = 3.2 }: { isOpen: boolean; name: string; seconds?: number }) {
  const lines = [`See you soon${name ? `, ${titleCase(name)}` : ""}`, "Your session has ended securely", "Everything you did is saved"];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!isOpen) { setI(0); return; }
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 1100);
    return () => clearInterval(t);
  }, [isOpen, lines.length]);
  const bg = useColorModeValue("white", "gray.800");
  const palette = useColorModeValue(TEXT_ON_LIGHT, COLOURS);
  const colour = palette[i % palette.length], next = palette[(i + 1) % palette.length];
  const logo = useColorModeValue("/logo-light.png", "/logo-dark.png");
  return (
    <Dialog.Root open={isOpen} placement="center" closeOnInteractOutside={false} closeOnEscape={false}>
      <Portal>
      <Dialog.Backdrop bg="blackAlpha.600" backdropFilter="blur(6px)" />
      <Dialog.Positioner>
      <Dialog.Content bg={bg} borderRadius="2xl" py={9} px={8} maxW="440px" textAlign="center" role="status" aria-live="polite" aria-label="Signing out">
        <Flex direction="column" align="center" gap={5} css={{ "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } } }}>
          <Image src={logo} alt="RoleMatch" h="34px" objectFit="contain" />
          <Box position="relative" w="96px" h="96px">
            <svg viewBox="0 0 100 100" width="96" height="96" aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
              <circle cx="50" cy="50" r="44" fill="none" stroke={COLOURS[i % COLOURS.length]} strokeOpacity="0.18" strokeWidth="6" />
              <circle cx="50" cy="50" r="44" fill="none" stroke={COLOURS[i % COLOURS.length]} strokeWidth="6" strokeLinecap="round" strokeDasharray="276" style={{ animation: `${drain} ${seconds}s linear forwards`, transition: "stroke .5s" }} />
            </svg>
            <Text position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center" fontSize="40px" css={{ transformOrigin: "70% 80%", animation: `${wave} 1.8s ease-in-out infinite` }}>👋</Text>
          </Box>
          <Text key={i} fontSize="xl" fontWeight="bold" minH="2.6em" display="flex" alignItems="center" justifyContent="center" bgImage={`linear-gradient(to right, ${colour}, ${next})`} bgClip="text" animation={`${rise} .45s ease-out`}>
            {lines[i]}
          </Text>
        </Flex>
      </Dialog.Content>
      </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
