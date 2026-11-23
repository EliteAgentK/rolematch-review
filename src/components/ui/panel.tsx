// The building blocks of every record panel and every board card (owner, 11 Nov 2026: "same font, same sizes, same bullet points, same kind of header,
// same everything"). Each block takes its look from src/config/panels.ts and nothing else, so a CV panel, a job panel and the cards cannot drift apart:
// the panel and card files only say which data goes where. Plan: docs/architecture/PLAN_PANEL_CONFIGURATION.md.
import { Badge, Box, Card, chakra, Flex, Heading, Tag, Text } from "@chakra-ui/react";
import { useEffect, useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { FiExternalLink } from "react-icons/fi";
import { CARD_LOOK, colour, EVIDENCE, PANEL_LAYOUT, PANEL_LOOK as L, titleCase, TONES, type EvidenceKind, type SectionSpec } from "../../config/panels";
import { BrandBar } from "../BrandLoader";
import { Button } from "./button";
import { PanelTabs } from "./PanelTabs";

// ---- the panel -------------------------------------------------------------------------------------------------------------------------------------

/** The panel itself: one surface, one border, the band across its top. Clipped, not a scroll container: the tab bar is held by the box that scrolls. */
export function PanelFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Card.Root p={L.frame.padding} mb={6} bg={colour("surface")} border="1px solid" borderColor={colour("line")} borderRadius={L.frame.radius} boxShadow={L.frame.shadow}
      position="relative" css={{ overflow: "clip" }} data-testid={testId}
      _after={{ content: '""', position: "absolute", top: 0, left: 0, width: "100%", height: L.frame.bar, background: colour("bar") }}>
      {children}
    </Card.Root>
  );
}

/** Who or what this record is: its name, and one line under it (role or company first, the rest after it). The same on a CV and a job. */
export function PanelTitle({ children, testId }: { children: ReactNode; testId?: string }) {
  return <Heading as="h2" fontSize={L.title.fontSize} fontWeight={L.title.fontWeight} lineHeight={L.title.lineHeight} color={colour("ink")} mb={1} overflowWrap="anywhere" data-testid={testId}>{children}</Heading>;
}
export function PanelSubtitle({ parts, testId }: { parts: (string | undefined | null | false)[]; testId?: string }) {
  const shown = parts.filter((p): p is string => !!p && !!p.trim());
  return shown.length ? <Text fontSize={L.subtitle.fontSize} fontWeight={L.subtitle.fontWeight} lineHeight={L.subtitle.lineHeight} color={colour("muted")} overflowWrap="anywhere" data-testid={testId}>{shown.join(" · ")}</Text> : null;
}

/** A panel's tabs and sections, laid out from PANEL_LAYOUT: the panel gives each section's content and count, the configuration gives their order,
 *  headings and empty wording. A tab's count is the sum of its counted sections. */
export function PanelLayout({ kind, recordId, title, content, labels = {} }: {
  kind: "candidate" | "job"; recordId: string; title: string;
  content: Record<string, { node: ReactNode; count?: number } | undefined>;
  /** A tab's label where the organisation names it itself (its notes). */
  labels?: Record<string, string>;
}) {
  const tabs = PANEL_LAYOUT[kind].map((tab) => {
    const sections = tab.sections.map((spec) => ({ spec, part: content[spec.id] }));
    const counted = sections.filter((s) => s.spec.counted);
    return {
      id: tab.id, label: titleCase(labels[tab.id] ?? tab.label),   // Title Case, every tab, even one an organisation names itself
      count: counted.length ? counted.reduce((n, s) => n + (s.part?.count ?? 0), 0) : undefined,
      content: <Box>{sections.map(({ spec, part }) => <PanelSection key={spec.id} spec={spec} count={part?.count}>{part?.node}</PanelSection>)}</Box>,
    };
  });
  return <PanelTabs kind={kind} recordId={recordId} title={title} tabs={tabs} />;
}

/** One section: the same heading over the same box. With nothing in it, it says so in words (a section with no empty wording is left out instead). A
 *  section without a heading (the contact lines, the notepad) stands on its own. */
