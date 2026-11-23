// Sets a console account's e-mail and password (docs/database/18_CONSOLE_V0.md). Run by the owner at the PC's terminal, never by Claude:
//   deploy/pc/console-password.sh                    add an account, or set an existing account's password again
//   deploy/pc/console-password.sh --remove <e-mail>  remove an account
// (runs this inside rm-console: docker exec -it rm-console node src/scripts/consolePassword.js). The console has at most two accounts (owner, 12 Nov
// 2026: "It should always just be me and my dad"; migration 052). The password is typed twice and never shown, so it is never in a file, a command line,
// a log or the shell's history. Setting it signs out that account's sessions, clears its sign-in lock, and tells the owner by e-mail and in the console.
import { owners, removeOwner, setOwner, passwordProblem } from "../console/auth";
import { raise } from "../console/store";
import { sql } from "../db";
import { notifyOwner } from "../opsNotify";

function ask(prompt: string, show: boolean): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) throw new Error("Run this at a terminal (docker exec -it), so the password is never read from a file or a pipe.");
  process.stdout.write(prompt);
  input.setRawMode(true); input.resume();
  let text = "";
  return new Promise((done) => {
    const onData = (b: Buffer) => {
      for (const ch of b.toString("utf8")) {
        if (ch === "\r" || ch === "\n") { input.setRawMode(false); input.pause(); input.off("data", onData); process.stdout.write("\n"); return done(text); }
        if (ch === "\u0003") { process.stdout.write("\nStopped; nothing changed.\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") { if (text) { text = text.slice(0, -1); if (show) process.stdout.write("\b \b"); } continue; }
        if (ch >= " ") { text += ch; if (show) process.stdout.write(ch); }
      }
    };
    input.on("data", onData);
  });
}

try {
  const now = await owners();
  console.log(`RoleMatch Console accounts (two at most): ${now.length ? now.map((o) => o.email).join(", ") : "none yet"}.\n`);
  const remove = process.argv.indexOf("--remove");
  if (remove >= 0) {
    const who = String(process.argv[remove + 1] ?? "").trim().toLowerCase();
    if (!who) throw new Error("Say which account: --remove <e-mail>. Nothing changed.");
    if (!(await removeOwner(who))) throw new Error(`${who} is not a console account. Nothing changed.`);
    await raise({ fingerprint: `console:account-removed:${Date.now()}`, severity: "info", source: "console", title: "A console account was removed at the PC's terminal", meaning: `${who} can no longer sign in to the console; its sessions were ended.`, action: "If this was not you, set a new password at once." }).catch(() => {});
    await notifyOwner("RoleMatch: a console account was removed", `The console account ${who} was removed at the PC's terminal and its sessions ended. If this was not you, act at once.`, "the RoleMatch console").catch(() => {});
    console.log(`Removed ${who}.`);
    process.exit(0);
  }
  console.log("Type an account's e-mail to set its password again, or a new e-mail to add it (only if there is room).\nSetting a password signs out that account's sessions.\n");
  const email = (await ask("E-mail: ", true)).trim().toLowerCase();
  if (!now.some((o) => o.email === email) && now.length >= 2) throw new Error(`The console already has its two accounts (${now.map((o) => o.email).join(" and ")}). Remove one first with --remove <e-mail>. Nothing changed.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That is not an e-mail address; nothing changed.");
  let password = "";
  for (;;) {
    password = await ask("Password (at least 12 characters, not shown): ", false);
    const problem = passwordProblem(password, email);
    if (problem) { console.log(`It must be ${problem}. Try again.`); continue; }
    if ((await ask("Type it again: ", false)) === password) break;
    console.log("The two did not match. Try again.");
  }
  const added = await setOwner(email, password, "pc terminal");
  password = "";
  const what = added ? `The console account ${email} was added` : `The console password of ${email} was set again`;
  await raise({ fingerprint: `console:password-set:${Date.now()}`, severity: "info", source: "console", title: `${what} at the PC's terminal`, meaning: "That account's console sessions were signed out.", action: "If this was not you, set it again at once." }).catch(() => {});
  await notifyOwner(`RoleMatch: ${what}`, `${what} at the PC's terminal, and that account's console sessions were signed out. If this was not you, set it again at once.`, "the RoleMatch console").catch(() => {});
  console.log(`\nDone. ${added ? "Added" : "Set"}: sign in at the console with ${email} and this password. A sign-in code will be e-mailed to ${email}.`);
} catch (e: any) {
  console.error(`\n${e?.message ?? e}`); process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
