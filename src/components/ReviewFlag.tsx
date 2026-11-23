import { Box } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { FiFlag } from "react-icons/fi";
import { Tooltip } from "./ui/tooltip";

const beat = keyframes`
  0%   { transform: scale(1); }
  50%  { transform: scale(1.35); }
  100% { transform: scale(1); }
`;

/** A small yellow flag that gently grows and shrinks like a heartbeat. The words "Needs review" appear after hovering for two seconds. */
export default function ReviewFlag({ size = 16 }: { size?: number }) {
  return (
    <Tooltip content="Needs review" positioning={{ placement: "top" }} showArrow openDelay={2000}>
      <Box
        as="span"
        display="inline-flex"
        aria-label="Needs review"
        role="img"
        color="yellow.400"
        animation={`${beat} 1.2s ease-in-out infinite`}
        css={{ "@media (prefers-reduced-motion: reduce)": { animation: "none" } }}
        flexShrink={0}
      >
        <FiFlag size={size} fill="currentColor" />
      </Box>
    </Tooltip>
  );
}
