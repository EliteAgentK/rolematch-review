// Standing routine: a known high or critical vulnerability in any package of the website or the backend fails the tests. The check asks the
// npm registry; when the registry cannot be reached the test is skipped and says so, rather than passing silently.
import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { audit } from "../scripts/depsReport";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const online = (() => { try { execFileSync("npm", ["ping"], { stdio: "ignore", timeout: 15000 }); return true; } catch { return false; } })();

test.skipIf(!online)("no known high or critical vulnerability in the website or the backend packages", () => {
  for (const dir of [ROOT, fileURLToPath(new URL("..", import.meta.url))]) {
    const a = audit(dir);
    expect(a.incomplete, `${dir}: the audit did not complete, so it says nothing about vulnerabilities (R40)`).toBeUndefined();
    expect(a.high + a.critical, `${dir}: ${a.lines.join("; ")}`).toBe(0);
  }
}, 120_000);
