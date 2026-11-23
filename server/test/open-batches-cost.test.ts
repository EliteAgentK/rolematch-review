import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeWorld, sleep, type World } from "./portalKit";

// R114. A finished single upload is not an open batch. Found when a clean load test stopped being clean after uploads earlier in the session.
let w: World;
const file = (n: string) => new File([readFileSync(join(import.meta.dirname, "fixtures/journey", n))], n);
const published = async (id: string) => { for (let i = 0; i < 300; i++) { const d = (await w.users[0].get(`/api/documents/${id}`)).body; if (d.status === "published") return; await sleep(100); } throw new Error("not published"); };
beforeAll(async () => { w = await makeWorld(8996, 2, { SIGNUP_REQUIRE_CODE: "false" }); }, 240000);
afterAll(async () => { await w?.stop(); }, 120000);

test("a finished single file is not listed as an open batch", async () => {
  await published((await w.users[0].upload(file("CV0501.docx"), { kind: "cv" })).body.id);
  await sleep(3500);
  expect((await w.users[0].get("/api/batches")).body).toEqual([]);
}, 120000);

test("a real batch is still listed, for everyone in the portal, and an acknowledgement is one person's own", async () => {
  const [a, b] = w.users;
  const made = (await a.post("/api/batches", { kind: "cv", files: 3, bytes: 3000 })).body;
  const seen = (await b.get("/api/batches")).body;
  expect(seen.map((x: any) => x.id)).toContain(made.id);
  await a.post(`/api/batches/${made.id}/cancel`);
  expect((await a.post(`/api/batches/${made.id}/ack`)).status).toBeLessThan(300);
  const mine = (await a.get("/api/batches")).body.find((x: any) => x.id === made.id), theirs = (await b.get("/api/batches")).body.find((x: any) => x.id === made.id);
  expect(mine.acknowledgedByMe).toBe(true);
  expect(theirs.acknowledgedByMe).toBe(false);
}, 60000);
