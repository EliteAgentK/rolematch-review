import { Box, Dialog, Flex, Portal, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useEffect, useRef, useState } from "react";
import { useColorModeValue } from "../theme/color-mode";
import { Button } from "./ui/button";

// The wordmark colours the ring and wording move through. Text needs more contrast than the logo's flat shapes, so words use deeper shades on white.
const COLOURS = ["#007BA7", "#F55F3C", "#FFD600", "#3DB58C", "#5F3FD1", "#FF5555"];
const TEXT_ON_LIGHT = ["#007BA7", "#D9481F", "#9A7400", "#2A8F68", "#5F3FD1", "#D63A3A"];
const rise = keyframes`from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); }`;
const spin = keyframes`to { transform: rotate(360deg); }`;

type ProgressStatus = "running" | "done" | "error";
export interface ProgressState {
  heading: string;         // e.g. "Finding role matches"
  subject: string;         // e.g. "Finding suitable roles for Zanele Khumalo"
  stages: string[];        // what is being done, in order
  stage: number;           // index of the stage now running
  target: number;          // the true progress so far, 0..100; reaches 100 only when results are ready
  status: ProgressStatus;
  error?: string;
  /** What the failure left behind, said after the error: whether matches already with the AI carry on (failedRunNote). */
  afterError?: string;
}

/** What a failed run says. It used to add "Nothing was changed." to every failure, which was untrue once matches had gone to the AI: those carry on, are
 *  charged and become recorded matches (code review, 16 Nov 2026, E-M5). Now it says only what the caller knows to be true (`afterError`). */
export const errorLine = (s: Pick<ProgressState, "error" | "afterError">) => [s.error ?? "Something went wrong.", s.afterError].filter(Boolean).join(" ");
/** After a failure: the matches already with the AI when it failed carry on (Cancel withdraws them only while the run is going), and those still being
 *  sent are withdrawn as they arrive (the board's cancellable run). */
export const failedRunNote = (withAi: number, beingSent = 0) => {
  if (withAi === 0 && beingSent === 0) return "Nothing had been sent to the AI, so no usage credits were used.";
  const carry = withAi === 0 ? "" : withAi === 1 ? "One match was already with the AI. It carries on and uses usage credits; when it is finished it is kept and opens at once the next time."
    : `${withAi} matches were already with the AI. They carry on and use usage credits; each one it finishes is kept and opens at once the next time.`;
  const sending = beingSent === 0 ? "" : beingSent === 1 ? "One more that was being sent is withdrawn as it arrives." : `${beingSent} more that were being sent are withdrawn as they arrive.`;
  return [carry, sending].filter(Boolean).join(" ");
};

const RADIUS = 44, CIRC = 2 * Math.PI * RADIUS;

// The number is a ticker: it climbs one step at a time at a steady speed, however fast the work really is. It can NEVER pass the true
// progress (accuracy), never moves backwards, and when the true progress is far ahead it speeds up a little so it does not lag behind.
const BASE_SPEED = 24;   // percentage points per second: even instant work takes about four seconds to tick from 0 to 100
const CATCH_UP = 0.6;    // extra speed per point of distance beyond 30, so a long delay is not followed by a long crawl

function useTicker(target: number, active: boolean, halted: boolean, onReached: () => void) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const reachedRef = useRef(false);
  const targetRef = useRef(target); targetRef.current = target;
  const onReachedRef = useRef(onReached); onReachedRef.current = onReached;
  useEffect(() => { if (!active) { shownRef.current = 0; reachedRef.current = false; setShown(0); } }, [active]);
  useEffect(() => {
    if (!active || halted) return; // a failed run stops exactly where it was
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.5, (now - last) / 1000); last = now;   // a busy machine draws fewer frames: the pace follows the clock, not the frame count
      const gap = targetRef.current - shownRef.current;
      if (gap > 0) {
        const speed = BASE_SPEED + Math.max(0, gap - 30) * CATCH_UP;
        const next = Math.min(targetRef.current, shownRef.current + speed * dt);
        if (Math.floor(next) !== Math.floor(shownRef.current) || next >= 100) setShown(next); // re-render only when the visible number changes
        shownRef.current = next;
      }
      if (shownRef.current >= 100 && !reachedRef.current) { reachedRef.current = true; setShown(100); onReachedRef.current(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, halted]);
  return Math.floor(shown + 1e-9);
}

