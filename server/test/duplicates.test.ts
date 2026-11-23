import { expect, test } from "vitest";
import { compareIdentities, duplicateNotice, identityKeys } from "../src/duplicates";

test("the same person is recognised through formatting, not just exact text", () => {
  const a = identityKeys({ name: "Thandi Mokoena", email: " Thandi.Mokoena@Example.test ", phone: "+27 82 555 0100" });
  const b = identityKeys({ name: "MOKOENA, Thandi", email: "thandi.mokoena@example.test", phone: "082 555 0100" });
  expect(compareIdentities(a, b)?.strength).toBe("strong");
  expect(compareIdentities(a, b)?.reasons).toEqual(["the same email address", "the same phone number"]);
  expect(compareIdentities(identityKeys({ name: "Thandi Mokoena" }), identityKeys({ name: "Mokoena Thandi" }))).toEqual({ strength: "possible", reasons: ["the same name"] });
  expect(identityKeys({ name: "Zoë Müller" }).name).toBe("muller zoe");
});

test("different people are not matched, and a short or missing value never matches anything", () => {
  expect(compareIdentities(identityKeys({ name: "Thandi Mokoena", email: "a@x.test", phone: "082 555 0100" }), identityKeys({ name: "Sipho Ndlovu", email: "b@x.test", phone: "082 555 0199" }))).toBeNull();
  expect(compareIdentities(identityKeys({ name: "Cher" }), identityKeys({ name: "Cher" }))).toBeNull();            // one word is not an identity
  expect(compareIdentities(identityKeys({ phone: "12345" }), identityKeys({ phone: "12345" }))).toBeNull();        // too short to be a number
  expect(compareIdentities(identityKeys({}), identityKeys({}))).toBeNull();
});

test("the reviewer's sentence says what was found and that nothing was merged", () => {
  const n = duplicateNotice([{ id: "1", name: "Thandi Mokoena", uploaded: "2026-10-01", strength: "strong", reasons: ["the same email address"] }]);
  expect(n).toContain("looks like a candidate already in your list");
  expect(n).toContain("nothing was merged");
  expect(duplicateNotice([])).toBeNull();
});
