// Is each connection encrypted, and does it check who it is talking to? Encryption without checking the server is incomplete. Reads the settings file it is given, and prints names of hosts and yes or no: no secret.
//   node --import tsx scripts/verifyTls.ts <settings file>
import { readFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect, rootCertificates } from "node:tls";
import postgres from "postgres";
import { dbTls } from "../src/dbTls";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const url = new URL(env.DATABASE_URL), host = url.hostname, port = Number(url.port || 5432), options: any = dbTls(env.DATABASE_URL).ssl;
const hsl = (servername: string, ca: unknown) => new Promise<{ ok: boolean; why: string; subject?: string }>((res) => {
  const s = netConnect(port, host, () => { const b = Buffer.alloc(8); b.writeInt32BE(8, 0); b.writeInt32BE(80877103, 4); s.write(b); });
  s.once("data", (d) => { if (d.toString() !== "S") { s.destroy(); return res({ ok: false, why: "the server refused encryption" }); } const t = tlsConnect({ socket: s, servername, ca: ca as any, rejectUnauthorized: true, minVersion: "TLSv1.2" }, () => { const c = t.getPeerCertificate(); res({ ok: t.authorized, why: `verified ${t.getProtocol()}`, subject: String(c.subject?.CN ?? "") }); t.destroy(); }); t.on("error", (e: any) => { res({ ok: false, why: e.code ?? e.message }); s.destroy(); }); });
  s.on("error", (e) => res({ ok: false, why: e.message })); setTimeout(() => res({ ok: false, why: "timed out" }), 15000).unref();
});
const rows: [string, string, string][] = [];
const good = await hsl(host, options.ca);
rows.push(["database: chain and host name, with our pinned authority", good.ok ? "VERIFIED" : "FAILED", good.why + (good.subject ? `, certificate names ${good.subject}` : "")]);
const wrongName = await hsl("not-the-real-host.example.com", options.ca);
rows.push(["database: a wrong host name is refused", wrongName.ok ? "NOT REFUSED" : "REFUSED", wrongName.why]);
const wrongCa = await hsl(host, rootCertificates.slice(0, 5));
rows.push(["database: certificates not from our authority are refused", wrongCa.ok ? "NOT REFUSED" : "REFUSED", wrongCa.why]);
const sql = postgres(env.DATABASE_URL, { max: 1, ...dbTls(env.DATABASE_URL), prepare: false, connect_timeout: 15 });
const [mine] = await sql`select ssl, version from pg_stat_ssl where pid = pg_backend_pid()`.catch(() => [{ ssl: "unreadable" }] as any);
await sql.end();
rows.push(["database: the application's own connection path", mine?.ssl === true ? "ENCRYPTED" : String(mine?.ssl), `${mine?.version ?? ""}, using the same settings as the service (src/dbTls.ts)`]);
const https = await fetch(env.SUPABASE_URL + "/auth/v1/health", { signal: AbortSignal.timeout(15000) }).then((r) => `answered ${r.status}`).catch((e) => `failed ${e?.cause?.code ?? e.message}`);
rows.push(["sign-in and file store: HTTPS, Node's default checks", env.SUPABASE_URL.startsWith("https://") && https.startsWith("answered") ? "VERIFIED" : "FAILED", https]);
rows.push(["mail", env.MAIL_SMTP_SECURITY ?? "not set", `to ${env.MAIL_SMTP_HOST ?? "nowhere"}`]);
for (const r of rows) console.log(`${r[1].padEnd(12)} ${r[0]}: ${r[2]}`);
process.exit(rows.some((r) => ["FAILED", "NOT REFUSED"].includes(r[1])) ? 1 : 0);
