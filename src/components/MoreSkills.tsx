import { Box, Popover, Portal, Tag, Wrap, WrapItem } from "@chakra-ui/react";
import { Button } from "./ui/button";
import { PopoverCloseButton } from "./ui/popover";
import { ARROW_GUTTER } from "./ui/tooltip";

/**
 * "View 69 more": opens a small panel with every skill, without changing the size of the card it sits on.
 * Clicks and keys here never select or drag the card, and focus returns to this button when the panel closes.
 */
export default function MoreSkills({ all, count, subject, kind }: { all: string[]; count: number; subject: string; kind: "skills" | "requirements" }) {
  if (count <= 0) return <Box />; // the parent row keeps its height, so every card stays the same size
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Popover.Root positioning={{ placement: "bottom-start", gutter: ARROW_GUTTER }} lazyMount unmountOnExit>
      <Popover.Trigger asChild>
        <Button
          variant="link" size="xs" h="22px" colorPalette="blue" fontWeight="semibold" justifyContent="flex-start"
          aria-label={`View ${count} more ${kind} for ${subject}`}
          onClick={stop} onKeyDown={stop} onMouseDown={stop} draggable={false}
        >
          View {count} more
        </Button>
      </Popover.Trigger>
      <Portal>
      <Popover.Positioner>
      <Popover.Content className="rm-hinge" w="min(360px, 90vw)" onClick={stop} onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}>
        <Popover.Arrow><Popover.ArrowTip /></Popover.Arrow>
        <PopoverCloseButton aria-label="Close" />
        <Popover.Header fontWeight="semibold" fontSize="sm">All {all.length} {kind} · {subject}</Popover.Header>
        <Popover.Body maxH="260px" overflowY="auto">
          <Wrap gap={1.5}>
            {all.map((s, i) => <WrapItem key={`${s}-${i}`}><Tag.Root size="sm" colorPalette="blue" variant="subtle" borderRadius="md" data-testid="all-skill-chip"><Tag.Label>{s}</Tag.Label></Tag.Root></WrapItem>)}
          </Wrap>
        </Popover.Body>
      </Popover.Content>
      </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
