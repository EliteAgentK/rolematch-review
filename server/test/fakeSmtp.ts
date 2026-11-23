// A small SMTP server for tests (a simulation of a mail host). It speaks just enough SMTP for the real transport (nodemailer) to connect, send and be refused in the ways a
// real host does. It proves OUR side: connection, classification of 4xx/5xx/dropped replies, headers, MIME, one-message-per-recipient. It says nothing about a real host.
import { createServer, type Server, type Socket } from "node:net";

export type SmtpMode = "ok" | "temp" | "perm" | "authfail" | "dropAfterData" | "hang";
export interface Captured { from: string; to: string[]; raw: string; headers: Record<string, string>; text: string; html: string; inlineCids: string[]; at: number }

const qp = (s: string) => Buffer.from(s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
function parse(raw: string): Pick<Captured, "headers" | "text" | "html" | "inlineCids"> {
  const out = { headers: {} as Record<string, string>, text: "", html: "", inlineCids: [] as string[] };
  const walk = (chunk: string, top: boolean) => {
    const i = chunk.indexOf("\r\n\r\n"); const head = chunk.slice(0, i).replace(/\r\n[ \t]+/g, " "), body = chunk.slice(i + 4);
    const h: Record<string, string> = {}; for (const l of head.split("\r\n")) { const k = l.indexOf(":"); if (k > 0) h[l.slice(0, k).toLowerCase()] = l.slice(k + 1).trim(); }
    if (top) out.headers = h;
    const ct = h["content-type"] ?? "text/plain", b = ct.match(/boundary="?([^";]+)"?/i)?.[1];
    if (b) { for (const part of body.split(`--${b}`).slice(1)) if (!part.startsWith("--")) walk(part.replace(/^\r\n/, ""), false); return; }
    const enc = (h["content-transfer-encoding"] ?? "7bit").toLowerCase();
    const dec = enc === "base64" ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8") : enc === "quoted-printable" ? qp(body) : body;
    if (/text\/html/i.test(ct)) out.html = dec; else if (/text\/plain/i.test(ct)) out.text = dec;
    const cid = h["content-id"]?.replace(/[<>]/g, ""); if (cid) out.inlineCids.push(cid);
  };
  walk(raw, true); return out;
}

export class FakeSmtp {
  mode: SmtpMode = "ok"; messages: Captured[] = []; connections = 0; refusedRecipients = 0; delayMs = 0; concurrent = 0; maxConcurrent = 0;
  private srv: Server; private sockets = new Set<Socket>();
  constructor(public port: number) {
    this.srv = createServer((s) => { this.connections++; this.concurrent++; this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent); this.sockets.add(s); s.on("close", () => { this.sockets.delete(s); this.concurrent--; }); s.on("error", () => {}); this.session(s); });
  }
  start() { return new Promise<void>((r) => this.srv.listen(this.port, "127.0.0.1", () => r())); }
  stop() { for (const s of this.sockets) s.destroy(); return new Promise<void>((r) => this.srv.close(() => r())); }
  private session(s: Socket) {
    const w = (l: string) => s.write(l + "\r\n"); let buf = "", inData = false, from = "", to: string[] = [], data = "";
    w("220 fake.mail.test ESMTP");
    s.on("data", (c) => {
      buf += c.toString("latin1");
      for (;;) {
        if (inData) {
          data += buf; buf = "";
          const end = data.indexOf("\r\n.\r\n"); if (end < 0) break;
          const body = data.slice(0, end); buf = data.slice(end + 5); data = ""; inData = false;
          const raw = body.replace(/\r\n\.\./g, "\r\n.");
          this.messages.push({ from, to, raw, at: Date.now(), ...parse(raw) });
          if (this.mode === "hang") return;   // received, never answered, connection left open: the sender is stuck mid-send
          if (this.mode === "dropAfterData") { s.destroy(); return; }   // the message arrived but the answer never does: the sender cannot know
          if (this.delayMs) { const n = this.messages.length; setTimeout(() => w("250 2.0.0 OK queued as FAKE" + n), this.delayMs); continue; }   // a slow mail host
          w("250 2.0.0 OK queued as FAKE" + this.messages.length); continue;
        }
        const nl = buf.indexOf("\r\n"); if (nl < 0) break; const line = buf.slice(0, nl); buf = buf.slice(nl + 2); const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") { s.write("250-fake.mail.test\r\n250-SIZE 52428800\r\n250-8BITMIME\r\n250 AUTH PLAIN LOGIN\r\n"); }
        else if (cmd === "AUTH") w(this.mode === "authfail" ? "535 5.7.8 Authentication failed" : "235 2.7.0 Accepted");
        else if (cmd === "MAIL") { from = line.match(/<([^>]*)>/)?.[1] ?? ""; to = []; w("250 2.1.0 OK"); }
        else if (cmd === "RCPT") { if (this.mode === "perm") { this.refusedRecipients++; w("550 5.1.1 <" + (line.match(/<([^>]*)>/)?.[1] ?? "") + "> User unknown"); } else if (this.mode === "temp") { this.refusedRecipients++; w("451 4.3.0 Try again later"); } else { to.push(line.match(/<([^>]*)>/)?.[1] ?? ""); w("250 2.1.5 OK"); } }
        else if (cmd === "DATA") { if (!to.length) w("503 5.5.1 no valid recipients"); else { inData = true; w("354 go ahead"); } }
        else if (cmd === "RSET") w("250 OK"); else if (cmd === "NOOP") w("250 OK"); else if (cmd === "QUIT") { w("221 bye"); s.end(); return; } else w("502 5.5.2 not implemented");
      }
    });
  }
}
