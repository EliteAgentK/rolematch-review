import { describe, expect, it } from "vitest";
import { whatBecameOf } from "./vanishedDocuments";
import type { PendingDocument } from "../api/client";

const doc = (id: string, status: PendingDocument["status"], batchId: string | null = null) => ({ id, kind: "cv", fileName: `${id}.pdf`, status, stage: "done", batchId }) as PendingDocument;

// Code review, 16 Nov 2026, E-M7: the board took any document that was being read last time and was missing from the list now as published, and said
// "Document published". The list leaves out a failure once it is cleared (another tab clears it as soon as it shows the warning), so a failed document
// was announced as a success.
describe("documents that were being read and are no longer in the list", () => {
  it("only a document the server says is published counts as published", async () => {
    const server: Record<string, PendingDocument> = { a: doc("a", "published"), b: doc("b", "exception") };
    const r = await whatBecameOf(["a", "b"], async (id) => server[id] ?? "gone");
    expect(r.published).toEqual(["a"]);
    expect(r.failed.map((d) => d.id)).toEqual(["b"]);
  });
  it("one still being read (beyond the list's newest 100) is followed on, not announced", async () => {
    const r = await whatBecameOf(["c"], async () => doc("c", "processing"));
    expect(r).toEqual({ published: [], failed: [], followOn: ["c"] });
  });
  it("one that could not be looked up is asked about again next time; one deleted is dropped; neither is announced", async () => {
    const r = await whatBecameOf(["d", "e"], async (id) => (id === "d" ? null : "gone"));
    expect(r).toEqual({ published: [], failed: [], followOn: ["d"] });
  });
});
