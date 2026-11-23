// Safe edits to server/.env. The file is read by Node's own parser (util.parseEnv, see config.ts), so every value written here is serialised for THAT parser and then checked by
// parsing it back: a value that would not read back exactly is refused, never written. Unrelated lines are kept byte for byte, a managed key never appears twice, and the file is
// replaced atomically while private (mode 0600, also while it is a temporary file). Nothing in this module prints or logs a value.
import { chmodSync, closeSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

export class EnvValueError extends Error {}
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The text to put after KEY= for this value, proven by parsing it back with the real parser. Throws EnvValueError (never including the value). */
export function serializeValue(value: string): string {
  if (CONTROL.test(value)) throw new EnvValueError("The value contains a control character (a line break, tab or similar), which this file format cannot store safely. Use a value without one.");
  for (const q of ["'", "`", '"']) {   // single quotes first: no escape processing at all; double quotes last: the parser expands a backslash-n sequence there
    if (value.includes(q)) continue;
    const text = `${q}${value}${q}`;
    if (parseEnv(`K=${text}\n`).K === value) return text;
  }
  throw new EnvValueError("The value cannot be stored in this file format: it contains single, double and backtick quote characters together, or another sequence the file parser changes. Choose a value that avoids one kind of quote.");
}

interface Entry { key: string | null; lines: string[] }
/** Splits the file into entries, keeping each KEY=value (including a quoted value that runs over several lines) together so a continuation line is never mistaken for a setting. */
function entries(text: string): Entry[] {
  const lines = text.split("\n"), out: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/s);
    if (!m) { out.push({ key: null, lines: [lines[i]] }); continue; }
    const rest = m[2].trimStart(), q = rest[0], span = [lines[i]];
    if ((q === "'" || q === '"' || q === "`") && !rest.slice(1).includes(q)) { let j = i + 1; while (j < lines.length) { span.push(lines[j]); if (lines[j].includes(q)) break; j++; } i = j; }   // a quoted value running over several lines
    out.push({ key: m[1], lines: span });
  }
  return out;
}

/** Returns the new file text: each key in `updates` set to its value (a string) or removed (null), in place if present, appended if not, duplicates removed. */
export function updateEnvText(text: string, updates: Record<string, string | null>): string {
  const serial = Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v === null ? null : serializeValue(v)]));
  const done = new Set<string>(), out: string[] = [];
  const parts = entries(text);
  if (parts.length && parts[parts.length - 1].lines.length === 1 && parts[parts.length - 1].lines[0] === "") parts.pop();   // the final newline
  for (const e of parts) {
    if (e.key && e.key in serial) {
      if (e.lines.length > 1) throw new EnvValueError(`${e.key} has a value that spans several lines; edit that line by hand.`);
      if (!done.has(e.key) && serial[e.key] !== null) out.push(`${e.key}=${serial[e.key]}`);
      done.add(e.key); continue;                     // a second occurrence of a managed key is dropped
    }
    out.push(...e.lines);
  }
  for (const [k, v] of Object.entries(serial)) if (!done.has(k) && v !== null) out.push(`${k}=${v}`);
  return out.join("\n") + "\n";
}

/** Applies the updates to the file at `path` atomically and privately, verifying with the real parser that every value reads back exactly and nothing else changed. */
export function updateEnvFile(path: string, updates: Record<string, string | null>) {
  let before = ""; try { before = readFileSync(path, "utf8"); } catch (e: any) { if (e?.code !== "ENOENT") throw e; }
  const next = updateEnvText(before, updates);
  const old = parseEnv(before), now = parseEnv(next);
  for (const [k, v] of Object.entries(updates)) if ((v === null ? undefined : v) !== now[k]) throw new EnvValueError(`${k} did not read back exactly; nothing was written.`);
  for (const k of Object.keys(old)) if (!(k in updates) && old[k] !== now[k]) throw new EnvValueError("An unrelated setting would have changed; nothing was written.");
  const tmp = join(dirname(path), `.env.tmp-${randomBytes(6).toString("hex")}`);
  const fd = openSync(tmp, "wx", 0o600);   // exclusive: never reuses an existing file
  try { try { chmodSync(tmp, 0o600); writeSync(fd, next); fsyncSync(fd); } finally { closeSync(fd); } renameSync(tmp, path); chmodSync(path, 0o600); }
  catch (e) { try { unlinkSync(tmp); } catch { /* already gone */ } throw e; }
}

export const fileModeIsPrivate = (path: string) => (statSync(path).mode & 0o077) === 0;
