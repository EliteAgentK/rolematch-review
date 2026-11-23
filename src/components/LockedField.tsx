import { Field, Text } from "@chakra-ui/react";
import { Tooltip } from "./ui/tooltip";
import { FiLock } from "react-icons/fi";

/** A field a recruiter may not change here: its value, read-only, with a lock and the reason on hover. */
export default function LockedField({ label, value, reason }: { label: string; value?: string; reason: string }) {
  return (
    <Field.Root data-testid="locked-field">
      <Field.Label fontSize="sm" mb={1} display="flex" alignItems="center" gap={1}>
        <FiLock aria-hidden size={12} />{label}
        <Tooltip content={reason} showArrow openDelay={300}><Text as="span" fontSize="xs" color="gray.500" tabIndex={0} aria-label={`${label} is locked. ${reason}`}>(read from the document: not editable)</Text></Tooltip>
      </Field.Label>
      {value ? <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }} whiteSpace="pre-wrap">{value}</Text> : null}
    </Field.Root>
  );
}
