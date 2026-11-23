// A Chakra UI 3 Button that draws an icon beside its text and its loading spinner exactly as Chakra 2 did: the icon in its own box 0.5rem from
// the text, and while loading either a spinner centred over the (invisible) label or a spinner followed by loadingText.
// `href` makes it a link to a document or another site, `to` a link to a page of this website (Chakra 2 wrote both as `as`).
// Variants are the ones in src/theme/recipes.ts (Chakra 2's), which include "link" and "unstyled".
// `tone` gives a button its own colour (a CSS colour or a token such as "cyan.300") and `toneText` the text shown on it (white unless given);
// `toneHover` and `toneHoverText` choose what takes over a solid button on hover (the brand's teal unless given; deleting uses a deeper red). Prefer the default: colour is for the main action, so most buttons should not need a tone.
// A button whose action has to wait (its onClick returns a promise) shows its spinner at once and cannot be pressed again until the action is done, on every
// page, without each page wiring it (owner, 10 Nov 2026: "a short loading animation needs to appear ... that goes for the entire site").
import { Button as ChakraButton, chakra, Spinner, type ButtonProps as ChakraButtonProps } from "@chakra-ui/react";
import { cloneElement, forwardRef, isValidElement, useEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface ButtonProps extends Omit<ChakraButtonProps, "variant"> {
  variant?: "solid" | "outline" | "ghost" | "link" | "unstyled";
  leftIcon?: ReactElement; rightIcon?: ReactElement; iconSpacing?: string;
  href?: string; target?: string; rel?: string; to?: string;
  tone?: string; toneText?: string; toneHover?: string; toneHoverText?: string;
}

const colour = (v: string) => (/^[a-zA-Z]+(\.[\w-]+)+$/.test(v) ? `colors.${v}` : v);   // a token, or a plain CSS colour

const Icon = ({ children, ...props }: { children: ReactElement; marginEnd?: string; marginStart?: string }) => (
  <chakra.span display="inline-flex" alignSelf="center" flexShrink={0} className="chakra-button__icon" {...props}>
    {isValidElement(children) ? cloneElement(children as ReactElement<any>, { "aria-hidden": true, focusable: false }) : children}
  </chakra.span>
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ leftIcon, rightIcon, iconSpacing = "0.5rem", loading: loadingProp, loadingText, children, disabled, variant, href, target, rel, to, tone, toneText, toneHover, toneHoverText, css, onClick, ...rest }, ref) {
  const [waiting, setWaiting] = useState(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);   // set on every mount: React may mount a component twice
  const loading = loadingProp || waiting;
  const click = onClick && ((e: MouseEvent<HTMLButtonElement>) => {
    const r = (onClick as (e: MouseEvent<HTMLButtonElement>) => unknown)(e);
    if (r && typeof (r as Promise<unknown>).then === "function") { setWaiting(true); (r as Promise<unknown>).finally(() => { if (alive.current) setWaiting(false); }).catch(() => {}); }
  });
  const content: ReactNode = <>
    {leftIcon && <Icon marginEnd={iconSpacing}>{leftIcon}</Icon>}
    {children}
    {rightIcon && <Icon marginStart={iconSpacing}>{rightIcon}</Icon>}
  </>;
  const inner: ReactNode = <>
    {loading && (
      <chakra.span className="chakra-button__spinner" display="flex" alignItems="center" position={loadingText ? "relative" : "absolute"} marginEnd={loadingText ? iconSpacing : 0} fontSize="1em" lineHeight="normal">
        <Spinner color="currentColor" width="1em" height="1em" />
      </chakra.span>
    )}
    {loading ? loadingText || <chakra.span opacity={0}>{content}</chakra.span> : content}
  </>;
  const toned = tone || toneHover ? {
    ...(tone ? { "--btn-rest": colour(tone), "--btn-fill": colour(tone), "--btn-on": colour(toneText ?? "white") } : {}),
    ...(toneHover ? { "--btn-take-paint": colour(toneHover), "--btn-take-on": colour(toneHoverText ?? "white") } : {}),
  } : undefined;
  const props = { ref, variant: variant as ChakraButtonProps["variant"], disabled: disabled || loading, "data-loading": loading ? "" : undefined, "aria-busy": loading || undefined, css: toned ? [toned, css] : css, onClick: click as ChakraButtonProps["onClick"], ...rest };
  if (href) return <ChakraButton asChild {...props} type={undefined}><a href={href} target={target} rel={rel}>{inner}</a></ChakraButton>;
  if (to) return <ChakraButton asChild {...props} type={undefined}><Link to={to}>{inner}</Link></ChakraButton>;
  return <ChakraButton {...props}>{inner}</ChakraButton>;
});
