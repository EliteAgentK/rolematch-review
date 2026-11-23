// Sign-up, verification, wrong codes, resend, sign-out, and a forgotten password, by the real pages and the real mail path. A code's 15-minute expiry is proven in server/test/email.test.ts,
// by moving its issue time; here a replaced code is refused, the same check a person can meet in real time.
import { expect, test } from "@playwright/test";
import { address, codeIn, fillSignup, PASSWORD, RUN, signIn, waitForMail } from "./kit";

const email = address("signup"), NEW_PASSWORD = `${PASSWORD}-new`;

test("a new account: details, a wrong code refused, a new code replaces the old one, the right code signs in to its own new organisation", async ({ page }) => {
  await page.goto("/signup");
  const t0 = Date.now();
  await fillSignup(page, { name: "Hosted Check", org: `Hosted Check ${RUN}`, email });
  await expect(page.getByText(/asked our mail system to send a verification code/)).toBeVisible({ timeout: 30_000 });
  const first = codeIn(await waitForMail(email, /RoleMatch verification code/, t0));
  const code = page.getByLabel(/^Verification code/);

  await code.fill(first === "000000" ? "000001" : "000000");
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await expect(page.getByText(/incorrect or has expired/i).first()).toBeVisible({ timeout: 20_000 });

  const resend = page.getByRole("button", { name: /Send a new code/ });
  await expect(resend).toBeEnabled({ timeout: 90_000 });
  const t1 = Date.now(); await resend.click();
  const second = codeIn(await waitForMail(email, /RoleMatch verification code/, t1));
  if (second !== first) {
    await code.fill(first); await page.getByRole("button", { name: "Verify and create account" }).click();
    await expect(page.getByText(/incorrect or has expired/i).first()).toBeVisible({ timeout: 20_000 });
  }
  await code.fill(second); await page.getByRole("button", { name: "Verify and create account" }).click();
  await page.waitForURL(/overview/, { timeout: 60_000 });
  const me = await (await page.request.get("/api/auth/me")).json();
  expect(me.user.email).toBe(email);
  expect(me.user.role).toBe("admin");
  expect(me.portals).toHaveLength(1);   // its own portal and nothing else
});

test("sign-out ends the session, and a wrong password is refused without saying which part was wrong", async ({ page }) => {
  await signIn(page, email); await page.waitForURL(/overview/, { timeout: 60_000 });
  await page.request.post("/api/auth/logout", { headers: { origin: new URL(page.url()).origin } });
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await signIn(page, email, "not-the-right-password-1");
  await expect(page.getByText("Email or password is incorrect").first()).toBeVisible({ timeout: 20_000 });
});

test("a forgotten password: the page does not say whether the address exists; the code changes it, and the old password stops working", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email); await page.locator('button[type="submit"]').first().click();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(page.getByText(/If .* has a RoleMatch account, a code is on its way/)).toBeVisible({ timeout: 20_000 });
  const code = codeIn(await waitForMail(email, /RoleMatch password reset code/, t0));
  await page.getByLabel("Reset code").fill(code);
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByPlaceholder("Your password")).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Your password").fill(PASSWORD); await page.locator('button[type="submit"]').last().click();
  await expect(page.getByText("Email or password is incorrect").first()).toBeVisible({ timeout: 20_000 });
  await signIn(page, email, NEW_PASSWORD); await page.waitForURL(/overview/, { timeout: 60_000 });
});
