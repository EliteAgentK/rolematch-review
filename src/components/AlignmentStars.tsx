import { useId } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { alignmentStars, describeStars } from "../utils/alignmentStars";

// The single display of an assessment's alignment, used in the results table and in match details, in both directions (src/utils/alignmentStars.ts
// holds the only conversion rule). Five stars to the nearest half, always with the percentage beside them. It shows one candidate–job assessment;
// evidence confidence is shown separately, never folded into the stars.
interface Props { percent: unknown; size?: "sm" | "lg"; label?: string }

function Star({ fill, px, on, off, edge }: { fill: 0 | 0.5 | 1; px: number; on: string; off: string; edge: string }) {
  const clip = useId();
  const path = "M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z";
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden focusable="false">
      <defs><clipPath id={clip}><rect x="0" y="0" width={24 * fill} height="24" /></clipPath></defs>
      <path d={path} fill={off} />
      {fill > 0 && <path d={path} fill={on} stroke={edge} strokeWidth="0.9" strokeLinejoin="round" clipPath={`url(#${clip})`} />}
    </svg>
  );
}

export default function AlignmentStars({ percent, size = "sm", label }: Props) {
  const v = alignmentStars(percent);
  // A bright gold with a slightly deeper edge, so the stars read clearly on white and on dark (owner, 9 Nov 2026: "those gold stars are so dull").
  const on = useColorModeValue("#FFB703", "#FFC93C"), edge = useColorModeValue("#E09400", "#FFB703"), off = useColorModeValue("#E2E8F0", "#4A5568"), muted = useColorModeValue("gray.600", "gray.400");
  const px = size === "lg" ? 24 : 17;
  if (!v) return <Box>{label && <Text fontSize="xs" color={muted}>{label}</Text>}<Text fontSize="sm" color={muted}>Assessment unavailable</Text></Box>;
  const fills = [0, 1, 2, 3, 4].map((i) => (v.shown >= i + 1 ? 1 : v.shown >= i + 0.5 ? 0.5 : 0) as 0 | 0.5 | 1);
  return (
    <Box>
      {label && <Text fontSize="xs" color={muted} mb={0.5}>{label}</Text>}
      <Flex align="center" gap={2} role="img" aria-label={`${label ?? "Alignment with this role"}: ${describeStars(v)}`} title={describeStars(v)}>
        <Flex gap="1px">{fills.map((f, i) => <Star key={i} fill={f} px={px} on={on} off={off} edge={edge} />)}</Flex>
        <Text as="span" fontWeight="semibold" fontSize={size === "lg" ? "2xl" : "sm"} lineHeight="1" css={{ fontVariantNumeric: "tabular-nums" }}>{v.percent}%</Text>
      </Flex>
    </Box>
  );
}
