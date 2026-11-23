import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { Application } from "@/api/client";
import { renderHtml, renderText } from "../testing/ssr";
import { StagesContext, jobsHolding } from "../utils/stages";
import CandidateCard from "./CandidateCard";
import CandidateDetails from "./CandidateDetails";
import type { Candidate } from "@/types/records";

// Owner, 17 Nov 2026: "They should be a way to be able to see what they were shortlisted for. Not only on the job." The card said only "Shortlisted";
// which job was in a hover tip (no use on a phone) or behind a closed fold in the panel; the Overview's "Shortlisted candidates" kept every role.
const person = { id: "c1", name: "Nomsa Mahlangu", role: "Chief Financial Officer", status: "shortlisted", avatar: "", skills: ["SAP"], rating: 0, experience: "18",
  location: "Johannesburg", email: "", phone: "", appliedDate: "2026-11-09", version: 1, recruiterNotes: "" };
const app = (jobId: string, jobTitle: string, status: string, updatedAt: string, jobCompany?: string): Application =>
  ({ id: `a-${jobId}`, candidateId: "c1", jobId, jobTitle, jobCompany, status, updatedAt });
const withStages = (all: Application[], el: ReturnType<typeof h>) =>
  h(StagesContext.Provider, { value: { all, set: async () => true, openShortlist: () => {}, openMatch: () => {}, readOnly: false } }, el);
const card = async (all: Application[]) => (await renderText(withStages(all, h(CandidateCard, { candidate: person, isSelected: false, onClick: () => {} })))).toLowerCase();

describe("what a candidate was shortlisted for", () => {
  it("the card names the job, without hovering", async () => {
    const text = await card([app("j1", "Chief Financial Officer", "shortlisted", "2026-11-09T10:00:00Z", "Tamarind Industrial Holdings")]);
    expect(text).toContain("shortlisted for chief financial officer · tamarind industrial holdings");
    expect(text).not.toContain("more");
  });
  it("with several jobs, the latest is named and the rest counted; Not suitable is never named", async () => {
    const text = await card([
      app("j1", "Chief Financial Officer", "shortlisted", "2026-11-09T10:00:00Z", "Tamarind"),
      app("j2", "Group Financial Director", "awaiting interview", "2026-11-12T10:00:00Z", "Ridgeplain"),
      app("j3", "Finance Manager", "declined", "2026-11-14T10:00:00Z"),
    ]);
    expect(text).toContain("awaiting interview for group financial director · ridgeplain");
    expect(text).toContain("+1 more");
    expect(text).not.toContain("for finance manager");
  });
  it("a card with no stage keeps an empty line, so every card stays the same height", async () => {
    const html = await renderHtml(withStages([], h(CandidateCard, { candidate: { ...person, status: "new" }, isSelected: false, onClick: () => {} })));
    expect(html).toContain('data-testid="card-stage-for"');
    expect(html).not.toContain('data-testid="card-stage-job"');
  });
  it("the person's panel lists every job at once, not behind a closed fold", async () => {
    const text = await renderText(withStages([app("j1", "Chief Financial Officer", "shortlisted", "2026-11-09T10:00:00Z", "Tamarind")],
      h(CandidateDetails, { candidate: person as unknown as Candidate, onClose: () => {}, onChange: async (x: Candidate) => x })));
    expect(text).toContain("Chief Financial Officer · Tamarind");
  });
});

describe("the Overview's Shortlisted candidates on the board", () => {
  const all = [
    { ...app("j1", "CFO", "shortlisted", "2026-11-09T10:00:00Z"), candidateId: "c1" },
    { ...app("j2", "Sales", "declined", "2026-11-09T10:00:00Z"), candidateId: "c1" },
    { ...app("j3", "Head of People", "shortlisted", "2026-11-09T10:00:00Z"), candidateId: "gone" },
  ];
  it("keeps only the roles someone on the board is shortlisted for", () => {
    expect([...jobsHolding(all, new Set(["c1"]), "shortlisted")]).toEqual(["j1"]);
  });
});
