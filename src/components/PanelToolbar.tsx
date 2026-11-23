import { Box, Flex, Heading, Text } from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { CloseIcon } from "./ui/icons";
import type { ReactNode } from "react";

/**
 * The same header for the candidate and job panels: the title with a close (X) at the right, and one row of actions beneath it.
 * It is part of the panel and scrolls away with it (it is not pinned). Nothing wraps or overlaps at any width.
 */
export default function PanelToolbar({ title, editing, editLabel, onEdit, onSave, onCancel, onClose, beside, children }: {
  title: string; editing: boolean; editLabel: string; onEdit?: () => void; onSave: () => void; onCancel: () => void; onClose: () => void; /** shown next to the edit button while not editing */ beside?: ReactNode; children?: ReactNode;
}) {
  return (
    <Box pb={3} mb={3} borderBottomWidth="1px" borderColor={useColorModeValue("gray.100", "gray.700")}>
      <Flex align="center" justify="space-between" mb={2} gap={2}>
        <Heading size="md" lineClamp={1} color={useColorModeValue("gray.800", "white")}>{title}</Heading>
        <IconButton aria-label="Close panel" size="sm" variant="ghost" onClick={onClose}><CloseIcon boxSize={2.5} /></IconButton>
      </Flex>
      <Flex gap={2} align="center">
        {editing ? (
          <>
            <Button size="sm" colorPalette="green" onClick={onSave}>Save changes</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          </>
        ) : onEdit ? (
          <Button size="sm" colorPalette="blue" onClick={onEdit}>{editLabel}</Button>
        ) : <Text fontSize="sm" color="fg.muted">View only</Text>}
        {!editing && beside}
        <Box ml="auto">{children}</Box>
      </Flex>
    </Box>
  );
}
