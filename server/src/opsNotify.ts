// Messages to the owner about the service itself (the monitor's alerts, the daily check), through RoleMatch's own mail host: never a third-party push service
// (owner, 2026-11-05). Sent through the transport directly, not the outbox, because they matter most when the database is what is down. Only to OPS_ALERT_TO,
// and only if the sending rules allow that address. Counts and states only: never a document, a person or a token.
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { recipientAllowed } from "./mail";
import { isMailbox, transport } from "./mail/transport";

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export async function notifyOwner(subject: string, text: string, from = "the RoleMatch monitor on the PC"): Promise<"sent" | "not sent"> {
  const to = (process.env.OPS_ALERT_TO ?? "").trim(), t = transport("notification");
  if (!t || !isMailbox(to) || !recipientAllowed(to)) { console.log(JSON.stringify({ event: "notify.not_sent", reason: !t ? "no mail transport" : "recipient not configured or not allowed", subject })); return "not sent"; }
  const stamp = `Checked ${new Date().toISOString()} by ${from}.`;
  await t.send({ to, from: config.mail.from, subject, text: `${text}\n\n${stamp}`, html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${escape(text)}</pre><p style="color:#666">${escape(stamp)}</p>`, messageId: `<${randomUUID()}@rolematch.ops>` });
  console.log(JSON.stringify({ event: "notify.sent", subject }));
  return "sent";
}
