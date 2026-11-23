import { createUser } from "../auth";
import { sql } from "../db";
import { CONFIRM_FLAG, guardTarget } from "./target";
// Usage: bun src/scripts/createUser.ts "Org name" email@example.com "Full Name" "a-long-password"
// --join-existing: the test kit only, which puts several test people in one test organisation on purpose.
const join = process.argv.includes("--join-existing"), [org, email, name, password] = process.argv.slice(2).filter((a) => a !== "--join-existing" && a !== CONFIRM_FLAG);
if (!org || !email || !name || !password) { console.error('Usage: bun src/scripts/createUser.ts "Org" email "Name" password'); process.exit(1); }
// Organisations are never joined by name: two companies can share a name, and an administrator made here for "Acme" must not land inside someone else's
// Acme. This script only makes a new organisation; people join an existing one by invitation (owner's question, 9 Nov 2026).
guardTarget("create-user");   // which database, and never live or one elsewhere unless told on purpose (target.ts; code review, 16 Nov 2026, D-M5)
if (!join && (await sql`select 1 from orgs where name = ${org} limit 1`).length) { console.error(`An organisation named "${org}" already exists. This makes a new organisation only: choose another name, or invite the person from inside the organisation.`); await sql.end(); process.exit(1); }
await createUser(org, email, name, password, "admin");
console.log(`Created ${email}`);
await sql.end();
