import { Box, Text } from "@chakra-ui/react";
import { Select } from "./ui/select";

// A list's filter on the Matching Board. While it is on All it says what it filters ("Location", "Status", "Departments"); once a value is chosen it
// shows that value. All is always the first choice and where every filter starts (owner, 10 Nov 2026: "it just says all and all ... it should say what
// the dropdown is", "it shouldn't say all departments, just departments", "all ... should always be the initial one selected").
// The list itself stays the browser's own, so it works with the keyboard, a screen reader and a phone's picker; only the closed field's words change.
export function FilterSelect({ name, value, options, label = (o) => o, onChange, hint }: { name: string; value: string | undefined; options: string[]; label?: (o: string) => string; onChange: (v: string) => void; /** what the filter applies to, for the tooltip ("for Head of Technology") */ hint?: string }) {
  const all = !value || value === "All";
  return (
    <Box position="relative" flex="1" minW={0} data-testid={`filter-${name.toLowerCase()}`}>
      <Select size="sm" aria-label={name} title={`${name}${hint ? ` (${hint})` : ""}: ${all ? "all" : label(value!)}`} value={value ?? "All"} onChange={(e) => onChange(e.target.value)}
        css={{ color: all ? "transparent" : undefined, "& option": { color: "var(--chakra-colors-fg)" } }}>
        {options.map((o) => <option key={o} value={o}>{o === "All" ? "All" : label(o)}</option>)}
      </Select>
      {all && <Text position="absolute" left={3} top="50%" transform="translateY(-50%)" pointerEvents="none" fontSize="sm" maxW="calc(100% - 36px)" truncate aria-hidden>{name}</Text>}
    </Box>
  );
}
