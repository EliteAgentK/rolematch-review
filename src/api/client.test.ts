import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The API client run against a stand-in for the server: `fetch` answers from `reply`, and the page's events are counted.
let reply: (url: string, init: RequestInit) => unknown = () => ({});
const asked: string[] = [];
let changed = 0;
let client: typeof import("./client");
beforeAll(async () => {
  const page = new EventTarget();
  page.addEventListener("rolematch:changed", () => { changed++; });
  vi.stubGlobal("window", page);
  vi.stubGlobal("BroadcastChannel", undefined);   // other tabs are not part of these tests
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    asked.push(`${init.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify(reply(url, init)), { status: 200, headers: { "content-type": "application/json" } });
  });
  client = await import("./client");
});
beforeEach(() => { changed = 0; asked.length = 0; });

// Code review, 16 Nov 2026, E-M9: every successful request other than a GET told every Overview open in the browser that the board had changed, including
// the AI-status check polled every 3 s during a matching run, so each Overview fetched its figures again and re-warmed every period every 3 s.
describe("which requests tell the Overview that something changed", () => {
  it("checking where the AI's scoring stands changes nothing", async () => {
    reply = () => [];
    await client.api.aiStatus(["m1", "m2"]);
    expect(asked).toEqual(["POST /api/matches/ai-status"]);
    expect(changed).toBe(0);
  });
  it("signing in, sign-in options and looking up an invitation change nothing on the board", async () => {
    reply = () => ({ user: {}, session: null, challengeId: "x", options: {} });
    await client.api.login("a@b.co", "pw");
    await client.api.passkeySignInOptions();
    await client.api.invitation("token");
    expect(changed).toBe(0);
  });
  it("a saved change still does", async () => {
    reply = (_url, init) => JSON.parse(String(init.body));
    await client.api.saveCandidate({ id: "c1", name: "Ann" } as never);
    await client.api.setApplication("c1", "j1", "shortlisted").catch(() => {});
    expect(changed).toBe(2);
  });
});

// Code review, 16 Nov 2026, E-M10: lists are read 100 at a time up to 50 pages. Past 5,000 records the rest were left out and nothing said so, while the
// board showed "Candidates (5000)" and search, filters, Select all and Match all quietly covered only those.
describe("a list longer than the client reads", () => {
  it("is marked as incomplete, with how many there are in all", async () => {
    let n = 0;
    reply = () => ({ items: Array.from({ length: 100 }, () => ({ id: `c${n++}`, name: "Someone" })), nextCursor: "more", total: 6_200 });
    const list = await client.api.candidates(true);
    expect(list.length).toBe(5_000);
    expect(client.listCapped(list)).toEqual({ shown: 5_000, total: 6_200 });
  });
  it("a list read in full is not marked", async () => {
    reply = () => ({ items: [{ id: "j1", title: "Analyst" }], nextCursor: null, total: 1 });
    const list = await client.api.jobs(true);
    expect(list.length).toBe(1);
    expect(client.listCapped(list)).toBeNull();
  });
});
