import { useEffect, useState } from "react";
import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import wasmUrl from "@lottiefiles/dotlottie-web/dotlottie-player.wasm?url";

// The player's rendering engine is served from this website, never fetched from a public CDN (the library's default): no third party sees
// a visitor's page loads, and the site's security policy (connect-src 'self') stays as it is. It needs 'wasm-unsafe-eval' in script-src,
// which allows WebAssembly to compile and does NOT allow JavaScript eval.
setWasmUrl(wasmUrl);

export interface AnimationProps { src: string; loop?: boolean; autoplay?: boolean; speed?: number; style?: React.CSSProperties; background?: string }

/** A Lottie animation (loaded on its own, after the page: Animation.tsx). Visitors who ask their device for reduced motion see a still frame instead of a loop. */
export default function AnimationPlayer({ src, loop = true, autoplay = true, speed = 1, style, background = "transparent" }: AnimationProps) {
  const [reduce, setReduce] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const q = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(!!q?.matches);
    q?.addEventListener?.("change", on);
    return () => q?.removeEventListener?.("change", on);
  }, []);
  return <DotLottieReact src={src} loop={loop && !reduce} autoplay={autoplay && !reduce} speed={speed} backgroundColor={background} style={style} />;
}
