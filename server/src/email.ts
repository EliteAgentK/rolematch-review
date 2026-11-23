// Branded transactional e-mail templates. The design lives here, in code, so it is versioned and tested; sending goes through src/mail (SMTP, owned by RoleMatch).
// Supabase only creates and checks the code; it never sends anything itself.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { sendMail } from "./mail";
import { MailError } from "./mail/transport";
import { record } from "./timing";

const BRAND = {
  blue: "#007BA7", orange: "#F55F3C", yellow: "#FFD600", green: "#3DB58C", purple: "#5F3FD1", coral: "#FF5555", ink: "#343330",
  text: "#1F2937", muted: "#6B7280", panel: "#F0F7FA", page: "#F3F6F9",
};
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface RenderedEmail { subject: string; html: string; text: string }

/** The verification e-mail. `code` must be digits only; the name is escaped. */
const CODE_WORDS = {
  verify: { title: "Your RoleMatch verification code", heading: "Verify your email address", plain: "verify your email address", intro: "Welcome to RoleMatch. Enter this code to finish creating your account:", ignore: "Didn't create a RoleMatch account? You can safely ignore this email: nobody can sign in without this code." },
  reset: { title: "Your RoleMatch password reset code", heading: "Reset your password", plain: "reset your password", intro: "Enter this code to choose a new password for your RoleMatch account:", ignore: "Didn't ask to reset your password? You can safely ignore this email: your password stays as it is." },
};
export function renderVerificationEmail(input: { code: string; name?: string; expiryMinutes?: number; purpose?: keyof typeof CODE_WORDS }): RenderedEmail {
  const words = CODE_WORDS[input.purpose ?? "verify"];
  if (!/^\d{4,10}$/.test(input.code)) throw new Error("Verification code must be digits only");
  const minutes = input.expiryMinutes ?? config.otpExpiryMinutes;
  const expiry = minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;
  const first = (input.name ?? "").trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hi ${escapeHtml(first)},` : "Hello,";
  const year = new Date().getFullYear();
  const stripe = [BRAND.blue, BRAND.orange, BRAND.yellow, BRAND.green, BRAND.purple, BRAND.coral, BRAND.ink]
    .map((c) => `<td height="6" style="height:6px;line-height:6px;font-size:6px;background:${c}">&nbsp;</td>`).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${words.title}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${words.title} is ${input.code}. It expires in ${expiry}.&nbsp;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;&#8199;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stripe}</tr></table></td></tr>
    <tr><td align="center" style="padding:36px 32px 8px 32px;">
      <img src="cid:rolematch-logo" alt="RoleMatch" width="190" style="display:block;border:0;outline:none;width:190px;height:auto;">
    </td></tr>
    <tr><td style="padding:12px 40px 0 40px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.text};">
      <h1 style="margin:16px 0 12px 0;font-size:24px;line-height:32px;font-weight:700;color:${BRAND.ink};text-align:center;">${words.heading}</h1>
      <p style="margin:0 0 8px 0;font-size:16px;line-height:26px;">${greeting}</p>
      <p style="margin:0 0 24px 0;font-size:16px;line-height:26px;">${words.intro}</p>
    </td></tr>
    <tr><td align="center" style="padding:0 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:${BRAND.panel};border:2px solid ${BRAND.blue};border-radius:12px;">
        <tr><td align="center" style="padding:18px 34px;font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:36px;line-height:44px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};">${input.code}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 40px 8px 40px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.text};">
      <p style="margin:0 0 12px 0;font-size:15px;line-height:24px;text-align:center;">This code expires in <strong>${expiry}</strong> and can only be used once.</p>
      <p style="margin:0;font-size:14px;line-height:22px;color:${BRAND.muted};text-align:center;">${words.ignore} RoleMatch will never ask you to share it with anyone.</p>
    </td></tr>
    <tr><td style="padding:28px 40px 32px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E5E7EB;padding-top:20px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${BRAND.muted};text-align:center;">
      <strong><span style="color:${BRAND.blue};">Role</span><span style="color:#000000;">Match</span></strong> &middot; Intelligent talent matching<br>&copy; ${year} RoleMatch. All rights reserved. This is an automated message.
    </td></tr></table></td></tr>
  </table>
</td></tr></table></body></html>`;

  const text = `RoleMatch: ${words.plain}\n\n${first ? `Hi ${first},` : "Hello,"}\n\n${words.intro}\n\n    ${input.code}\n\nThis code expires in ${expiry} and can only be used once.\n\n${words.ignore} RoleMatch will never ask you to share it with anyone.\n\n(c) ${year} RoleMatch. This is an automated message.\n`;
  return { subject: `${input.code} is ${words.title.replace("Your", "your")}`, html, text };
}

