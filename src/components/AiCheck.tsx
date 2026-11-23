import { Badge, Flex, Text } from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { api, type MatchResult } from "@/api/client";
import { pauseUntilSeen } from "../utils/wake";

// Claude's part in a match and in a CV's reading, said plainly. It shows only what the server stored: nothing here claims the AI looked at something it did not.
// Matching is the AI's alone (owner, 9 Nov 2026): a score is shown only once it is final, never while it is being worked out.

/** Waits until every given match has its final AI score (or is known not to have one), asking about all of them at once every few seconds, and says how
 *  many are done as they arrive. The results come back in the order given. Gives up, with an error, after twenty minutes. */
export async function waitForScores(results: MatchResult[], onProgress: (done: number, total: number) => void, stopped: () => boolean = () => false): Promise<MatchResult[]> {
  const all = [...results], total = all.length, until = Date.now() + 20 * 60_000;
  const open = () => all.filter((r) => r.id && r.ai?.state === "pending");
  onProgress(total - open().length, total);
  while (open().length) {
    if (stopped()) throw new Error("Stopped.");
    if (Date.now() > until) throw new Error("The AI is taking much longer than usual. The scoring carries on; open the match again in a few minutes to see it.");
    await pauseUntilSeen(3000);   // checked again at once when the person comes back to the page (src/utils/wake.ts)
    const ask = open().map((r) => r.id!);
    for (let i = 0; i < ask.length; i += 100) {
      const answers = await api.aiStatus(ask.slice(i, i + 100)).catch(() => []);
      for (const a of answers) {
        const at = all.findIndex((r) => r.id === a.id);
        if (at < 0) continue;
        if (a.result) all[at] = { ...a.result, id: a.id };
        else if (a.ai && a.ai.state !== "pending") all[at] = { ...all[at], ai: a.ai };
      }
    }
    onProgress(total - open().length, total);
  }
  return all;
}

/** On a candidate: said only when the AI could not read this CV, and why. A CV the AI read carries no label (owner, 9 Nov 2026: no "checked by AI" labels). */
export function AiReadingNote({ reading }: { reading?: { state: "read" | "not_read"; model?: string; reason?: string } }) {
  const muted = useColorModeValue("gray.600", "gray.300");
  if (!reading || reading.state === "read") return null;
  return (
    <Flex mt={4} gap={2} align="center" wrap="wrap" data-testid="ai-reading-note">
      <Badge colorPalette="gray" variant="subtle">Read by the parser only</Badge>
      <Text fontSize="xs" color={muted}>{reading.reason}</Text>
    </Flex>
  );
}
