// The load test's accounts on the load target (docs/ops/TRENDS_AND_LOAD.md), run inside the load target's own container by deploy/pc/load-target.sh:
//   node src/scripts/loadTarget.js seed <companies> <recruiters each>   prints the accounts as JSON on standard output (the shell keeps them root-only)
//   node src/scripts/loadTarget.js clear                                removes every account, file and record the load test made
// Refused anywhere but a throw-away database: its schema must start with load_, its settings must say ROLEMATCH_ENVIRONMENT=test, and it must be on this
// machine. Live, the copy and any real database are never touched; every address is @load.test, a domain that cannot receive mail.
import { randomBytes } from "node:crypto";
import { createUser } from "../auth";
import { config } from "../config";
import { sql } from "../db";
import { identity } from "../identity";
import { deleteObjects } from "../supabase";
import { targetOf } from "./target";

const t = targetOf(config.databaseUrl, process.env.ROLEMATCH_ENVIRONMENT ?? "");
if (!/^load_[a-z0-9_]+$/.test(config.dbSchema) || t.environment !== "test" || t.refuse) {
  console.error(`Refusing: the load test runs only in a load_ schema of a test database on this machine (schema ${config.dbSchema}, environment ${t.environment || "not stated"}, ${t.where}).`);
  process.exit(2);
}
const [command, a, b] = process.argv.slice(2);

if (command === "seed") {
  const companies = Number(a), each = Number(b);
  if (!(companies >= 1 && companies <= 20 && each >= 1 && each <= 100)) { console.error("seed <companies 1-20> <recruiters each 1-100>"); process.exit(1); }
  const password = randomBytes(18).toString("base64url"), accounts: { company: number; email: string }[] = [];
  // One person at a time: createUser finds a company by its name, so two of the same company made at once would each make their own.
  for (let c = 1; c <= companies; c++) for (let r = 1; r <= each; r++) {
    const email = `load-c${c}-r${r}@load.test`;
    await createUser(`Load test company ${c}`, email, `Load Recruiter ${c}-${r}`, password, r === 1 ? "admin" : "recruiter");
    accounts.push({ company: c, email });
  }
  const [{ n }] = await sql`select count(distinct org_id)::int as n from members`;
  if (n !== companies) { console.error(`expected ${companies} companies, found ${n}`); process.exit(1); }
  process.stdout.write(JSON.stringify({ password, accounts }));
} else if (command === "clear") {
  // Files first (their paths are in the schema), then the schema, then the sign-in accounts: the same order as a test's own teardown (test/helpers.ts).
  const paths = (await sql`select storage_path from documents where storage_path is not null`).map((r: any) => r.storage_path as string);
  const users = (await sql`select user_id from members`).map((r: any) => r.user_id as string);
  for (let i = 0; i < paths.length; i += 100) await deleteObjects(paths.slice(i, i + 100));
  await sql.unsafe(`drop schema "${config.dbSchema}" cascade`);
  for (const id of users) await identity.adminDeleteUser(id);
  console.error(`cleared: ${users.length} accounts, ${paths.length} files, schema ${config.dbSchema}`);
} else { console.error("seed <companies> <recruiters each> | clear"); process.exit(1); }
await sql.end();
