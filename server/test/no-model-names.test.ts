import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { withoutModelNames } from "../src/noModelNames";

// Owner, 11 Nov 2026: "people can't know that this is Claude, anywhere ... they shouldn't know the LLM we're using". Two guards: no text the website
// or the server can show names a model or the provider, and no reply carries a model's identifier. Code comments, the AI module itself, model settings
// and server logs may name it; nothing a person using RoleMatch can see may.
const NAMES = /claude|anthropic|haiku|sonnet|\bopus\b/i;
// Where naming the model is the point and nothing reaches a user: the AI module and its limits, and the server's own start-up log line.
const ALLOWED = [/server\/src\/ai\//, /^import |from "\.\/ai\/claude"|"\.\/ai\/claude"/, /RoleMatch server listening/];
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?|html)$/.test(f) && !/\.test\./.test(f) ? [p] : []; });

test("no text the website or the server can show names the AI model or its provider", () => {
  const root = join(__dirname, "..", ".."), found: string[] = [];
  for (const p of [...files(join(root, "src")), ...files(join(root, "server", "src")), join(root, "index.html")]) {
    if (ALLOWED[0].test(p.replace(/\\/g, "/"))) continue;
    const code = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
    for (const m of code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) {
      const line = code.slice(0, m.index).split("\n").length, whole = code.split("\n")[line - 1] ?? "";
      if (NAMES.test(m[0]) && !ALLOWED.slice(1).some((a) => a.test(whole) || a.test(m[0]))) found.push(`${p.slice(root.length + 1)}:${line}: ${m[0].slice(0, 80)}`);
    }
  }
  expect(found, "say \"the AI\" instead").toEqual([]);
});

test("a reply never carries a model's identifier or the provider's name, and a person called Claude is left alone", () => {
  const reply = JSON.parse(JSON.stringify({
    name: "Claude Dube", summary: "Worked with Claude Mokoena at Acme.",
    extraction: { method: "ai", model: "claude-haiku-5-5", readerVersion: "cv-ai-5+reader-0.8.0" },
    aiReading: { state: "read", model: "claude-haiku-5-5" }, result: { ai: { state: "checked", model: "claude-sonnet-5-5", provider: "anthropic" } },
    usage: [{ provider: "Anthropic", model: "Sonnet 5.5" }], note: "claude-opus-5-5",
  }, withoutModelNames));
  expect(JSON.stringify(reply)).not.toMatch(/haiku|sonnet|opus|anthropic|claude-/i);
  expect(reply.name).toBe("Claude Dube");
  expect(reply.summary).toBe("Worked with Claude Mokoena at Acme.");
  expect(reply.extraction).toEqual({ method: "ai", readerVersion: "cv-ai-5+reader-0.8.0" });
});