function PanelSection({ spec, count, children }: { spec: SectionSpec; count?: number; children?: ReactNode }) {
  const nothing = count === 0 || (count === undefined && !children);
  if (!spec.title) return children ? <Box mt={4} minW={0}>{children}</Box> : null;
  if (nothing && !spec.empty) return null;
  return (
    <Box as="section" mt={L.section.gap} data-testid={`section-${spec.id}`} aria-label={spec.title} minW={0}>
      <Text as="h3" fontWeight={L.section.heading.fontWeight} fontSize={L.section.heading.fontSize} color={colour("body")} mb={L.section.heading.gapBelow} borderBottom={`${L.section.heading.rule} solid`} borderColor={colour("rule")} display="inline-block" pb={1}>
        {titleCase(spec.title)}{count ? ` (${count})` : ""}
      </Text>
      <Box p={L.section.box.padding} bg={colour("ground")} borderRadius={L.section.box.radius} minW={0} overflowWrap="anywhere">
        {nothing ? <PanelText muted testId={`section-${spec.id}-empty`}>{spec.empty}</PanelText> : children}
      </Box>
    </Box>
  );
}

/** Ordinary text in a panel: the document's words, or (muted) something said about them. */
export function PanelText({ children, muted, strong, clamp, testId }: { children: ReactNode; muted?: boolean; strong?: boolean; clamp?: number; testId?: string }) {
  return <Text fontSize={L.text.fontSize} lineHeight={L.text.lineHeight} color={colour(muted ? "muted" : "body")} fontWeight={strong ? "semibold" : undefined} lineClamp={clamp} data-testid={testId}>{children}</Text>;
}
/** A note about the panel itself ("Saved when you click away"). */
export function PanelNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return <Text fontSize={L.note.fontSize} color={colour("faint")} mt={1} data-testid={testId}>{children}</Text>;
}
/** A group's own heading inside a section, in small capitals. */
export function PanelCaption({ children }: { children: ReactNode }) {
  return <Text fontSize={L.section.caption.fontSize} fontWeight={L.section.caption.fontWeight} letterSpacing={L.section.caption.letterSpacing} textTransform="uppercase" color={colour("muted")} mb={2}>{children}</Text>;
}
/** Something the recruiter should know about the record's state (being read again, the last reading failed). */
export function PanelNotice({ children, testId, progress }: { children: ReactNode; testId?: string; progress?: boolean }) {
  return (
    <Flex mt={3} p={3} gap={3} align="center" borderRadius="md" bg={colour(progress ? "ground" : "noticeGround")} color={progress ? undefined : colour("noticeInk")} role="status" data-testid={testId}>
      {progress && <Box flex="none" w="90px"><BrandBar width="100%" /></Box>}
      <Text fontSize={L.text.fontSize}>{children}</Text>
    </Flex>
  );
}

/** A small choice inside a panel or list (a person's status for a job). */
export function PanelSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; testId?: string }) {
  return (
    <chakra.select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}
      fontSize={L.text.fontSize} px={2} py={1} borderRadius="md" borderWidth="1px" borderColor={colour("line")} bg="transparent" color="inherit">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </chakra.select>
  );
}

/** "View 3 more" and "Show fewer": the one button for every folded list. */
export function PanelMore({ open, onToggle, hidden, noun, testId }: { open: boolean; onToggle: () => void; hidden: number; noun: string; testId?: string }) {
  return (
    <Button variant="link" size={L.more.size} colorPalette={L.more.palette} color={colour("link")} mt={3} onClick={onToggle} aria-expanded={open} data-testid={testId}>
      {open ? `Show fewer ${noun}` : `View ${hidden} more`}
    </Button>
  );
}
/** A small text button inside a panel ("Read more", "The CV's own summary"): the same look as PanelMore. */
export function PanelLink({ onClick, expanded, children }: { onClick: () => void; expanded?: boolean; children: ReactNode }) {
  return <Button variant="link" size={L.more.size} colorPalette={L.more.palette} color={colour("link")} px={0} h="auto" mt={2} onClick={onClick} aria-expanded={expanded}>{children}</Button>;
}
/** A list folded to the organisation's limit until opened; it opens folded again for each new record. */
export function useFolded<T>(items: T[], limit: number, resetKey: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [resetKey]);
  return { shown: open || items.length <= limit ? items : items.slice(0, limit), open, toggle: () => setOpen((o) => !o), hidden: Math.max(0, items.length - limit) };
}

