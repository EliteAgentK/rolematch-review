// Run by mail-policy.test.ts against a throw-away schema with a simulated mail host: shows how the hourly allowance is shared between classes.
import { sendMail, MailDeferred } from "../../src/mail";
const one = async (cls: "authentication" | "invitation", n: number) => {
  try { const r = await sendMail({ cls, to: `probe${n}@example.test`, subject: "s", html: "<p>h</p>", text: "t", template: "probe", templateVersion: "1" }); return `${cls}:${r.outcome}`; }
  catch (e) { return `${cls}:${e instanceof MailDeferred ? "deferred" : "error"}`; }
};
const out: string[] = [];
for (let i = 0; i < 4; i++) out.push(await one("invitation", i));        // allowance 5, 2 reserved for authentication: invitations stop at 3
for (let i = 0; i < 4; i++) out.push(await one("authentication", 10 + i)); // authentication may use the reserved headroom, then the ceiling
console.log(JSON.stringify(out));
process.exit(0);
