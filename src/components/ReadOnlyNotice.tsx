import { useEffect, useState } from "react";
import { Alert, Box } from "@chakra-ui/react";
import { AlertIcon, AlertRoot } from "./ui/alert";

type Mode = { mode: "read-only" | "normal"; copyAt: string };

/** "a copy from 11:42 (7 minutes old)", so a copy is never mistaken for live data. A live copy (no recorded time) is "a live copy". */
function describeCopy(copyAt: string, now = new Date()): string {
  if (!copyAt) return "a live copy";
  const at = new Date(copyAt), minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `a copy from ${time} (${minutes < 1 ? "less than a minute" : minutes === 1 ? "1 minute" : `${minutes} minutes`} old)`;
}

/** Shown while the server reads from its copy of the database because the main one is unreachable (docs/architecture/RESILIENCE.md, step 3).
 * It follows the mode the server reports on every response, so it appears and disappears by itself. */
export default function ReadOnlyNotice() {
  const [state, setState] = useState<Mode>({ mode: "normal", copyAt: "" });
  useEffect(() => {
    const onMode = (e: Event) => setState((e as CustomEvent<Mode>).detail);
    window.addEventListener("rolematch:mode", onMode);
    return () => window.removeEventListener("rolematch:mode", onMode);
  }, []);
  if (state.mode !== "read-only") return null;
  return (
    <Box position="sticky" top={0} zIndex={1500}>
      <AlertRoot status="warning" variant="solid" role="status">
        <AlertIcon />
        <Alert.Title>Saving is paused.</Alert.Title>
        <Alert.Description>The main database cannot be reached, so RoleMatch is showing {describeCopy(state.copyAt)}. Anything saved after that will reappear when the main database is back; nothing has been lost. Saving resumes by itself.</Alert.Description>
      </AlertRoot>
    </Box>
  );
}
