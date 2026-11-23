// npm run mail:config -- <status | credentials | check | allow | mode | enable | disable>
// Edits the MAIL_* settings in server/.env (or the file named by ROLEMATCH_ENV_FILE) safely: see src/envFile.ts. It never prints, logs or accepts a password anywhere but a hidden prompt.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import nodemailer from "nodemailer";
import { EnvValueError, fileModeIsPrivate, updateEnvFile } from "../src/envFile";

const FILE = process.env.ROLEMATCH_ENV_FILE ?? fileURLToPath(new URL("../.env", import.meta.url));
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
const read = () => { try { return parseEnv(readFileSync(FILE, "utf8")); } catch { return {} as Record<string, string>; } };
const die = (m: string): never => { console.error(m); process.exit(1); };
const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

/** Reads a line from the terminal without showing it. Refuses when input is not a terminal (a password must never come from a pipe, an argument or the environment). */
function hidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) die("This needs an interactive terminal: the password is typed at a hidden prompt, never passed as an argument, through the environment or from a pipe.");
  return new Promise((res) => {
    process.stdout.write(prompt); let v = ""; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const on = (c: string) => {
      for (const ch of c) {
        if (ch === "\r" || ch === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", on); process.stdout.write("\n"); return res(v); }
        if (ch === "\u0003") { process.stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") v = v.slice(0, -1); else v += ch;
      }
    };
    process.stdin.on("data", on);
  });
}

const apply = (u: Record<string, string | null>) => { try { updateEnvFile(FILE, u); } catch (e) { die(e instanceof EnvValueError ? e.message : "The settings file could not be updated; nothing was changed."); } };
const show = () => {
  const e = read(); const sending = e.MAIL_TRANSPORT !== "smtp" && e.MAIL_TRANSPORT !== "preview" ? "off (no transport)" : (e.MAIL_SEND_MODE ?? "allowlist") === "off" ? "off" : e.MAIL_TRANSPORT === "preview" ? "preview (nothing is sent)" : (e.MAIL_SEND_MODE ?? "allowlist") === "live" ? "LIVE (any recipient)" : "restricted to the approved list";
  console.log([`settings file: ${FILE} (${fileModeIsPrivate(FILE) ? "private" : "NOT private: run chmod 600"})`, `sending: ${sending}`, `transport: ${e.MAIL_TRANSPORT || "none"}`, `host: ${e.MAIL_SMTP_HOST || "(not set)"}  port: ${e.MAIL_SMTP_PORT || "465"}  security: ${e.MAIL_SMTP_SECURITY || "implicit"}`,
    `login user: ${e.MAIL_SMTP_USER || "(not set)"}`, `password: ${e.MAIL_SMTP_PASS ? "set" : "not set"}`, `approved recipients: ${(e.MAIL_ALLOWED_RECIPIENTS ?? "").split(",").filter(Boolean).length}`, `hourly limit (provisional, not evidence of what the host permits): ${e.MAIL_MAX_PER_HOUR || "60"}`, `repeated MAIL_ settings: ${dupes() || "none"}`].join("\n"));
};
/** Names (never values) of MAIL_ settings that appear on more than one line. */
const dupes = () => { const n = new Map<string, number>(); try { for (const m of readFileSync(FILE, "utf8").matchAll(/^\s*(?:export\s+)?(MAIL_[A-Z_]+)\s*=/gm)) n.set(m[1], (n.get(m[1]) ?? 0) + 1); } catch { /* no file */ } return [...n].filter(([, c]) => c > 1).map(([k]) => k).join(", "); };

/** Connects, checks the certificate and the host name, logs in and says goodbye. No message is sent: nodemailer's verify() stops after AUTH (it never issues MAIL FROM, RCPT or DATA).
 * Bounded: each phase has its own timeout and the whole check is abandoned after 30 seconds. Only an error code is reported, never the server's text. */
async function check() {
  const e = read();
  if (!e.MAIL_SMTP_HOST || !e.MAIL_SMTP_USER || !e.MAIL_SMTP_PASS) die("Set the login first: run `credentials`.");
  const security = e.MAIL_SMTP_SECURITY || "implicit";
  if (security === "none") die("Certificate checking cannot be turned off for this check.");
  const t = nodemailer.createTransport({ host: e.MAIL_SMTP_HOST, port: Number(e.MAIL_SMTP_PORT || 465), secure: security === "implicit", requireTLS: security === "starttls",
    auth: { user: e.MAIL_SMTP_USER, pass: e.MAIL_SMTP_PASS }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: e.MAIL_SMTP_HOST },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
  const t0 = performance.now();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([t.verify(), new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error("timeout"), { code: "CHECK_TIMEOUT" })), 30_000); })]).finally(() => clearTimeout(timer));
    console.log(`Connected to ${e.MAIL_SMTP_HOST}:${e.MAIL_SMTP_PORT || 465} over TLS with the certificate and host name verified, and the login was accepted (${Math.round(performance.now() - t0)} ms).\nNo message was sent. This proves the login only; it says nothing about delivery or the host's sending permission.`);
  } catch (err: any) {
    // The error's own message is only matched against, never printed: it can carry server text.
    const code = String(err?.code ?? "ERROR"), smtp = typeof err?.responseCode === "number" ? ` (SMTP ${err.responseCode})` : "";
    const why = code === "EAUTH" ? "the mail server refused the login: the user name or password is wrong, or the mailbox does not allow SMTP login"
      : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME|ALTNAME|certificate|self[- ]signed|altnames/i.test(`${code} ${err?.reason ?? ""} ${err?.message ?? ""}`) ? "the certificate or host name did not verify, so nothing was sent and the password was not offered"
      : code === "CHECK_TIMEOUT" || code === "ETIMEDOUT" ? "no answer in time" : "the connection failed";
    die(`Check failed after ${Math.round(performance.now() - t0)} ms: ${why} [${code}${smtp}]. No message was sent.`);
  } finally { t.close(); }
}

