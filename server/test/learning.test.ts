import { afterAll, beforeAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeWorld, sleep, type World } from "./portalKit";

// The learning record. A suspected error is not a label; a retry is not a second lesson; what becomes general holds no one's document.
let w: World, other: World, candidateId = "";
const S = () => (w as any).tdb.schema;
const cv = (f: string) => new File([readFileSync(join(import.meta.dirname, "fixtures/journey", f))], f);
const edit = (x: World, id: string, body: object) => x.users[0].req(`/api/candidates/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rows = () => w.admin.unsafe(`select * from "${S()}".error_register where record_id = $1`, [candidateId]) as Promise<any[]>;
const published = async (x: World, id: string) => { for (let i = 0; i < 300; i++) { const d = (await x.users[0].get(`/api/documents/${id}`)).body; if (d.status === "published") return d.recordId as string; await sleep(300); } throw new Error("not published"); };
beforeAll(async () => {
  w = await makeWorld(8976, 1, { SIGNUP_REQUIRE_CODE: "false" }); other = await makeWorld(8978, 1, { SIGNUP_REQUIRE_CODE: "false" });
  candidateId = await published(w, (await w.users[0].upload(cv("CV0501.docx"), { kind: "cv" })).body.id);
}, 300_000);
afterAll(async () => { await w?.stop(); await other?.stop(); }, 120_000);

test("a correction is recorded once, however many times it is made; a different correction is its own lesson", async () => {
  const fresh = async () => (await w.users[0].get(`/api/candidates/${candidateId}`)).body;
  const body = { location: "Gqeberha", changeKind: "extraction_correction" };
  expect((await edit(w, candidateId, { version: (await fresh()).version, ...body })).status).toBe(200);
  expect((await edit(w, candidateId, { version: (await fresh()).version, location: "Durban", changeKind: "extraction_correction" })).status).toBe(200);
  expect((await edit(w, candidateId, { version: (await fresh()).version, ...body })).status).toBe(200);
  const r = (await rows()).filter((x) => x.field_path === "location");
  expect(r.length).toBe(2);
  expect(r.every((x) => x.scope === "record" && x.status === "unverified" && x.decision === "pending" && x.permitted_use === "this_organisation")).toBe(true);
}, 60_000);
test("nothing unverified can become general, and nothing can become general without a fictional reproduction", async () => {
  const [row] = await rows();
  await expect(w.admin.unsafe(`update "${S()}".error_register set scope = 'general', permitted_use = 'fictional_reproduction_only', regression_case = 'F-1' where id = $1`, [row.id])).rejects.toThrow(/error_register_general_is_fictional/);
  await w.admin.unsafe(`update "${S()}".error_register set status = 'verified' where id = $1`, [row.id]);
  await expect(w.admin.unsafe(`update "${S()}".error_register set scope = 'general', permitted_use = 'fictional_reproduction_only' where id = $1`, [row.id])).rejects.toThrow(/error_register_general_is_fictional/);
  await w.admin.unsafe(`update "${S()}".error_register set scope = 'general', permitted_use = 'fictional_reproduction_only', regression_case = 'F-1', decision = 'promoted' where id = $1`, [row.id]);
  expect((await rows()).find((x) => x.id === row.id).scope).toBe("general");
}, 60_000);
test("another organisation never sees a correction, whatever its scope", async () => {
  const seen = await other.users[0].get(`/api/candidates/${candidateId}`);
  expect(seen.status).toBe(404);
}, 60_000);
