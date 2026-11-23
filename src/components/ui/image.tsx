// Chakra 2's Image on Chakra UI 3: no object-fit unless `fit` is given (Chakra 3's Image crops to cover by default), and with fallbackSrc
// the fallback is shown until the picture has loaded, and stays if it fails, as Chakra 2 did.
import { chakra, type HTMLChakraProps } from "@chakra-ui/react";
import { forwardRef, useEffect, useState } from "react";

export interface ImageProps extends HTMLChakraProps<"img"> { fit?: HTMLChakraProps<"img">["objectFit"]; align?: HTMLChakraProps<"img">["objectPosition"]; fallbackSrc?: string }

export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image({ fit, align, fallbackSrc, src, ...rest }, ref) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!fallbackSrc || !src) return;
    setLoaded(false);
    const img = new window.Image();
    img.onload = () => setLoaded(true);
    img.src = src;
    return () => { img.onload = null; };
  }, [src, fallbackSrc]);
  const shared = { ref, objectFit: fit, objectPosition: align, ...rest };
  if (fallbackSrc && !loaded) return <chakra.img className="chakra-image__placeholder" src={fallbackSrc} {...shared} />;
  return <chakra.img className="chakra-image" src={src} {...shared} />;
});
