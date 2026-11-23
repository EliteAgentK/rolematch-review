// The periodic copy of the database (scripts/refreshCopy.ts): what is left out of it, and why.
import { expect, test } from "vitest";
import { forCopy } from "../scripts/refreshCopy";

test("links to the sign-in service's user table are left out of the copy, because that table (password hashes) is never copied", () => {
  const dump = [
    "CREATE SCHEMA public;",
    "CREATE TABLE public.members (user_id uuid NOT NULL, org_id uuid NOT NULL);",
    "ALTER TABLE ONLY public.members",
    "    ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;",
    "ALTER TABLE ONLY public.members",
    "    ADD CONSTRAINT members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;",
    "ALTER TABLE ONLY public.orgs ALTER COLUMN id SET DEFAULT gen_random_uuid();",
  ].join("\n");
  const out = forCopy(dump);
  expect(out).not.toMatch(/REFERENCES auth\./);
  expect(out).not.toMatch(/^CREATE SCHEMA public;$/m);
  expect(out).toMatch(/members_org_id_fkey FOREIGN KEY \(org_id\) REFERENCES public\.orgs/); // links between RoleMatch's own tables stay
  expect(out).toMatch(/ALTER TABLE ONLY public\.orgs ALTER COLUMN id SET DEFAULT/);           // one-line statements are untouched
  expect(out.split("\n")).toHaveLength(4); // 7 lines, less the schema line and the two-line link
});
