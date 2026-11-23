import { Box } from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";

/**
 * The product name as running text, styled like the logo: "Role" in the four logo colours, "Match" in black (white on dark backgrounds).
 * The yellow "l" is a deeper gold on a white background so it never disappears; the logo image itself keeps the exact brand colours.
 */
export default function BrandName({ onDark = false }: { onDark?: boolean }) {
  const dark = useColorModeValue(onDark, true);
  const yellow = dark ? "#FFD600" : "#D49A00";
  const blue = dark ? "#3AA8D1" : "#0072BC";
  return (
    <Box as="span" display="inline-flex" alignItems="baseline" fontWeight="extrabold" aria-label="RoleMatch">
      <Box as="span" color={blue} aria-hidden="true">R</Box>
      <Box as="span" color="#F58220" aria-hidden="true">o</Box>
      <Box as="span" color={yellow} aria-hidden="true">l</Box>
      <Box as="span" color="#00A651" aria-hidden="true">e</Box>
      <Box as="span" color={dark ? "#FFFFFF" : "#000000"} aria-hidden="true">Match</Box>
    </Box>
  );
}