/** Lines of the document's own words (duties, requirements, responsibilities, notes, projects): one marker, one size, one spacing everywhere. */
export function PanelItems({ items, tone = "requirement", testId, limit, resetKey = "", noun = "items" }: { items: string[]; tone?: keyof typeof TONES; testId?: string; limit?: number; resetKey?: string; noun?: string }) {
  const fold = useFolded(items, limit ?? items.length, resetKey);
  const list = L.items.style === "cards"
    ? <Flex direction="column" gap={L.items.gap} data-testid={testId}>{fold.shown.map((x, i) => <PanelEntry key={i} tone={tone}><PanelText>{x}</PanelText></PanelEntry>)}</Flex>
    : (
      <Box as="ul" listStyleType="none" m={0} p={0} display="flex" flexDirection="column" gap={L.items.gap} data-testid={testId}>
        {fold.shown.map((x, i) => (
          <Box as="li" key={i} position="relative" pl={L.items.indent} fontSize={L.text.fontSize} lineHeight={L.text.lineHeight} color={colour("body")} minW={0} overflowWrap="anywhere"
            _before={{ content: '""', position: "absolute", left: "0.35em", top: L.items.marker.top, width: L.items.marker.size, height: L.items.marker.size, borderRadius: "full", background: colour("marker") }}>
            {x}
          </Box>
        ))}
      </Box>
    );
  return <>{list}{fold.hidden > 0 && <PanelMore open={fold.open} onToggle={fold.toggle} hidden={fold.hidden} noun={noun} />}</>;
}

/** Something with a title of its own (a role, a qualification, a competency): a card with a thin rule on the left whose colour means one thing. */
export function PanelEntry({ children, tone = "other", rule, testId }: { children: ReactNode; tone?: keyof typeof TONES; /** a colour scheme, where the rule's colour says a state (a qualification's) */ rule?: string; testId?: string }) {
  return <Box p={L.entry.padding} bg={colour("entry")} borderRadius={L.entry.radius} boxShadow="sm" borderLeft={`${L.entry.rule} solid`} borderColor={`${rule ?? TONES[tone]}.400`} data-testid={testId} minW={0} overflowWrap="anywhere">{children}</Box>;
}
export function EntryTitle({ children }: { children: ReactNode }) {
  return <Text fontWeight={L.entry.title.fontWeight} fontSize={L.entry.title.fontSize} color={colour("ink")}>{children}</Text>;
}
export function EntryMeta({ parts, gapBelow }: { parts: (string | undefined | null | false)[]; gapBelow?: boolean }) {
  const shown = parts.filter((p): p is string => !!p && !!p.trim());
  return shown.length ? <Text fontSize={L.entry.meta.fontSize} fontWeight={L.entry.meta.fontWeight} color={colour("muted")} mb={gapBelow ? 3 : 0}>{shown.join(" · ")}</Text> : null;
}
export function PanelEntries({ children }: { children: ReactNode }) {
  return <Flex direction="column" gap={L.entry.gap}>{children}</Flex>;
}

/** Skills: one chip, the same on every panel. */
export function PanelChips({ items, testId, limit, resetKey = "" }: { items: string[]; testId?: string; limit?: number; resetKey?: string }) {
  const fold = useFolded(items, limit ?? items.length, resetKey);
  return (
    <>
      <Flex gap={2} wrap="wrap" data-testid={testId ? `${testId}-list` : undefined}>
        {fold.shown.map((x, i) => <Tag.Root key={`${x}-${i}`} data-testid={testId} size={L.chip.size} colorPalette={L.chip.palette} borderRadius={L.chip.radius} py={L.chip.paddingY} px={L.chip.paddingX} maxW="100%"><Tag.Label whiteSpace="normal">{x}</Tag.Label></Tag.Root>)}
      </Flex>
      {fold.hidden > 0 && <PanelMore open={fold.open} onToggle={fold.toggle} hidden={fold.hidden} noun="skills" />}
    </>
  );
}

