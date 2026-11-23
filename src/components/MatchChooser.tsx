import { useEffect, useMemo, useState } from "react";
import { Box, Dialog, Flex, Input, Portal, Text } from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { Button } from "./ui/button";
import { DialogCloseButton, DialogHeader } from "./ui/dialog";

// Who to match (owner, 9 Nov 2026: "match all or select ... they must just select people, don't complicate"; "should also be searchable"). A list with tick
// boxes and one search box: tick the ones you want and press Match, or match them all. Nothing is matched until a button here is pressed.
// One filter, and only one (owner, 11 Nov 2026: "the only one I want is the option to look at all the shortlisted people, that's it"; "it'll be all,
// and then you can do the filter to say shortlisted, and under that there should be select all shortlisted, or you can select individually as
// normal"): a dropdown that starts on All, whose other choice keeps only those shortlisted for this role (or, choosing roles for a person, the roles
// they are shortlisted for). On Shortlisted, "Select all shortlisted" ticks every one of them; each can still be ticked or unticked by itself.
interface Choice { id: string; title: string; subtitle?: string }
interface Props { open: boolean; heading: string; /** "candidates" or "jobs", as this organisation words them */ noun: string; choices: Choice[]; /** the switch's words and who it keeps */ shortlisted: { label: string; ids: string[]; none: string }; onMatch: (ids: string[] | null) => void; onClose: () => void }

export default function MatchChooser({ open, heading, noun, choices, shortlisted, onMatch, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set()), [q, setQ] = useState(""), [onlyShortlisted, setOnlyShortlisted] = useState(false);
  useEffect(() => { if (open) { setPicked(new Set()); setQ(""); setOnlyShortlisted(false); } }, [open]);
  const within = useMemo(() => (onlyShortlisted ? new Set(shortlisted.ids) : null), [onlyShortlisted, shortlisted.ids]);
  const shortlistedHere = useMemo(() => choices.filter((c) => shortlisted.ids.includes(c.id)).length, [choices, shortlisted.ids]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return choices.filter((c) => (!within || within.has(c.id)) && (!k || `${c.title} ${c.subtitle ?? ""}`.toLowerCase().includes(k))); }, [choices, q, within]);
  const narrowed = shown.length !== choices.length;
  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const border = useColorModeValue("gray.200", "gray.700"), on = useColorModeValue("blue.50", "whiteAlpha.100"), muted = useColorModeValue("gray.600", "gray.400");
  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onClose(); }} placement="center" size="md" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop backdropFilter="blur(6px)" />
        <Dialog.Positioner>
          <Dialog.Content borderRadius="xl" data-testid="match-chooser">
            <DialogHeader fontSize="lg" fontWeight="bold">{heading}</DialogHeader>
            <DialogCloseButton />
            <Dialog.Body>
              <select aria-label={`Show which ${noun}`} data-testid="match-chooser-filter" value={onlyShortlisted ? "shortlisted" : "all"} onChange={(e) => setOnlyShortlisted(e.target.value === "shortlisted")}
                style={{ width: "100%", marginBottom: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--chakra-colors-border, #cbd5e0)", background: "transparent", color: "inherit", fontSize: 14 }}>
                <option value="all">All {noun} ({choices.length})</option>
                <option value="shortlisted">{shortlisted.label} ({shortlistedHere})</option>
              </select>
              <Input placeholder={`Search ${noun}`} aria-label={`Search ${noun}`} value={q} onChange={(e) => setQ(e.target.value)} mb={3} />
              {onlyShortlisted && shown.length > 0 && (
                <Flex as="label" align="center" gap={3} px={3} py={2} mb={2} cursor="pointer" borderWidth="1px" borderColor={border} borderRadius="md" data-testid="match-chooser-select-all">
                  <input type="checkbox" checked={shown.every((c) => picked.has(c.id))} onChange={(e) => { const all = e.target.checked; setPicked((cur) => { const next = new Set(cur); for (const c of shown) if (all) next.add(c.id); else next.delete(c.id); return next; }); }} style={{ width: 16, height: 16 }} />
                  <Text fontSize="sm" fontWeight="semibold">Select all shortlisted ({shown.length})</Text>
                </Flex>)}
              <Box borderWidth="1px" borderColor={border} borderRadius="md" maxH="320px" overflowY="auto" role="group" aria-label={`Choose ${noun}`}>
                {shown.length === 0 && <Text p={3} fontSize="sm" color={muted}>{q.trim() ? "None match that search." : onlyShortlisted ? shortlisted.none : `No ${noun} here.`}</Text>}
                {shown.map((c) => (
                  <Flex as="label" key={c.id} align="center" gap={3} px={3} py={2} cursor="pointer" bg={picked.has(c.id) ? on : undefined} borderBottomWidth="1px" borderColor={border} _last={{ borderBottomWidth: 0 }}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} style={{ width: 16, height: 16 }} />
                    <Box minW={0}><Text fontSize="sm" fontWeight="medium" lineClamp={1}>{c.title}</Text>{c.subtitle && <Text fontSize="xs" color={muted} lineClamp={1}>{c.subtitle}</Text>}</Box>
                  </Flex>
                ))}
              </Box>
            </Dialog.Body>
            <Dialog.Footer gap={2} flexWrap="wrap">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="outline" disabled={shown.length === 0} onClick={() => onMatch(narrowed ? shown.map((c) => c.id) : null)}>{narrowed ? `Match all shown (${shown.length})` : `Match all (${choices.length})`}</Button>
              <Button colorPalette="green" disabled={picked.size === 0} onClick={() => onMatch([...picked])}>Match selected ({picked.size})</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
