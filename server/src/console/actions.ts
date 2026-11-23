// The owner's actions in the console (docs/architecture/PLAN_CONSOLE_OPERATIONS.md; owner, 12 Nov 2026: "I should have full autonomy of everything ... if I
// want to delete users, I should be able to"). Each one is asked for with the session's form token (server.ts), the name typed exactly where it removes
// something, and is written to console_actions and to the owner's alerts. The database's part runs in its own functions (migration 050); sign-in
// accounts are removed or blocked through the sign-in service; deleted portals' files are removed by the monitor (file_removals).
import { asConsole, raise } from "./store";
import { identity } from "../identity";   // sign-in through its one module (test/identity-boundary.test.ts)

export class ActionRefused extends Error { constructor(message: string) { super(message); } }
const same = (typed: string, wanted: string) => typed.trim().toLowerCase() === wanted.trim().toLowerCase() && wanted.trim().length > 0;
/** by: which of the console's two accounts did it (migration 052). */
const record = (action: string, kind: "person" | "portal" | "company", id: string | null, name: string, detail: object, by: By = null) =>
  asConsole((q) => q`insert into console_actions (action, target_kind, target_id, target_name, detail, by_email) values (${action}, ${kind}, ${id}, ${name}, ${q.json(detail)}, ${by})`);
export type By = string | null;
/** A console query that says which account is acting, for the records the database's own functions write (migration 052's trigger). */
const asBy = (by: By, fn: (q: any) => Promise<any>) => asConsole(async (q) => { await q`select set_config('rolematch.console_by', ${by ?? ""}, true)`; return fn(q); });
const tell = (title: string, meaning: string) => raise({ fingerprint: `console:action:${Date.now()}`, severity: "info", source: "console", title, meaning, action: "Nothing: this is the record of what you did." }).catch(() => {});

export interface Person { id: string; orgId?: string; name: string; email: string | null; organisation: string; role: string; blocked?: boolean }

export async function deletePerson(p: Person, typed: string, by: By = null) {
  if (!same(typed, p.email ?? "")) throw new ActionRefused(`Type ${p.email} exactly to delete this account.`);
  await identity.adminDeleteUser(p.id);   // their membership goes with the account; their records stay with their portal, credited to no one (migration 044)
  await record("person.deleted", "person", p.id, p.name, { email: p.email, organisation: p.organisation, role: p.role }, by);
  await tell(`You deleted ${p.name}'s account`, `${p.email} (${p.organisation}) can no longer sign in; what they added stays with their portal.`);
}
export async function signOutEverywhere(p: Person, by: By = null) {
  const [{ n }] = await asConsole((q) => q`select console_end_sessions(${p.id}) as n`);
  await record("person.signed_out_everywhere", "person", p.id, p.name, { email: p.email, sessions: Number(n) }, by);
  return Number(n);
}
export async function setBlocked(p: Person, blocked: boolean, by: By = null) {
  await identity.adminSetBlocked(p.id, blocked);
  if (blocked) await asConsole((q) => q`select console_end_sessions(${p.id})`);
  await record(blocked ? "person.blocked" : "person.allowed", "person", p.id, p.name, { email: p.email }, by);
}
export async function deletePortal(portal: { id: string; name: string; company: string }, typed: string, why: string, by: By = null) {
  if (!same(typed, portal.company)) throw new ActionRefused(`Type the company's name, ${portal.company}, exactly to delete this portal.`);
  if (why.trim().length < 4) throw new ActionRefused("Say in a few words why it is being deleted: it is kept with the record.");
  const [{ r }] = await asBy(by, (q) => q`select console_delete_portal(${portal.id}, ${why.trim()}) as r`);
  const total = Object.values(r?.deleted ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
  await tell(`You deleted the portal ${portal.name} of ${portal.company}`, `${total} records and ${(r?.files ?? []).length} original files. Its AI use is kept for the bill.`);
  return { records: total, files: (r?.files ?? []).length };
}
export async function deleteCompany(company: { id: string; name: string }, typed: string, why: string, by: By = null) {
  if (!same(typed, company.name)) throw new ActionRefused(`Type the company's name, ${company.name}, exactly to delete it and everything in it.`);
  if (why.trim().length < 4) throw new ActionRefused("Say in a few words why it is being deleted: it is kept with the record.");
  const [{ r }] = await asBy(by, (q) => q`select console_delete_company(${company.id}, ${why.trim()}) as r`);
  const people: string[] = r?.people ?? [], failed: string[] = [];
  for (const id of people) await identity.adminDeleteUser(id).catch(() => failed.push(id));   // their memberships are already gone; the sign-in accounts follow
  if (failed.length) await record("company.accounts_left", "company", company.id, company.name, { accounts: failed, note: "these sign-in accounts could not be removed; delete them on the People page" }, by);
  await tell(`You deleted the company ${company.name}`, `${people.length} people's accounts and ${(r?.files ?? []).length} original files. Its AI use is kept for the bill.`);
  return { people: people.length, files: (r?.files ?? []).length, accountsLeft: failed.length };
}
export async function setAllowance(company: { id: string; name: string }, value: string, by: By = null) {
  const v = value.trim().toLowerCase();
  if (!(v === "default" || /^\d{1,6}(\.\d{1,2})?$/.test(v))) throw new ActionRefused("Give an amount in dollars (like 20 or 7.50), or the word default.");
  const [{ r }] = await asBy(by, (q) => q`select console_set_allowance(${company.id}, ${v === "default" ? null : Number(v)}) as r`);
  return r;
}
export async function openSupport(portal: { id: string }, reason: string, by: By = null) {
  if (reason.trim().length < 8) throw new ActionRefused("Say why you are looking, in a sentence: the company sees it in their own log.");
  const [{ until }] = await asBy(by, (q) => q`select console_open_support(${portal.id}, ${reason.trim().slice(0, 500)}) as until`);
  return until as Date;
}
export const supportLog = (portalId: string) => asConsole((q) => q`select console_support_log(${portalId}) as l`).then((r: any[]) => r[0].l).catch(() => null);
export const company = (orgId: string) => asConsole((q) => q`select console_company(${orgId}) as c`).then((r: any[]) => r[0]?.c ?? null);
export const recentActions = (targetId: string) => asConsole((q) => q`select at, action, detail, by_email from console_actions where target_id = ${targetId} order by at desc limit 10`).catch(() => []);