/** Stated facts: each label above its value, in as many columns as the panel's width holds. */
export function PanelFacts({ facts, testId }: { facts: [string, string][]; testId?: string }) {
  return (
    <Box as="dl" display="grid" gridTemplateColumns={`repeat(auto-fill, minmax(min(100%, ${L.facts.minColumn}), 1fr))`} columnGap={5} rowGap={0} m={0} minW={0} data-testid={testId}>
      {facts.map(([k, v]) => (
        <Box key={k} py={2} borderBottom="1px dashed" borderColor={colour("line")} minW={0} gridColumn={v.length > L.facts.wide ? "1 / -1" : undefined}>
          <Text as="dt" color={colour("muted")} fontSize={L.facts.label.fontSize} fontWeight={L.facts.label.fontWeight} textTransform="uppercase" letterSpacing={L.facts.label.letterSpacing} mb={0.5}>{k}</Text>
          <Text as="dd" color={colour("ink")} fontSize={L.text.fontSize} overflowWrap="break-word" m={0}>{v}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** One contact detail: the same quiet line and icon for each; a detail the CV does not give says so in the same line. */
export function PanelContact({ icon, value, missing, wrap = false }: { icon: (size: number) => ReactNode; value?: string | null; missing: string; wrap?: boolean }) {
  return (
    <Flex align="center" gap={3} minW={0} px={L.contact.padding.x} py={L.contact.padding.y} bg={colour("ground")} borderWidth="1px" borderColor={colour("line")} borderRadius={L.contact.radius} fontSize={L.text.fontSize}>
      <Box color={colour("accent")} flexShrink={0} aria-hidden>{icon(L.contact.iconSize)}</Box>
      {value ? <Text fontWeight="medium" color={colour("ink")} minW={0} {...(wrap ? { overflowWrap: "anywhere" } : { truncate: true, title: value })}>{value}</Text>
        : <Text fontStyle="italic" color={colour("faint")} minW={0} overflowWrap="anywhere">{missing}</Text>}
    </Flex>
  );
}
export function PanelContacts({ children }: { children: ReactNode }) {
  return <Flex direction="column" gap={L.contact.gap} minW={0}>{children}</Flex>;
}

/** A group of items under the document's own heading, folded until opened; one open at a time is the caller's choice. */
export function PanelGroup({ heading, count, open, onToggle, children, testId }: { heading: string; count: number; open: boolean; onToggle: () => void; children: ReactNode; testId?: string }) {
  return (
    <Box bg={colour("entry")} borderRadius="md" mb={2} overflow="hidden" data-testid={testId}>
      <Box as="button" {...({ type: "button" } as object)} w="100%" display="flex" justifyContent="space-between" alignItems="center" gap={3} px={3} py={2.5} textAlign="left" onClick={onToggle} aria-expanded={open}
        _focusVisible={{ outline: "2px solid", outlineColor: colour("focus"), outlineOffset: "-2px" }}>
        <Text fontSize={L.text.fontSize} fontWeight={open ? "semibold" : "medium"} color={colour("ink")} minW={0} overflowWrap="anywhere">{heading}</Text>
        <Text fontSize={L.note.fontSize} color={colour("faint")} flex="none">{count} {open ? "▾" : "▸"}</Text>
      </Box>
      {open && <Box px={3} pb={3} className="rm-reveal">{children}</Box>}
    </Box>
  );
}

/** The bottom of every panel, the same on every tab: how it was read, the original document, when it was uploaded. */
export function PanelFooter({ readBy, original, uploaded }: { readBy?: { text: string; testId: string }; original?: { href: string; label: string; testId?: string }; uploaded: { text: string; title: string } }) {
  return (
    <Flex mt={6} pt={4} borderTop="1px solid" borderColor={colour("line")} align="center" gap={L.footer.gap} wrap="wrap" fontSize={L.footer.fontSize} color={colour("muted")}>
      {readBy && <Text data-testid={readBy.testId}>{readBy.text}</Text>}
      <Box flex={1} />
      {original && <Button href={original.href} target="_blank" rel="noreferrer" size="sm" leftIcon={<FiExternalLink />} variant="outline" colorPalette="blue" data-testid={original.testId}>{original.label}</Button>}
      <Text title={uploaded.title} data-testid="uploaded-on">{uploaded.text}</Text>
    </Flex>
  );
}

// ---- a match assessment --------------------------------------------------------------------------------------------------------------------------

/** The one sentence a reader takes away (an assessment's summary): a step larger than ordinary text. */
export function PanelLead({ children, testId }: { children: ReactNode; testId?: string }) {
  return <Text fontSize={L.lead.fontSize} lineHeight={L.text.lineHeight} color={colour("ink")} data-testid={testId}>{children}</Text>;
}
/** A part of a panel that opens in place under a rule (an assessment's "Every requirement"): a real button with aria-expanded. */
export function PanelFold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <Box borderTopWidth="1px" borderColor={colour("line")}>
      <Flex as="button" {...({ type: "button" } as object)} w="100%" align="center" justify="space-between" py={3} textAlign="left" aria-expanded={open} aria-controls={id} onClick={onToggle}
        _focusVisible={{ outline: "2px solid", outlineColor: colour("focus"), outlineOffset: "2px" }}>
        <Text fontWeight={L.fold.fontWeight} fontSize={L.fold.fontSize} color={colour("ink")}>{titleCase(title)}</Text>
        <Text aria-hidden fontSize={L.text.fontSize} color={colour("muted")} transform={open ? "rotate(180deg)" : undefined} transition="transform .32s cubic-bezier(.16,1,.3,1)">▾</Text>
      </Flex>
      {open && <Box id={id} role="region" aria-label={title} pb={4} className="rm-reveal">{children}</Box>}
    </Box>
  );
}
/** A small heading inside a panel's part ("Strengths", "Must-haves: 3 of 4 met"). */
export function PanelSubhead({ children, testId }: { children: ReactNode; testId?: string }) {
  return <Text fontWeight={L.fold.fontWeight} fontSize={L.fold.fontSize} color={colour("ink")} data-testid={testId}>{children}</Text>;
}
/** An evidence state: its mark alone, or as a labelled badge. Colour is never the only signal. */
export function EvidenceMark({ state }: { state: EvidenceKind }) {
  return <Box as="span" aria-hidden color={colour(EVIDENCE[state].ink)} fontWeight="bold" w="1.2em" flexShrink={0} textAlign="center">{EVIDENCE[state].mark}</Box>;
}
export function EvidenceBadge({ state }: { state: EvidenceKind }) {
  const e = EVIDENCE[state];
  return <Badge colorPalette={e.palette} variant="subtle" whiteSpace="nowrap" size={L.badge.label}><Box as="span" aria-hidden mr={1}>{e.mark}</Box>{e.label}</Badge>;
}
/** How many requirements are in each state, as one bar. */
export function EvidenceBar({ tally }: { tally: { state: EvidenceKind; n: number }[] }) {
  return <Flex h="6px" borderRadius="full" overflow="hidden" bg={colour("track")} aria-hidden>{tally.map((t) => t.n > 0 && EVIDENCE[t.state].bar && <Box key={t.state} flex={t.n} bg={colour(EVIDENCE[t.state].bar!)} />)}</Flex>;
}

// ---- the board's cards ------------------------------------------------------------------------------------------------------------------------------

/** A card on the board, the same frame for a candidate and a job: selected, hovered, dragged and dropped on alike, and locked while being read again. */
export function RecordCard({ kind, id, label, selected, busy, height, onClick, onFindMatches, onDropOther, children }: {
  kind: "candidate" | "job"; id: string; label: string; selected: boolean; busy: boolean; height: string;
  onClick: () => void; onFindMatches?: (id: string) => void; onDropOther?: (otherId: string) => void; children: ReactNode;
}) {
  const [over, setOver] = useState(false), other = kind === "candidate" ? "job" : "candidate";
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || busy) return;   // keys inside the card's own buttons are theirs; a card being read again takes none
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
    else if ((e.key === "m" || e.key === "M") && onFindMatches) { e.preventDefault(); onFindMatches(id); }   // the keyboard's way to drag into the Shortlist Matching Zone
  };
  const drop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setOver(false); if (e.dataTransfer.getData("type") === other && onDropOther) onDropOther(e.dataTransfer.getData("text/plain")); };
  return (
    <Card.Root p={CARD_LOOK.padding} h={height} minH={height} maxH={height} overflow="hidden" position="relative" w="100%"
      bg={colour(over ? "dropping" : "surface")} border="1px solid" borderColor={colour(over || selected ? "chosen" : "line")} borderRadius={CARD_LOOK.radius}
      boxShadow={over || selected ? "0 0 5px var(--chakra-colors-panel-chosen)" : "sm"}
      _hover={{ borderColor: colour("hover"), boxShadow: "sm", transform: "translateY(-2px)" }} _focusVisible={{ outline: "2px solid", outlineColor: colour("chosen"), outlineOffset: "2px" }}
      cursor={busy ? "progress" : "grab"} transition="all 0.2s ease" aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick} role="group" aria-roledescription={`selectable ${kind} card`} aria-label={`${label}${selected ? ", selected" : ""}`} aria-keyshortcuts="Enter M" tabIndex={0}
      onKeyDown={keys} title={`Press Enter to select, M to find matching ${kind === "candidate" ? "roles" : "candidates"}`}
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.setData("type", kind); e.dataTransfer.setData("id", id); e.dataTransfer.setData("text/plain", id); e.currentTarget.style.opacity = "0.6"; }}
      onDragEnd={(e) => { e.currentTarget.style.opacity = "1"; }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); e.dataTransfer.dropEffect = "move"; }} onDragLeave={() => setOver(false)} onDrop={drop}>
      {children}
      {busy && (
        <Flex position="absolute" inset={0} zIndex={3} direction="column" align="center" justify="center" gap={3} bg={colour("veil")} borderRadius={CARD_LOOK.radius} role="status" data-testid="card-rereading">
          <Text fontWeight="semibold" fontSize={L.text.fontSize}>Reading again…</Text>
          <BrandBar width="60%" />
          <Text fontSize={CARD_LOOK.detail.fontSize} color={colour("muted")}>Locked until the new reading is in</Text>
        </Flex>
      )}
    </Card.Root>
  );
}
/** A card's name (two lines kept for it, so every card is the same height) and the line under it. */
export function CardTitle({ children, title }: { children: ReactNode; title?: string }) {
  const t = CARD_LOOK.title;
  return <Text fontWeight={t.fontWeight} fontSize={t.fontSize} lineHeight={t.lineHeight} lineClamp={t.lines} minH={`calc(${t.lineHeight} * ${t.lines})`} color={colour("ink")} wordBreak="break-word" title={title}>{children}</Text>;
}
export function CardSubtitle({ children, title }: { children: ReactNode; title?: string }) {
  const t = CARD_LOOK.subtitle;
  return <Text fontSize={t.fontSize} fontWeight={t.fontWeight} lineHeight={t.lineHeight} lineClamp={t.lines} minH={`${Number(t.lineHeight) * t.lines}em`} color={colour("muted")} wordBreak="break-word" title={title}>{children}</Text>;
}
/** A small line of detail on a card; empty lines keep their place, so cards line up. */
export function CardDetail({ children, title, lines = 1, italic, testId }: { children?: ReactNode; title?: string; lines?: number; italic?: boolean; testId?: string }) {
  const d = CARD_LOOK.detail;
  return <Text fontSize={d.fontSize} lineHeight={d.lineHeight} color={colour("muted")} fontStyle={italic ? "italic" : undefined} lineClamp={lines} minH={lines > 1 ? `${Number(d.lineHeight) * lines}em` : undefined} title={title} data-testid={testId}>{children || " "}</Text>;
}
/** A card's first skills, on one line. */
export function CardChips({ items, max, none }: { items: string[]; max: number; none: string }) {
  return (
    <Flex gap={1} mt={2} h="26px" overflow="hidden" align="center">
      {items.map((x, i) => (
        <Tag.Root key={`${x}-${i}`} data-testid="skill-chip" size={CARD_LOOK.chip.size} colorPalette={CARD_LOOK.chip.palette} variant="subtle" borderRadius="md" boxShadow="sm" py={1} flex="0 1 auto" minW={0} maxW={`${Math.floor(100 / Math.max(1, max)) - 2}%`} title={x}>
          <Tag.Label truncate>{x}</Tag.Label>
        </Tag.Root>
      ))}
      {items.length === 0 && <Tag.Root size={CARD_LOOK.chip.size} variant="subtle" bg={colour("emptyChip")} borderRadius="md"><Tag.Label>{none}</Tag.Label></Tag.Root>}
    </Flex>
  );
}
/** A small label on a card (a status, a department), the same size everywhere. */
export function CardBadge({ children, palette, title }: { children: ReactNode; palette: string; title?: string }) {
  return <Badge colorPalette={palette} fontSize={CARD_LOOK.badge.fontSize} px={2} py={0.5} borderRadius="md" whiteSpace="nowrap" boxShadow="sm" maxW="100%" truncate title={title}>{children}</Badge>;
}
/** The bottom line of a card: where, and when it was uploaded. */
export function CardFooter({ children }: { children: ReactNode }) {
  return <Flex mt="auto" justify="space-between" align="center" gap={2} minW={0} fontSize={CARD_LOOK.footer.fontSize} fontWeight={CARD_LOOK.footer.fontWeight} color={colour("muted")}>{children}</Flex>;
}
