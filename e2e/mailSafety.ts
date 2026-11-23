// Browser tests act on a server that already exists, so no flag in this process can show that server is safe. Before anything is created or sent, the harness asks the server for its
// non-secret mail safety status and refuses to continue unless real sending is OFF or RESTRICTED to the owner's approved test recipients. The status carries no credential and no address.
export interface MailSafety { sending: "off" | "restricted" | "live"; transport: string }

export async function assertSafeToTest(base: string, fetchImpl: typeof fetch = fetch): Promise<MailSafety> {
  const refuse = (why: string): never => { throw new Error(`Refusing to run browser tests against ${base}: ${why}. Nothing was created or sent. Start a server with mail off or restricted (npm run mail:config -- status).`); };
  let res: Response;
  try { res = await fetchImpl(`${base}/api/health/mail`, { headers: { origin: base } }); } catch { return refuse("its mail safety status could not be read (is the server running?)"); }
  if (!res.ok) return refuse(`its mail safety status is not available (HTTP ${res.status}); an older server cannot be shown to be safe`);
  const body: any = await res.json().catch(() => null);
  if (!body || !["off", "restricted", "live"].includes(body.sending)) return refuse("its mail safety status is not understood");
  if (body.sending === "live") return refuse("real sending is LIVE (it could e-mail any address)");
  return { sending: body.sending, transport: String(body.transport ?? "") };
}
