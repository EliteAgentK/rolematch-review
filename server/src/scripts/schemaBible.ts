// Writes the bible's schema chapter from the database itself, so it can never drift from what the migrations build (docs/database/17, §3.1).
//   DATABASE_URL=... [DB_SCHEMA=public] node --import tsx src/scripts/schemaBible.ts [out]     default ../docs/database/03_SCHEMA.generated.md
// Every table must have a line in docs/database/data-classes.json (purpose, personal information, retention); one without stops the run.
// The text names no schema, owner or grant, so the same migrations give the same chapter on any database (owners and grants: 04 and deploy/db).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { dbTls } from "../dbTls";

const schema = process.env.DB_SCHEMA ?? "public";
const out = process.argv[2] ?? fileURLToPath(new URL("../../../docs/database/03_SCHEMA.generated.md", import.meta.url));
const classes = JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/database/data-classes.json", import.meta.url)), "utf8"));
const sql = postgres(process.env.DATABASE_URL!, { ...dbTls(process.env.DATABASE_URL!), max: 1, connection: { search_path: schema } });

export async function chapter() {
  const tables = await sql`select c.oid, c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${schema} and c.relkind = 'r' order by c.relname`;
  const missing = tables.filter((t) => !classes[t.name]).map((t) => t.name);
  if (missing.length) throw new Error(`No line in docs/database/data-classes.json for: ${missing.join(", ")}`);
  const cols = await sql`select c.relname as t, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = ${schema} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by c.relname, a.attnum`;
  const cons = await sql`select c.relname as t, k.conname as name, k.contype as kind, pg_get_constraintdef(k.oid) as def, f.relname as ref
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace left join pg_class f on f.oid = k.confrelid
    where n.nspname = ${schema} order by c.relname, k.contype, k.conname`;
  const idx = await sql`select tablename as t, indexname as name, indexdef as def from pg_indexes where schemaname = ${schema} order by tablename, indexname`;
  const pol = await sql`select tablename as t, policyname as name, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = ${schema} order by tablename, policyname`;
  const trg = await sql`select c.relname as t, g.tgname as name, pg_get_triggerdef(g.oid) as def from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and not g.tgisinternal order by c.relname, g.tgname`;
  // Neither the schema nor where an extension lives may show: it may sit in "extensions", "public" or the app's own schema depending on the database.
  const plain = (s: string) => String(s ?? "").replaceAll(`"${schema}".`, "").replaceAll(`${schema}.`, "").replaceAll("extensions.", "").replaceAll("public.", "");
  const by = (rows: readonly any[], t: string) => rows.filter((r) => r.t === t);
  const ertype = (s: string) => s.replace(/timestamp with time zone/g, "timestamptz").replace(/character varying/g, "varchar").replace(/[^A-Za-z0-9_]/g, "_");
  const L: string[] = [];
  L.push("# Schema (generated from the database)", "",
    "Written by `server/src/scripts/schemaBible.ts` from a database built by the migrations; **do not edit by hand**. A test fails when this file and the migrations disagree.",
    "Purpose, personal information and retention come from `data-classes.json`; owners and grants are in `04_ROLES_AND_SECURITY.md` and `deploy/db/`.", "",
    `${tables.length} tables. Row security is on for ${tables.filter((t) => t.rls).length} of them.`, "", "```mermaid", "erDiagram");
  for (const f of cons.filter((k) => k.kind === "f")) L.push(`  ${f.ref.toUpperCase()} ||--o{ ${f.t.toUpperCase()} : "${f.name}"`);
  for (const t of tables) { L.push(`  ${t.name.toUpperCase()} {`); for (const c of by(cols, t.name)) L.push(`    ${ertype(c.type)} ${c.name}`); L.push("  }"); }
  L.push("```", "");
  for (const t of tables) {
    const k = classes[t.name];
    L.push(`## ${t.name}`, "", k.purpose, "", `* **Personal information:** ${k.personal}`, `* **Kept:** ${k.retention}`, `* **Row security:** ${t.rls ? "on" : "OFF"}${t.forced ? " (forced)" : ""}`, "",
      "| Column | Type | Required | Default |", "|---|---|---|---|");
    for (const c of by(cols, t.name)) L.push(`| ${c.name} | ${c.type} | ${c.notnull ? "yes" : ""} | ${c.def ? "`" + plain(c.def).replaceAll("|", "\\|") + "`" : ""} |`);
    const show = (title: string, rows: string[]) => { if (rows.length) L.push("", `**${title}**`, "", ...rows.map((r) => `* ${r}`)); };
    show("Constraints", by(cons, t.name).map((c) => `\`${c.name}\`: \`${plain(c.def)}\``));
    show("Indexes", by(idx, t.name).map((i) => `\`${i.name}\`: \`${plain(i.def).replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, (_m: string, u: string) => (u ? "UNIQUE " : ""))}\``));
    show("Row-security policies", by(pol, t.name).map((p) => `\`${p.name}\` (${p.cmd} to ${p.roles}): \`${plain(p.qual ?? "")}\`${p.with_check ? ` check \`${plain(p.with_check)}\`` : ""}`));
    show("Triggers", by(trg, t.name).map((g) => `\`${g.name}\`: \`${plain(g.def)}\``));
    L.push("");
  }
  return L.join("\n");
}

if (import.meta.main) {
  try { writeFileSync(out, await chapter()); console.log(`wrote ${out}`); } finally { await sql.end(); }
}
export const end = () => sql.end();
