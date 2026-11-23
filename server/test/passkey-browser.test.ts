import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { makeWorld, type World } from "./portalKit";

// The real sign-in page and Security tab, in real Chrome, with Chrome's virtual authenticator, against the real sign-in service on the disposable local stack.
// A virtual authenticator proves the page and the protocol. It does NOT prove that Face ID or Touch ID work on a real device; that is a separate check by a person.
// Needs Chrome and a built website: npm run build, then PASSKEY_BROWSER=1 npm run test:local -- test/passkey-browser.test.ts
describe.skipIf(!process.env.PASSKEY_BROWSER)("passkeys in a real browser", () => {
  const PASSWORD = "a-long-enough-password-1";
  let w: World, browser: any, page: any, cdp: any, authenticatorId: string, email: string;
  const signOutOfBrowser = async () => { await page.context().clearCookies(); await page.goto(`${w.base}/login`); };
  const openSecurity = async () => { await page.goto(`${w.base}/settings`); await page.getByRole("tab", { name: "Security" }).click(); };
  const passwordSignIn = async () => {
    await page.goto(`${w.base}/login`);
    await page.getByPlaceholder("you@example.com").fill(email); await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("Your password").fill(PASSWORD); await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL("**/dashboard");
  };

  beforeAll(async () => {
    w = await makeWorld(8861, 2, { PASSKEYS_ENABLED: "true" });
    email = w.users[1].email;
    const { chromium } = await import("../../node_modules/playwright-core/index.mjs" as string);
    browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
    page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    ({ authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }));
  }, 240000);
  afterAll(async () => { await browser?.close(); await w?.stop(); }, 120000);

  test("the sign-in page offers it, with the agreed wording, and the password route stays", async () => {
    await page.goto(`${w.base}/login`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).waitFor();
    await page.getByText("Uses Face ID, Touch ID, Windows Hello or a device PIN, if your device has them.").waitFor();
    await page.getByRole("button", { name: "Continue" }).waitFor();
  }, 60000);

  test("enrol from the Security tab, sign out, then sign in with the passkey and no typing: into the same account", async () => {
    await passwordSignIn();
    await openSecurity();
    await page.getByText("You have no passkeys yet.").waitFor();
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await page.getByText(/^Added /).first().waitFor();
    expect((await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length).toBe(1);
    const before = await page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user);
    await signOutOfBrowser();
    expect(await page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.waitForURL("**/dashboard");
    const after = await page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user);
    expect(after.userId).toBe(before.userId); expect(after.orgId).toBe(before.orgId);
    const cookies = await page.context().cookies();
    expect(cookies.find((c: any) => c.name === "th_access")?.httpOnly).toBe(true);   // the server's own session, which page code cannot read
    expect(await page.evaluate(() => document.cookie)).not.toContain("th_access");
  }, 120000);

  test("a device that cannot confirm the person, or a cancelled prompt, leaves them on the sign-in page with the password still there", async () => {
    await signOutOfBrowser();
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.getByText(/Passkey sign-in cancelled|Could not sign in with a passkey/).first().waitFor();
    expect(new URL(page.url()).pathname).toBe("/login");
    await page.getByRole("button", { name: "Continue" }).waitFor();
    expect(await page.evaluate(async () => (await fetch("/api/auth/me")).status)).toBe(401);
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
  }, 60000);

  test("an invitation link's return is kept: signing in with a passkey goes to the invitation, and accepts nothing by itself", async () => {
    await signOutOfBrowser();
    await page.goto(`${w.base}/login?invite=not-a-real-token`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.waitForURL("**/accept-invite?token=not-a-real-token");
  }, 60000);

  test("remove it from the Security tab: it no longer signs in, and the password still does", async () => {
    await signOutOfBrowser(); await passwordSignIn();
    await openSecurity();
    await page.getByRole("button", { name: "Remove" }).first().click();
    await page.getByText("You have no passkeys yet.").waitFor();
    await signOutOfBrowser();
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.getByText("Could not sign in with a passkey").first().waitFor();
    await passwordSignIn();
  }, 120000);
});
