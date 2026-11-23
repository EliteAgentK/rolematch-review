// Before anything is created: is this the server, and the release, these checks are for? An address proves nothing (register R94), and a check on the wrong server can pass as easily as fail.
// The service token shows the server is ours, and the commit it reports must be the one under test. Unrestricted mail stops the run unless the run says that is intended.
export default async function guard() {
  const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required: the checks will not run against an unidentified server.`); return v; };
  const base = need("E2E_BASE").replace(/\/$/, ""), expected = need("E2E_EXPECT_COMMIT");
  const res = await fetch(`${base}/api/ops/health`, { headers: { authorization: `Bearer ${need("E2E_OPS_TOKEN")}` } });
  if (!res.ok) throw new Error(`${base} did not accept the service token (HTTP ${res.status}): this is not the server under test.`);
  const running = ((await res.json()) as any).release?.commit;
  if (running !== expected) throw new Error(`${base} is running ${running}, not ${expected}.`);
  const mail = (await (await fetch(`${base}/api/health/mail`, { headers: { origin: base } })).json()) as any;
  if (mail.sending === "live" && process.env.E2E_ALLOW_LIVE_MAIL !== "yes") throw new Error(`${base} can e-mail any address. These checks send only to the test mailbox; set E2E_ALLOW_LIVE_MAIL=yes to run them there on purpose.`);
  console.log(`Checking ${base}, release ${running}, mail ${mail.sending}.`);
}