let logo: Buffer | null = null;
/** The approved RoleMatch logo, attached inline so it shows without any web hosting; with images blocked the alt text and the text wordmark carry the message. */
export const inlineLogo = () => [{ cid: "rolematch-logo", filename: "rolematch-logo.png", contentType: "image/png", content: (logo ??= readFileSync(fileURLToPath(new URL("../../public/logo-light.png", import.meta.url)))) }];

/** Sends the sign-up verification code. The code is held only in memory for this call and is never stored by RoleMatch (Supabase Auth stores and checks it). It goes through
 * the shared sending path with authentication priority and is NOT queued: a code that waited in a backlog would be stale. A failure is reported to the person, who may ask again. */
export async function sendVerificationEmail(to: string, name: string, code: string, purpose: keyof typeof CODE_WORDS = "verify"): Promise<void> {
  const mail = renderVerificationEmail({ code, name, purpose });
  if (config.signupDevCode) {   // explicit development switch, refused in production: shows the code on the console and writes a preview; this is never reported as sent
    const dir = join(config.dataDir, "emails"); mkdirSync(dir, { recursive: true });
    const file = join(dir, `verification-${Date.now()}.html`);
    writeFileSync(file, mail.html.replace("cid:rolematch-logo", `data:image/png;base64,${inlineLogo()[0].content.toString("base64")}`));
    console.log(`[dev] sign-up code for ${to}: ${code}`); console.log(`[dev] email preview: ${file}`);
    return;
  }
  // A person is waiting, so the wait is bounded. If the mail server has not answered in time the message may still be on its way: that is reported as UNCERTAIN (never as sent) and
  // is not retried here; the person is told to wait and check, and a new code is only available after the resend wait.
  const t0 = Date.now();
  try {
    await Promise.race([
      sendMail({ cls: "authentication", to, subject: mail.subject, html: mail.html, text: mail.text, template: "verification", templateVersion: TEMPLATE_VERSION, inline: inlineLogo() }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new MailError("The mail server did not answer in time.", "uncertain")), config.mail.authTimeoutMs).unref?.()),
    ]);
  } finally { record("mail.verification.total", Date.now() - t0); }
}
export const TEMPLATE_VERSION = "2026-10-30.1";

const SAST = (d: Date) => new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "long", timeStyle: "short" }).format(d) + " SAST";
const ROLE_TEXT: Record<string, string> = { admin: "Portal administrator (manages members and settings)", recruiter: "Recruiter (uploads, reviews and matches)", hiring_manager: "Hiring manager / HR (read-only: sees shortlisted candidates)" };

/** The invitation e-mail. Names are set by the inviting organisation and are escaped; the link is the only secret and is never logged.
 * RoleMatch is the platform; the organisation is shown in text only (no organisation logo, no implied partnership). Clear with images blocked: the logo has
 * alt text and the action is a styled text link, repeated as a plain link under the button. */