export default function MatchProgressOverlay({ state: current, onRetry, onClose, onCancel, onFinished }: { state: ProgressState | null; onRetry: () => void; onClose: () => void; /** While it runs: stop, and withdraw what the AI has not started. */ onCancel?: () => void; /** Called once the shown number has really ticked up to 100%. */ onFinished?: () => void }) {
  const open = !!current;
  const ticked = useTicker(current?.target ?? 0, open, current?.status === "error", () => onFinished?.());
  // while the window closes it keeps showing what it showed last (100%), never the reset value
  const last = useRef<{ state: ProgressState | null; percent: number }>({ state: null, percent: 0 });
  if (open) last.current = { state: current, percent: ticked };
  const { state, percent } = last.current;
  const bg = useColorModeValue("white", "gray.800");
  const palette = useColorModeValue(TEXT_ON_LIGHT, COLOURS);
  const stageCount = state?.stages.length ?? 1;
  const stage = Math.min(state?.stage ?? 0, Math.min(stageCount - 1, Math.floor(percent / (100 / stageCount))));
  const colour = state?.status === "error" ? "#D63A3A" : COLOURS[stage % COLOURS.length];
  const textColour = state?.status === "error" ? "#D63A3A" : palette[stage % palette.length];
  const textNext = palette[(stage + 1) % palette.length];
  const headingRef = useRef<HTMLParagraphElement>(null);
  const running = state?.status === "running";

  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open && !running) onClose(); }} placement="center" closeOnInteractOutside={false} closeOnEscape={!running} initialFocusEl={() => headingRef.current}>
      <Portal>
      <Dialog.Backdrop bg="blackAlpha.600" backdropFilter="blur(6px)" />
      <Dialog.Positioner>
      <Dialog.Content bg={bg} borderRadius="2xl" py={9} px={8} maxW="480px" textAlign="center" aria-label={state?.heading ?? "Working"}>
        <Flex direction="column" align="center" gap={5} css={{ "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important", transition: "none !important" } } }}>
          <Box
            position="relative" w="116px" h="116px"
            role="progressbar" aria-label={`${state?.heading ?? "Progress"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} percent`}
          >
            <svg viewBox="0 0 100 100" width="116" height="116" aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
              <circle cx="50" cy="50" r={RADIUS} fill="none" stroke={colour} strokeOpacity="0.18" strokeWidth="7" />
              <circle cx="50" cy="50" r={RADIUS} fill="none" stroke={colour} strokeWidth="7" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - percent / 100)} style={{ transition: "stroke .5s" }} />
            </svg>
            {running && <Box position="absolute" inset="-6px" borderRadius="full" border="2px solid transparent" borderTopColor={colour} opacity={0.5} animation={`${spin} 1.4s linear infinite`} />}
            <Text position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center" fontSize="2xl" fontWeight="extrabold" color={state?.status === "error" ? "red.500" : undefined} data-testid="match-progress-number">
              {percent}%
            </Text>
          </Box>

          <Box>
            <Text ref={headingRef} tabIndex={-1} outline="none" fontSize="sm" letterSpacing="widest" textTransform="uppercase" opacity={0.65} mb={1}>{state?.heading}</Text>
            <Text fontSize="lg" fontWeight="semibold" lineClamp={3}>{state?.subject}</Text>
          </Box>

          {state?.status === "error" ? (
            <Box role="alert">
              <Text fontWeight="bold" color="red.500" mb={1}>That did not finish</Text>
              <Text fontSize="sm" mb={4}>{errorLine(state)}</Text>
              <Flex gap={3} justify="center">
                <Button colorPalette="blue" onClick={onRetry} autoFocus>Try again</Button>
                <Button variant="ghost" onClick={onClose}>Close</Button>
              </Flex>
            </Box>
          ) : (
            <Text key={stage} fontSize="xl" fontWeight="bold" minH="3.2em" display="flex" alignItems="center" justifyContent="center" bgImage={`linear-gradient(to right, ${textColour}, ${textNext})`} bgClip="text" animation={`${rise} .45s ease-out`} aria-live="polite" data-testid="match-progress-stage">
              {state?.status === "done" ? "Ready" : state?.stages[stage]}…
            </Text>
          )}
          {running && onCancel && <Button variant="ghost" size="sm" onClick={onCancel} data-testid="match-progress-cancel">Cancel</Button>}
        </Flex>
      </Dialog.Content>
      </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
