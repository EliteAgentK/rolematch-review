// Who someone is goes through src/identity.ts only (docs/database/20_IDENTITY_V1.md), so replacing Supabase's sign-in is one setting and so is the way back.
// Nothing else may read the provider's sign-in tables or import its sign-in functions.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
const PROVIDER = new Set(["supabase.ts", "identity.ts"]);
const SIGN_IN = /\b(adminCreateUser|adminDeleteUser|createSignupCode|createFreshCode|verifySignupCode|createRecoveryCode|verifyRecoveryCode|setUserPassword|passwordLogin|refreshSession|sessionsOf|endSessions|verifyAccessToken|signOut|signOutOnly|passkey\w+)\b/;

test("only the identity module and the provider's own client read the provider's sign-in tables or import its sign-in functions", () => {
  const offenders: string[] = [];
  for (const f of files(SRC)) {
    const rel = relative(SRC, f); if (PROVIDER.has(rel)) continue;
    const text = readFileSync(f, "utf8");
    if (/\bauth\.(users|sessions|identities|refresh_tokens)\b/.test(text)) offenders.push(`${rel}: reads auth.*`);
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:\.\.?\/)+supabase["']/g)) if (SIGN_IN.test(m[1])) offenders.push(`${rel}: imports sign-in from supabase.ts`);
  }
  expect(offenders).toEqual([]);
});

test("our own sign-in refuses to start without its keys, and an unknown choice is refused, not silently replaced", async () => {
  process.env.IDENTITY = "own"; delete process.env.IDENTITY_SIGNING_KEY;
  const e = await import("../src/identity?own" as string).catch((x) => x);
  process.env.IDENTITY = "elsewhere";
  const f = await import("../src/identity?elsewhere" as string).catch((x) => x);
  delete process.env.IDENTITY;
  expect(String(e?.message ?? e)).toMatch(/IDENTITY=own needs IDENTITY_SIGNING_KEY and IDENTITY_CODE_KEY/);
  expect(String(f?.message ?? f)).toMatch(/"supabase" or "own"/);
});
