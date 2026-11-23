import React, { useEffect, useRef, useState } from "react";
import { Box, Flex, Progress, Text } from "@chakra-ui/react";
import type { Capacity } from "../api/client";
import { usePresence } from "../utils/usePresence";
import { useColorModeValue } from "../theme/color-mode";

// The portal's shared upload allowance, the same for everyone in the portal and on both the CV and job-description sides. The figures are the server's, read a
// few seconds ago; if they cannot be refreshed they are labelled as possibly out of date. This display never decides anything: the server checks every admission.
// Shown once, as a small chip beside the breadcrumb; the breakdown opens on request.
interface Props { capacity: Capacity | null; stale: boolean; staleSeconds: number }
const CapacityBar: React.FC<Props> = ({ capacity: c, stale, staleSeconds }) => {
  const [open, setOpen] = useState(false);
  const panel = usePresence(open);
  const root = useRef<HTMLDivElement | null>(null);
  const border = useColorModeValue("gray.100", "gray.700"), muted = useColorModeValue("gray.600", "gray.400"), bg = useColorModeValue("white", "gray.800");
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!c) return null;
  const pct = Math.round((c.reserved / c.total) * 100);
  return (
    <Box ref={root} position="relative" fontSize="xs" role="status" aria-live="polite">
      <Flex as="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Upload slots: ${c.available} of ${c.total} free. ${open ? "Hide" : "Show"} details`}
        align="center" gap={2} py={1} px={3} bg={bg} borderRadius="md" shadow="sm" borderWidth="1px" borderColor={border} color={muted} cursor="pointer">
        <Text>Upload slots</Text>
        <Progress.Root value={pct} size="xs" w="48px" colorPalette={pct >= 100 ? "red" : pct >= 80 ? "orange" : "blue"} aria-hidden>
          <Progress.Track borderRadius="full"><Progress.Range borderRadius="full" /></Progress.Track>
        </Progress.Root>
        <Text fontWeight="semibold" color={pct >= 80 ? (pct >= 100 ? "red.500" : "orange.500") : undefined}>{c.available} free</Text>
        {stale && <Text color="orange.500">· may be out of date{staleSeconds > 0 ? ` (${staleSeconds} s)` : ""}</Text>}
      </Flex>
      {panel.mounted && (
        <Box className={panel.closing ? "rm-hinge-closing" : "rm-hinge-open"} position="absolute" right={0} top="calc(100% + 6px)" w="300px" maxW="80vw" zIndex={10} p={3} bg={bg} borderRadius="md" shadow="lg" borderWidth="1px" borderColor={border} textAlign="left">
          <Text fontWeight="semibold">{c.reserved} of {c.total} reserved · {c.available} free</Text>
          <Text mt={1} color={muted}>CVs {c.cvReserved} · Job descriptions {c.jdReserved}. Shared by everyone in this portal. Slots are held for a whole batch and return when it closes; matching and reading existing records never use them.</Text>
          {c.batches.length === 0 ? <Text mt={2}>No batches are holding slots.</Text> : (
            <Box as="ul" mt={2} pl={4} maxH="140px" overflowY="auto">
              {c.batches.map((b) => <li key={b.id}>{b.kind === "cv" ? "CV" : "Job"} batch · {b.reserved} slot{b.reserved === 1 ? "" : "s"} · {b.submittedBy || "unknown account"} · {b.state === "sending" ? "files still being sent" : "processing"}</li>)}
            </Box>)}
        </Box>)}
    </Box>
  );
};
export default CapacityBar;
