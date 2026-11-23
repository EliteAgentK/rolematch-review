// The only place that knows how a message leaves RoleMatch. Everything else talks to MailTransport, so changing the SMTP host, using a dedicated mailbox or an
// owned relay later is configuration, not code. SMTP itself is nodemailer (MIT-0, maintained); nothing here implements the protocol or TLS.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { config } from "../config";

export interface MailMessage {
  to: string; from: string; replyTo?: string; envelopeFrom?: string; subject: string; html: string; text: string; messageId: string;
  inline?: { cid: string; filename: string; content: Buffer; contentType: string }[];
}
export interface SendResult { response: string; messageId: string; simulated: boolean }
/** temporary: try again later. permanent: this recipient/message was refused. unavailable: our configuration or the host is not usable (not the recipient's fault).
 * uncertain: the connection failed after the message was handed over, so it may or may not have been accepted. */
export type MailFailureKind = "temporary" | "permanent" | "unavailable" | "uncertain";
export class MailError extends Error { constructor(message: string, public kind: MailFailureKind, public smtpCode?: number, public enhanced?: string, public policy = false) { super(message); } }   // policy = refused by our own sending rules, not by the host
export interface MailTransport { readonly name: "smtp" | "preview"; readonly simulated: boolean; ready(): { ok: boolean; reason?: string }; send(m: MailMessage): Promise<SendResult>; close(): void }

const NO_CRLF = /[\r\n\u0000]/;
/** Header values come from names people typed. Anything that could start a new header line is refused, not cleaned: a subject is never silently altered. */
function assertHeaderSafe(...values: (string | undefined)[]) { for (const v of values) if (v && NO_CRLF.test(v)) throw new MailError("A header value contained a line break.", "permanent"); }
const ADDRESS = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
export const isMailbox = (a: string) => a.length <= 254 && ADDRESS.test(a);

export class SmtpTransport implements MailTransport {
  readonly name = "smtp" as const; readonly simulated = false;
  private t: ReturnType<typeof nodemailer.createTransport>;
  constructor(o: { maxConnections?: number; socketTimeout?: number; connectionTimeout?: number } = {}) { this.t = this.make(o); }
  private make(o: { maxConnections?: number; socketTimeout?: number; connectionTimeout?: number }) { return nodemailer.createTransport({
    host: config.mail.smtpHost, port: config.mail.smtpPort, secure: config.mail.smtpSecurity === "implicit", requireTLS: config.mail.smtpSecurity === "starttls", ignoreTLS: config.mail.smtpSecurity === "none",
    auth: config.mail.smtpUser ? { user: config.mail.smtpUser, pass: config.mail.smtpPass } : undefined,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },                          // certificate checking stays on
    pool: true, maxConnections: o.maxConnections ?? 1, maxMessages: 100, connectionTimeout: o.connectionTimeout ?? 10_000, greetingTimeout: o.connectionTimeout ?? 10_000, socketTimeout: o.socketTimeout ?? 30_000,
    disableFileAccess: true, disableUrlAccess: true,                                 // a message can never pull in a local file or URL
  }); }
  ready() { return config.mail.smtpHost && (config.mail.smtpSecurity === "none" || (config.mail.smtpUser && config.mail.smtpPass)) ? { ok: true } : { ok: false, reason: "The SMTP host and login are not configured." }; }
  async send(m: MailMessage): Promise<SendResult> {
    assertHeaderSafe(m.to, m.from, m.replyTo, m.subject, m.messageId, m.envelopeFrom);
    if (!isMailbox(m.to)) throw new MailError("The recipient address is not valid.", "permanent");
    try {
      const info = await this.t.sendMail({
        from: m.from, to: m.to, replyTo: m.replyTo || undefined, subject: m.subject, html: m.html, text: m.text, messageId: m.messageId,
        envelope: { from: m.envelopeFrom || extract(m.from), to: [m.to] },
        attachments: (m.inline ?? []).map((a) => ({ filename: a.filename, content: a.content, cid: a.cid, contentType: a.contentType, contentDisposition: "inline" as const })),
        headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
      });
      if (!info.accepted?.length) throw new MailError("The mail server accepted no recipient.", "permanent");
      return { response: String(info.response ?? "").replace(/<[^>]*>/g, "<…>").slice(0, 200), messageId: m.messageId, simulated: false };
    } catch (e: any) { throw e instanceof MailError ? e : classify(e); }
  }
  close() { this.t.close(); }
}

const extract = (from: string) => from.match(/<([^>]+)>/)?.[1] ?? from;
/** Sorts a nodemailer error into what the queue should do. A failure after the DATA command started with no answer is uncertain: the message may have been accepted. */
export function classify(e: any): MailError {
  const code: number | undefined = typeof e?.responseCode === "number" ? e.responseCode : undefined;
  const enhanced = String(e?.response ?? "").match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1];
  const text = (code ? `SMTP ${code}${enhanced ? " " + enhanced : ""}` : String(e?.code ?? e?.name ?? "error")).slice(0, 80);   // never the server's text: it can echo the address
  if (e?.code === "EAUTH") return new MailError("The mail server refused our login.", "unavailable", code);
  if (code && code >= 500) return new MailError(text, "permanent", code, enhanced);
  if (code && code >= 400) return new MailError(text, "temporary", code, enhanced);
  const msg = String(e?.message ?? "");
  // Never connected (refused, no route, no DNS, no greeting): nothing was handed over, so this is an ordinary temporary failure.
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EDNS"].includes(e?.code) || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|getaddrinfo|greeting never received|connection timeout/i.test(msg)) return new MailError(text, "temporary");
  // The session broke after it began: SMTP gives no way to know whether the server had already accepted the message, so it is reported as uncertain (retried; the duplicate risk is documented).
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET"].includes(e?.code)) return new MailError(text, "uncertain");
  return new MailError(text, "temporary");
}

/** Development preview: writes the message to a file and sends nothing. Callers must never present this as sending. */
class PreviewTransport implements MailTransport {
  readonly name = "preview" as const; readonly simulated = true;
  ready() { return { ok: true }; }
  async send(m: MailMessage): Promise<SendResult> {
    assertHeaderSafe(m.to, m.subject, m.messageId);
    const dir = join(config.dataDir, "emails"); mkdirSync(dir, { recursive: true });
    const logo = m.inline?.[0];
    writeFileSync(join(dir, `preview-${Date.now()}-${m.messageId.slice(1, 9)}.html`), logo ? m.html.replace(`cid:${logo.cid}`, `data:${logo.contentType};base64,${logo.content.toString("base64")}`) : m.html);
    return { response: "preview file written; nothing was sent", messageId: m.messageId, simulated: true };
  }
  close() {}
}

const pools: { authentication?: MailTransport | null; invitation?: MailTransport | null } = {};
/** One transport per class. Authentication gets its own connections and a short timeout (a person is waiting); everything else (invitations, notifications) shares one slow
 * connection, so the total held at the host stays authConcurrency + bulkConcurrency however many kinds of message exist. */
export function transport(kind: "authentication" | "invitation" | "notification" = "authentication"): MailTransport | null {
  const cls = kind === "authentication" ? "authentication" : "invitation";
  if (pools[cls] !== undefined) return pools[cls]!;
  pools[cls] = config.mail.transport === "smtp" ? new SmtpTransport(cls === "authentication" ? { maxConnections: config.mail.authConcurrency, socketTimeout: 12_000, connectionTimeout: 8_000 } : { maxConnections: config.mail.bulkConcurrency })
    : config.mail.transport === "preview" ? new PreviewTransport() : null;
  return pools[cls]!;
}
