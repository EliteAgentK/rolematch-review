// The same person must not become two records that quietly split their history, notes and matches. An identical FILE is already caught by its checksum;
// this catches the same PERSON in a different file (a re-saved PDF, a newer version, a Word and a PDF copy). It only ever WARNS: a person decides whether two
// records are one, because two people can share a name and a household phone.
import { sql } from "./db";

export interface Identity { name?: string; email?: string; phone?: string }
export interface IdentityKeys { email: string; phone: string; name: string }
export interface Duplicate { id: string; name: string; uploaded: string; strength: "strong" | "possible"; reasons: string[] }

/** Normalised so that formatting never hides a match: case, spacing, diacritics, word order and phone punctuation are ignored. */
export function identityKeys(i: Identity): IdentityKeys {
  const digits = String(i.phone ?? "").replace(/\D/g, "");
  const name = String(i.name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z]+/g) ?? [];
  return {
    email: String(i.email ?? "").trim().toLowerCase(),
    phone: digits.length >= 9 ? digits.slice(-9) : "",   // the last nine digits survive "+27", "0027" and a leading zero
    name: name.length >= 2 ? [...name].sort().join(" ") : "",
  };
}

/** Why two records may be the same person. An address or a number is strong evidence; a name alone is only possible. */
export function compareIdentities(a: IdentityKeys, b: IdentityKeys): { strength: "strong" | "possible"; reasons: string[] } | null {
  const reasons: string[] = [];
  if (a.email && a.email === b.email) reasons.push("the same email address");
  if (a.phone && a.phone === b.phone) reasons.push("the same phone number");
  if (reasons.length) return { strength: "strong", reasons };
  if (a.name && a.name === b.name) return { strength: "possible", reasons: ["the same name"] };
  return null;
}

const NON_DIGITS = "\\D", LIKE_ESCAPE = "\\";   // passed as parameters so no backslash ever sits inside the SQL text

/** Existing candidates in this organisation that may be the same person as `rec`. */
export async function findDuplicates(orgId: string, rec: Identity): Promise<Duplicate[]> {
  const mine = identityKeys(rec);
  const token = (mine.name.split(" ").sort((x, y) => y.length - x.length)[0] ?? "").slice(0, 40);
  if (!mine.email && !mine.phone && !token) return [];
  const rows = await sql`select id, data->>'name' as name, data->>'email' as email, data->>'phone' as phone, created_at from candidates
    where org_id = ${orgId} and (${mine.email ? sql`lower(data->>'email') = ${mine.email}` : sql`false`} or ${mine.phone ? sql`right(regexp_replace(coalesce(data->>'phone', ''), ${NON_DIGITS}, '', 'g'), 9) = ${mine.phone}` : sql`false`}
      or ${token ? sql`search like ${"%" + token.replace(/[\\%_]/g, "\\$&") + "%"} escape ${LIKE_ESCAPE}` : sql`false`})
    order by created_at desc limit 50`;
  const out: Duplicate[] = [];
  for (const r of rows as any[]) {
    const hit = compareIdentities(mine, identityKeys({ name: r.name, email: r.email, phone: r.phone }));
    if (hit) out.push({ id: r.id, name: r.name, uploaded: new Date(r.created_at).toISOString().slice(0, 10), ...hit });
  }
  return out.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1)).slice(0, 5);
}

/** The plain sentence a reviewer sees. */
export function duplicateNotice(d: Duplicate[]): string | null {
  if (!d.length) return null;
  const first = d[0];
  const more = d.length > 1 ? ` (and ${d.length - 1} more)` : "";
  return `This ${first.strength === "strong" ? "looks like" : "may be"} a candidate already in your list: ${first.name}, added ${first.uploaded}, with ${first.reasons.join(" and ")}${more}. Check whether they are the same person before relying on either record; nothing was merged.`;
}