export function renderInvitationEmail(input: { orgName: string; portalName: string; inviterEmail: string; role: string; expiresAt: Date; link: string; localOnly?: boolean }): RenderedEmail {
  const { orgName, portalName, inviterEmail, link } = input;
  const role = ROLE_TEXT[input.role] ?? input.role, expires = SAST(input.expiresAt), year = new Date().getFullYear();
  const e = escapeHtml;
  const stripe = [BRAND.blue, BRAND.orange, BRAND.yellow, BRAND.green, BRAND.purple, BRAND.coral, BRAND.ink].map((c) => `<td height="6" style="height:6px;line-height:6px;font-size:6px;background:${c}">&nbsp;</td>`).join("");
  const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:${BRAND.muted};font-size:13px;width:120px;vertical-align:top;">${k}</td><td style="padding:6px 0;color:${BRAND.text};font-size:14px;">${v}</td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>You are invited to ${e(portalName)} on RoleMatch</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(inviterEmail)} invited you to ${e(portalName)} at ${e(orgName)} on RoleMatch. The invitation expires ${e(expires)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:32px 12px;"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stripe}</tr></table></td></tr>
    <tr><td align="center" style="padding:32px 32px 8px 32px;"><img src="cid:rolematch-logo" alt="RoleMatch" width="190" style="display:block;border:0;width:190px;height:auto;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:${BRAND.blue};"></td></tr>
    <tr><td style="padding:12px 40px 0 40px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.text};">
      <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;color:${BRAND.ink};">You have been invited to a recruitment portal</h1>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;"><strong>${e(inviterEmail)}</strong> has invited you to join a portal on RoleMatch, the recruitment platform.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.panel};border-radius:10px;padding:8px 16px;margin:0 0 20px 0;">
        ${row("Organisation", e(orgName))}${row("Portal", e(portalName))}${row("Your role", e(role))}${row("Invited by", e(inviterEmail))}${row("Expires", e(expires))}
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;"><tr><td style="background:${BRAND.blue};border-radius:8px;"><a href="${e(link)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">Accept invitation</a></td></tr></table>
      ${input.localOnly ? `<p style="margin:0 0 10px 0;font-size:12px;color:${BRAND.orange};"><strong>Local test link:</strong> this link points to a computer on a private network and works only there.</p>` : ""}<p style="margin:0 0 6px 0;font-size:12px;color:${BRAND.muted};">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0 0 20px 0;font-size:12px;word-break:break-all;"><a href="${e(link)}" style="color:${BRAND.blue};">${e(link)}</a></p>
      <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">This link was made for this e-mail address only and can be used once. Sign in or create your RoleMatch account with this address to accept. If you were not expecting this, ignore this message: nothing happens unless you accept. The organisation and portal names were set by the inviting organisation.</p>
    </td></tr>
    <tr><td align="center" style="padding:16px 32px 28px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};border-top:1px solid #E5E7EB;">Sent via RoleMatch &middot; Intelligent talent matching<br>&copy; ${year} RoleMatch. This is an automated message.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `RoleMatch: you have been invited to a recruitment portal\n\n${inviterEmail} has invited you to join a portal on RoleMatch, the recruitment platform.\n\nOrganisation: ${orgName}\nPortal: ${portalName}\nYour role: ${role}\nInvited by: ${inviterEmail}\nExpires: ${expires}\n\n${input.localOnly ? "LOCAL TEST LINK: works only on the computer that sent it.\n\n" : ""}Accept invitation:\n${link}\n\nThis link was made for this e-mail address only and can be used once. Sign in or create your RoleMatch account with this address to accept. If you were not expecting this, ignore this message: nothing happens unless you accept. The organisation and portal names were set by the inviting organisation.\n\nSent via RoleMatch\n`;
  return { subject: `${inviterEmail} invited you to ${portalName} on RoleMatch`.slice(0, 200), html, text };
}

const STEPS: Record<"admin" | "member" | "hiring_manager", [string, string][]> = {
  admin: [
    ["Add a role", "Upload or paste a job specification. RoleMatch reads its requirements, so every candidate is assessed against the same standard."],
    ["Add candidates", "Upload CVs. Each one shows its progress while it is read and joins your candidate panel only when it is ready."],
    ["Match and review", "Place a candidate and a role side by side and choose Match. You will see which requirements are verified, partly evidenced or not shown, and how complete the evidence is."],
    ["Bring in your team", "Invite colleagues from Settings, Team, and decide who can do what in each portal."],
  ],
  member: [
    ["Add a role", "Upload or paste a job specification, or open one your team has already added."],
    ["Add candidates", "Upload CVs. Each one shows its progress while it is read and joins the candidate panel only when it is ready."],
    ["Match and review", "Place a candidate and a role side by side and choose Match. You will see which requirements are verified, partly evidenced or not shown, and how complete the evidence is."],
  ],
  hiring_manager: [
    ["See the shortlist", "Your recruiters shortlist candidates. You see those candidates and the roles in the portal; nobody else's details are shown to you."],
    ["Read the evidence", "Open a shortlisted candidate to read their record and original CV, and any match already run, with the requirements verified, partly evidenced or not shown."],
  ],
};

/** The welcome e-mail, sent once when a person's account is set up (they created an organisation, or joined one through an invitation). Every statement in it describes
 * behaviour the product has today; nothing here is a marketing claim. Names are escaped. */
