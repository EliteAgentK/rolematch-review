// Makes the crowd's shape harder: most people in ordinary small portals, but one organisation with a very crowded portal and a second portal beside it, holding its own records.
// Those who are moved are recorded in a new accounts file, so the crowd's check on what each person sees follows them. Only ever applied to the bench's disposable copy.
//   node crowdedPortals.mjs <accounts.json> <out accounts.json> <out.sql> <people in portal A> <people in portal B>
import { readFileSync, writeFileSync } from "node:fs";
const [inFile, outFile, sqlFile, inA, inB] = process.argv.slice(2), file = JSON.parse(readFileSync(inFile, "utf8")), A = Number(inA), B = Number(inB);
if (!file.accounts.every((a) => a.email.endsWith("@load.invalid"))) throw new Error("accounts must be the invented ones");
const home = file.accounts.find((a) => a.role === "admin"), label = home.org, n = label.split(" org ")[1], moved = file.accounts.filter((a) => a.org !== label && a.role !== "admin" );
const step = Math.floor(moved.length / (A + B)), chosen = moved.filter((_, i) => i % step === 0).slice(0, A + B), toA = chosen.slice(0, A), toB = chosen.slice(A);
const portalB = crypto.randomUUID();
const quote = (s) => `'${s.replace(/'/g, "''")}'`, list = (xs) => xs.map((a) => quote(a.email)).join(",");
writeFileSync(sqlFile, `
begin;
create temp table home on commit drop as select m.org_id, pm.portal_id, m.user_id from members m join portal_members pm on pm.user_id = m.user_id where m.email = ${quote(home.email)};
insert into portals (id, org_id, name, created_by) select '${portalB}', org_id, 'Second portal', user_id from home;
insert into portal_capacity (portal_id, org_id) select '${portalB}', org_id from home;
insert into portal_members (portal_id, org_id, user_id, role) select '${portalB}', org_id, user_id, 'admin' from home;
delete from portal_members where user_id in (select user_id from members where email in (${list(chosen)}));
update members set org_id = (select org_id from home) where email in (${list(chosen)});
insert into portal_members (portal_id, org_id, user_id, role) select (select portal_id from home), (select org_id from home), user_id, role from members where email in (${list(toA)});
insert into portal_members (portal_id, org_id, user_id, role) select '${portalB}', (select org_id from home), user_id, role from members where email in (${list(toB)});
-- The second portal's own records: copies with their own ids and an address that names the portal, so any answer crossing between the two portals shows at once.
create temp table cmap on commit drop as select c.id as old_c, gen_random_uuid() as new_c, c.document_id as old_d, gen_random_uuid() as new_d from candidates c where c.portal_id = (select portal_id from home) order by c.created_at limit 60;
create temp table jmap on commit drop as select j.id as old_c, gen_random_uuid() as new_c, j.document_id as old_d, gen_random_uuid() as new_d from jobs j where j.portal_id = (select portal_id from home) order by j.created_at limit 12;
insert into documents select (jsonb_populate_record(d, jsonb_build_object('id', m.new_d, 'portal_id', '${portalB}', 'record_id', m.new_c, 'sha256', md5(m.new_d::text) || md5(m.old_d::text), 'batch_id', null))).* from documents d join (select * from cmap union all select * from jmap) m on m.old_d = d.id;
insert into candidates (id, org_id, portal_id, document_id, data, extracted, version, created_at, updated_at) select m.new_c, c.org_id, '${portalB}', m.new_d, jsonb_set(c.data, '{email}', to_jsonb(replace(c.data->>'email', '.o${n}@', '.o${n}b@'))), c.extracted, c.version, c.created_at, c.updated_at from candidates c join cmap m on m.old_c = c.id;
insert into jobs (id, org_id, portal_id, document_id, data, extracted, version, created_at, updated_at) select m.new_c, j.org_id, '${portalB}', m.new_d, j.data, j.extracted, j.version, j.created_at, j.updated_at from jobs j join jmap m on m.old_c = j.id;
commit;
select 'portal A people', count(*) from portal_members where portal_id = (select pm.portal_id from portal_members pm join members m on m.user_id = pm.user_id where m.email = ${quote(home.email)} and pm.portal_id <> '${portalB}');
select 'portal B people', count(*) from portal_members where portal_id = '${portalB}';
select 'portal B candidates', count(*) from candidates where portal_id = '${portalB}';
`);
const moves = new Map([...toA.map((a) => [a.email, { org: label, portal: home.portal }]), ...toB.map((a) => [a.email, { org: `${label}b`, portal: portalB }])]);
writeFileSync(outFile, JSON.stringify({ ...file, accounts: file.accounts.map((a) => ({ ...a, ...(moves.get(a.email) ?? {}) })) }));
console.log(`${A} moved to the crowded portal of ${label}, ${B} to a second portal beside it`);
