// The tabs of a record panel, the same for jobs and CVs (owner, 10 Nov 2026: one panel system; designs in docs/product/design/job-panel-tabs.html and
// cv-panel-tabs.html). Every tab carries its count, so nothing is hidden: a recruiter sees there are 28 responsibilities without opening them. Every
// record opens on its Overview. What sits above the tabs (who or what this
// is, its status) and below them (View Original) stays in place whichever tab is open; the caller draws those. In a narrow panel the tabs wrap onto
// another row rather than scroll sideways, so no tab or count is ever out of sight, and every row is filled edge to edge.
// The tab bar stays at the top of the panel while its content scrolls, with whose record it is beside it once the header has scrolled away, and changing
// tab is instant: every tab is drawn once when the record opens and kept, so a click only shows what is already there (owner, 10 Nov 2026: "where's the
// tab option as well, and going through those options, the change in everything should be instant").
import { Box, Tabs, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { colour, PANEL_LOOK as L } from "../../config/panels";

export interface PanelTab { id: string; label: string; count?: number; content: ReactNode }

export function PanelTabs({ kind, recordId, tabs, title }: { kind: "job" | "candidate"; recordId: string; tabs: PanelTab[]; /** whose record this is, shown beside the tabs once they are held at the top */ title?: string }) {
  // Every record opens on its Overview (owner, 10 Nov 2026: "whenever I select a new job or a new candidate ... it should immediately go to overview").
  const [tab, setTab] = useState(tabs[0].id);
  // ...and at its very beginning, whatever was scrolled to on the last one (owner, 11 Nov 2026: "it's a clean new panel"; "it needs to be at the very
  // beginning"): the panel's own scrolling area goes back to its top at once, with no animation.
  useEffect(() => {
    setTab(tabs[0].id);
    let s: HTMLElement | null = marker.current?.parentElement ?? null;
    while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    if (s && s !== document.documentElement && s !== document.body) s.scrollTop = 0;
  }, [recordId]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Whether the bar is being held at the top (the marker just above it has scrolled out of sight): only then does it say whose record this is.
  const marker = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null), [held, setHeld] = useState(false);
  useEffect(() => {
    const m = marker.current; if (!m || typeof IntersectionObserver === "undefined") return;
    const o = new IntersectionObserver(([e]) => setHeld(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 1), { threshold: 0 });
    o.observe(m); return () => o.disconnect();
  }, []);
  // A tab opens at its top: when the bar is held, the panel is scrolled back to where the tabs' content begins.
  const choose = (id: string) => { setTab(id); if (held) marker.current?.scrollIntoView({ block: "start" }); };
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  // Every colour is the panel configuration's (src/config/panels.ts), light and dark.
  const muted = colour("tabInk"), on = colour("tabHover"), well = colour("tabWell"), barBg = colour("surface");
  const chosen = colour("surface"), accent = colour("tabChosenInk"), ring = colour("tabRing");
  const pill = colour("pill"), pillOn = colour("pillOn"), pillText = colour("pillInk");
  return (
    <Tabs.Root value={current} onValueChange={(e) => choose(e.value)} variant="plain" mt={5} data-testid={`${kind}-tabs`}>
      <Box ref={marker} h="1px" mb="-1px" aria-hidden />
      <Box ref={bar} position="sticky" top={0} zIndex={3} bg={barBg} mx={-2} px={2} pt={held ? 2 : 0} pb={held ? 2 : 0} boxShadow={held ? "0 6px 10px -8px rgba(0,0,0,0.45)" : "none"} data-testid="tab-bar" data-held={held || undefined}>
      {held && title && <Text fontSize={L.note.fontSize} fontWeight="semibold" color={muted} mb={1} truncate title={title} data-testid="tab-bar-title">{title}</Text>}
      {/* One even set of buttons in a well: each row is filled edge to edge, so however narrow the panel, no tab is left alone on a line and the
          edges line up with the panel's content (owner, 10 Nov 2026: "structure, symmetry"). */}
      <Tabs.List display="flex" flexWrap="wrap" gap={1} p={1} bg={well} borderRadius="xl" border="none">
        {tabs.map((t) => (
          <Tabs.Trigger key={t.id} value={t.id} data-testid={`tab-${t.id}`} flex="1 1 auto" justifyContent="center" gap={1.5} px={3} py={2} h="auto" minH="9" fontSize={L.tabs.fontSize} whiteSpace="nowrap" color={muted}
            borderRadius="lg" border="1px solid" borderColor="transparent"
            _hover={{ color: on }} _selected={{ color: accent, bg: chosen, borderColor: ring, fontWeight: "semibold", boxShadow: "sm" }} _focusVisible={{ outline: "2px solid", outlineColor: colour("focus"), outlineOffset: "1px" }}>
            {t.label}
            {t.count !== undefined && <Text as="span" fontSize={L.tabs.pill} minW="5" textAlign="center" px={1.5} borderRadius="full" bg={current === t.id ? pillOn : pill} color={current === t.id ? accent : pillText} fontWeight="semibold" aria-label={`, ${t.count}`}>{t.count}</Text>}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      </Box>
      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id} pt={4} minW={0} data-testid={`tab-panel-${t.id}`} css={{ animation: "none !important" }}>
          <Box minW={0}>{t.content}</Box>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