export function renderWelcomeEmail(input: { name: string; orgName: string; portalName: string; variant: "admin" | "member" | "hiring_manager"; inviterEmail?: string; role?: string; link: string; joinedAt: Date; localOnly?: boolean }): RenderedEmail {
  const e = escapeHtml, first = (input.name.trim().split(/\s+/)[0] || "there").slice(0, 40), year = new Date().getFullYear(), when = SAST(input.joinedAt);
  const intro = input.variant === "admin"
    ? `Your organisation, <strong>${e(input.orgName)}</strong>, is set up and you are its administrator. Here is how to go from a pile of CVs to a well-evidenced shortlist.`
    : `${input.inviterEmail ? `<strong>${e(input.inviterEmail)}</strong> added you` : "You have joined"} ${input.inviterEmail ? "to " : ""}<strong>${e(input.portalName)}</strong> at <strong>${e(input.orgName)}</strong>${input.role ? ` as ${e(ROLE_TEXT[input.role] ?? input.role)}` : ""}. Here is how to get started.`;
  const introText = intro.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const steps = STEPS[input.variant];
  const promises: [string, string][] = [
    ["Recommendations, not decisions.", "RoleMatch never rejects, shortlists or hires anyone on its own. Your team decides."],
    ["Evidence you can check.", "Every match shows the CV evidence behind it, and information a CV does not mention is never treated as a no."],
    ["Your documents stay yours.", "Original CVs are stored privately for your organisation."],
  ];
  const stripe = [BRAND.blue, BRAND.orange, BRAND.yellow, BRAND.green, BRAND.purple, BRAND.coral, BRAND.ink].map((c) => `<td height="6" style="height:6px;line-height:6px;font-size:6px;background:${c}">&nbsp;</td>`).join("");
  const dot = [BRAND.blue, BRAND.green, BRAND.purple, BRAND.orange];
  const stepRows = steps.map(([h, b], i) => `<tr><td style="width:36px;vertical-align:top;padding:0 0 14px 0;"><div style="width:26px;height:26px;border-radius:13px;background:${dot[i % 4]};color:#ffffff;font-size:13px;font-weight:700;line-height:26px;text-align:center;">${i + 1}</div></td><td style="vertical-align:top;padding:2px 0 14px 0;font-size:14px;line-height:1.55;"><strong style="color:${BRAND.ink};">${h}.</strong> ${b}</td></tr>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>Welcome to RoleMatch</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Welcome aboard, ${e(first)}. Here is how to get from CVs to a well-evidenced shortlist.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:32px 12px;"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stripe}</tr></table></td></tr>
    <tr><td align="center" style="padding:32px 32px 8px 32px;"><img src="cid:rolematch-logo" alt="RoleMatch" width="190" style="display:block;border:0;width:190px;height:auto;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:${BRAND.blue};"></td></tr>
    <tr><td style="padding:12px 40px 0 40px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.text};">
      <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.3;color:${BRAND.ink};">Welcome to RoleMatch, ${e(first)}</h1>
      <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;">${intro}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px 0;">${stepRows}</table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td style="background:${BRAND.blue};border-radius:8px;"><a href="${e(input.link)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">Open RoleMatch</a></td></tr></table>
      ${input.localOnly ? `<p style="margin:-12px 0 20px 0;font-size:12px;color:${BRAND.orange};"><strong>Local test link:</strong> this link points to a computer on a private network and works only there.</p>` : ""}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.panel};border-radius:10px;margin:0 0 24px 0;"><tr><td style="padding:16px 20px;font-size:13px;line-height:1.6;">
        <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:${BRAND.ink};">How RoleMatch works with you</p>
        ${promises.map(([h, b]) => `<p style="margin:0 0 6px 0;"><strong>${h}</strong> ${b}</p>`).join("")}
      </td></tr></table>
      <p style="margin:0 0 4px 0;font-size:16px;line-height:1.6;color:${BRAND.ink};"><strong>Happy hunting.</strong> May your shortlists be short and your matches well evidenced.</p>
      <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;">The RoleMatch team</p>
      <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">You are receiving this because a RoleMatch account was set up with this address on ${e(when)}. If that was not you, reply to this e-mail so we can look into it.</p>
    </td></tr>
    <tr><td align="center" style="padding:16px 32px 28px 32px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.muted};border-top:1px solid #E5E7EB;">Sent via RoleMatch &middot; Intelligent talent matching<br>&copy; ${year} RoleMatch. This is a service message about your account.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Welcome to RoleMatch, ${first}\n\n${introText}\n\n${steps.map(([h, b], i) => `${i + 1}. ${h}. ${b}`).join("\n")}\n\nOpen RoleMatch:\n${input.link}\n${input.localOnly ? "(LOCAL TEST LINK: works only on the computer that sent it.)\n" : ""}\nHow RoleMatch works with you\n${promises.map(([h, b]) => `- ${h} ${b}`).join("\n")}\n\nHappy hunting. May your shortlists be short and your matches well evidenced.\n\nThe RoleMatch team\n\nYou are receiving this because a RoleMatch account was set up with this address on ${when}. If that was not you, reply to this e-mail so we can look into it.\n\nSent via RoleMatch\n`;
  const subject = input.variant === "admin" ? `Welcome to RoleMatch, ${first}: ${input.orgName} is ready` : `Welcome to RoleMatch, ${first}: you have joined ${input.portalName}`;
  return { subject: subject.replace(/[\r\n]+/g, " ").slice(0, 200), html, text };
}
