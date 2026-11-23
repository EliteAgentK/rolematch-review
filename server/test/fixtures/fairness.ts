// Run as a child process with DB_SCHEMA set. Prints the order in which organisations' jobs are claimed.
import postgres from "postgres";
process.env.PER_ORG_CONCURRENCY = "100";
const { claim } = await import("../../src/queue");
const { sql } = await import("../../src/db");
const [big, small] = [crypto.randomUUID(), crypto.randomUUID()];
await sql`insert into orgs (id, name) values (${big}, 'Big'), (${small}, 'Small')`;
const [pBig, pSmall] = [crypto.randomUUID(), crypto.randomUUID()];   // every queued job belongs to a portal
await sql`insert into portals (id, org_id, name) values (${pBig}, ${big}, 'Main'), (${pSmall}, ${small}, 'Main')`;
for (let i = 0; i < 20; i++) await sql`insert into queue (id, org_id, portal_id, type, payload, created_at) values (${crypto.randomUUID()}, ${big}, ${pBig}, 'noop', ${{}}, now() - interval '10 minutes' + (${i} * interval '1 second'))`;
for (let i = 0; i < 3; i++) await sql`insert into queue (id, org_id, portal_id, type, payload, created_at) values (${crypto.randomUUID()}, ${small}, ${pSmall}, 'noop', ${{}}, now() + (${i} * interval '1 second'))`;
const order: string[] = [];
for (let i = 0; i < 8; i++) { const r = await claim(); order.push(r ? (r.org_id === big ? "big" : "small") : "none"); }
console.log(JSON.stringify(order));
await sql.end();
