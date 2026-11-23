import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const walk = (dir: string, out: string[] = []) => {
  for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
};
const TEXT = /\.(js|jsx|ts|tsx|css|html|json|svg|map|txt)$/;
const SHAPES: [string, RegExp][] = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{10,}/], ["OpenAI-style key", /sk-[A-Za-z0-9]{32,}/], ["Resend key", /re_[A-Za-z0-9]{20,}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]+/], ["AWS key", /AKIA[0-9A-Z]{16}/], ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["database URL with password", /postgres(ql)?:\/\/[^:\s/]+:[^@\s]+@/],
  ["service-role JWT", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
];
const SERVER_ONLY = ["ANTHROPIC_API_KEY", "MAIL_SMTP_PASS", "SUPABASE_SERVICE", "DATABASE_URL", "SESSION_SECRET", "COOKIE_SECRET"];

describe("nothing secret reaches the browser", () => {
  const dist = join(ROOT, "dist");
  const built = (() => { try { return walk(dist).filter((f) => TEXT.test(f)); } catch { return []; } })();
  test("the built app exists to scan", () => { expect(built.length, "run `npm run build` first").toBeGreaterThan(0); });
  test("no key, token or connection string appears in the built files", () => {
    for (const f of built) { const s = readFileSync(f, "utf8"); for (const [name, re] of SHAPES) expect(re.test(s), `${name} in ${f}`).toBe(false); }
  });
  test("no server-only setting name appears in the built files", () => {
    for (const f of built) { const s = readFileSync(f, "utf8"); for (const n of SERVER_ONLY) expect(s.includes(n), `${n} in ${f}`).toBe(false); }
  });
  test("the frontend source reads no environment variables and has no source maps published", () => {
    for (const f of walk(join(ROOT, "src")).filter((f) => /\.(jsx?|tsx?)$/.test(f))) expect(/process\.env|import\.meta\.env/.test(readFileSync(f, "utf8")), f).toBe(false);
    expect(built.some((f) => f.endsWith(".map"))).toBe(false);
  });
  test("the frontend calls no third-party hosts for data (only its own /api)", () => {
    for (const f of built.filter((f) => /\.(js|html)$/.test(f))) {
      const hosts = [...readFileSync(f, "utf8").matchAll(/(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)[^;]{0,80}https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
      expect(hosts, f).toEqual([]);
    }
  });
});

describe("secrets are kept out of the repository", () => {
  test(".env files are ignored by git and only the example is tracked", () => {
    const ig = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(ig).toMatch(/^\.env$/m); expect(ig).toMatch(/^server\/\.env$/m);
  });
  test("the tracked example holds no real values", () => {
    const ex = readFileSync(join(ROOT, "server/.env.example"), "utf8");
    for (const [name, re] of SHAPES) expect(re.test(ex), name).toBe(false);
  });
});
