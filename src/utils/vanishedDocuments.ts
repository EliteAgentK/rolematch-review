import type { PendingDocument } from "../api/client";

/**
 * What became of documents that were being read last time the board looked and are not in the server's list now. The list leaves out published documents,
 * but also failures once they are cleared (another tab clears a failure as soon as it shows it) and anything past its newest 100, so missing from the list
 * is not proof of publication: each one is looked up (code review, 16 Nov 2026, E-M7).
 * `lookup` gives the document, "gone" when the server no longer has it, or null when it could not be asked (asked again next time).
 */
export async function whatBecameOf(ids: string[], lookup: (id: string) => Promise<PendingDocument | "gone" | null>): Promise<{ published: string[]; failed: PendingDocument[]; followOn: string[] }> {
  const out = { published: [] as string[], failed: [] as PendingDocument[], followOn: [] as string[] };
  for (const [id, d] of await Promise.all(ids.map(async (id) => [id, await lookup(id)] as const))) {
    if (d === "gone") continue;                       // deleted meanwhile: nothing to say
    if (d === null || d.status === "processing") out.followOn.push(id);
    else if (d.status === "published") out.published.push(id);
    else out.failed.push(d);
  }
  return out;
}
