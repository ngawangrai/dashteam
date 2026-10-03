import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { latestSignInCode } from "./mailpit";

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // Mailpit timestamps are in whole seconds; allow for that and for clock skew.
  const sentAfter = new Date(Date.now() - 2_000);
  await page.getByRole("button", { name: "Send code" }).click();
  // Supabase allows one code per person per second; back-to-back tests for the same person can hit it.
  const heading = page.getByRole("heading", { name: "Check your email" });
  const tooSoon = page.getByText("Too many codes in a short time");
  await expect(heading.or(tooSoon)).toBeVisible();
  if (await tooSoon.isVisible()) {
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: "Send code" }).click();
  }
  await expect(heading).toBeVisible();
  const code = await latestSignInCode(email, sentAfter);
  // Typing the sixth digit submits on its own, as it does when iOS fills the code from Mail.
  await page.getByLabel("Code").fill(code);
  // Wait until the sign-in has gone through (or been refused) before the test moves on.
  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.getByRole("alert").filter({ hasText: /\S/ }).first().waitFor(),
  ]);
}

/**
 * Signs out. By default straight through the sign-out route, so a page still refreshing after a
 * save can't interrupt it; `viaButton` uses the Sign out button, for the test that is about it.
 */
export async function signOut(page: Page, options: { viaButton?: boolean } = {}) {
  if (options.viaButton) {
    const button = page.getByRole("button", { name: "Sign out" });
    // Laptops: in the sidebar. Phones: at the end of Profile.
    if (!(await button.isVisible())) await page.goto("/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    return;
  }
  await page.request.post("/auth/sign-out", { maxRedirects: 0 });
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
}

export async function expectNoSideways(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

// Checks against the local database, for what the screens can't show (ciphertext, audit entries).
export const db = postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