switch (process.argv[2]) {
  case "status": show(); break;
  case "check": await check(); break;
  case "credentials": {
    const host = flag("host") ?? read().MAIL_SMTP_HOST ?? "mail.rolematch.co.za", user = flag("user") ?? read().MAIL_SMTP_USER ?? "info@rolematch.co.za", port = flag("port") ?? read().MAIL_SMTP_PORT ?? "465", security = flag("security") ?? read().MAIL_SMTP_SECURITY ?? "implicit";
    if (!["implicit", "starttls"].includes(security)) die("--security must be implicit or starttls (certificate checking is always on).");
    if (!/^\d{2,5}$/.test(port)) die("--port must be a number.");
    const pw = await hidden(`Mailbox password for ${user} (hidden): `); if (!pw) die("No password entered; nothing was changed.");
    const again = await hidden("Type it again (hidden): "); if (pw !== again) die("The two entries differ; nothing was changed.");
    apply({ MAIL_SMTP_HOST: host, MAIL_SMTP_PORT: port, MAIL_SMTP_SECURITY: security, MAIL_SMTP_USER: user, MAIL_SMTP_PASS: pw });
    console.log("Saved (the password is stored in the private settings file and was not displayed). Sending is still off. Next: `check` (logs in, sends nothing)."); break;
  }
  case "allow": {
    const raw = process.argv.slice(3).join(",").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!raw.length) die("Give one or more approved recipient addresses (separated by spaces or commas), or use `allow --clear`.");
    if (raw[0] === "--clear") { apply({ MAIL_ALLOWED_RECIPIENTS: "" }); console.log("The approved recipient list is now empty: nothing real can be sent."); break; }
    const bad = raw.filter((a) => !EMAIL.test(a)); if (bad.length) die(`Not valid addresses: ${bad.length} of ${raw.length}. Nothing was changed.`);
    apply({ MAIL_ALLOWED_RECIPIENTS: [...new Set(raw)].join(",") }); console.log(`Approved recipients set (${new Set(raw).size}). Real mail can go only to these, for every kind of message.`); break;
  }
  case "mode": {
    const m = process.argv[3]; if (!["off", "allowlist", "live"].includes(m)) die("mode must be off, allowlist or live.");
    if (m === "live" && process.argv[4] !== "--i-understand-this-can-email-anyone") die("live lets this server e-mail any address. Add --i-understand-this-can-email-anyone only when that has been approved.");
    apply({ MAIL_SEND_MODE: m }); console.log(`Sending mode: ${m}.`); break;
  }
  case "enable": {
    const e = read(); if (!e.MAIL_SMTP_PASS || !e.MAIL_SMTP_HOST || !e.MAIL_SMTP_USER) die("Set the login first: run `credentials`.");
    if ((e.MAIL_SEND_MODE ?? "allowlist") === "allowlist" && !(e.MAIL_ALLOWED_RECIPIENTS ?? "").trim()) die("Add the approved recipients first: run `allow`. With an empty list nothing could be sent.");
    apply({ MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: e.MAIL_SEND_MODE ?? "allowlist" }); console.log("Enabled. Restart the server for it to take effect."); break;
  }
  case "disable": apply({ MAIL_TRANSPORT: "", MAIL_SEND_MODE: "off" }); console.log("Disabled: nothing can be sent. Restart the server."); break;
  default: die("Usage: npm run mail:config -- status | credentials | check | allow <addresses> | mode off|allowlist|live | enable | disable");
}
