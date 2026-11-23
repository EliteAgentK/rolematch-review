// Chakra 2's Avatar on Chakra UI 3: the picture if it loads, otherwise the initials (first and last name) on a colour worked out from the
// name exactly as Chakra 2 did, with white or dark text depending on how dark that colour is.
import { Avatar as ChakraAvatar } from "@chakra-ui/react";
import { forwardRef, useState } from "react";

/** Chakra 2's randomColor({ string }) (theme-tools, MIT). */
function colourFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) { hash = name.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; }
  let colour = "#";
  for (let j = 0; j < 3; j += 1) colour += `00${((hash >> (j * 8)) & 255).toString(16)}`.slice(-2);
  return colour;
}
const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
};
function initials(name: string) {
  const names = name.trim().split(" "), first = names[0] ?? "", last = names.length > 1 ? names[names.length - 1] : "";
  return first && last ? `${first.charAt(0)}${last.charAt(0)}` : first.charAt(0);
}

export interface AvatarProps extends ChakraAvatar.RootProps { name?: string; src?: string }

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar({ name, src, id, ...rest }, ref) {
  const [loaded, setLoaded] = useState(false);
  const bg = name ? colourFromName(name) : "var(--chakra-colors-gray-400)";
  return (
    // an id given (for example by a menu that opens from the avatar) is the element's own, as in Chakra 2
    <ChakraAvatar.Root ref={ref} ids={id ? { root: id } : undefined} data-loaded={loaded ? "" : undefined} color={name && isDark(bg) ? "white" : name ? "gray.800" : "white"}
      css={{ "&:not([data-loaded])": { "--avatar-bg": bg } }} onStatusChange={(d) => setLoaded(d.status === "loaded")} {...rest}>
      {!loaded && name && <ChakraAvatar.Fallback role="img" aria-label={name}>{initials(name)}</ChakraAvatar.Fallback>}
      {src && <ChakraAvatar.Image src={src} alt={name} />}
    </ChakraAvatar.Root>
  );
});
