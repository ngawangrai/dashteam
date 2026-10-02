import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { latestSignInCode } from "./mailpit";

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // Mailpit timestamps are in whole seconds; allow for that and for clock skew.
  const sentAfter = new Date(Date.now() - 2_000);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const code = await latestSignInCode(email, sentAfter);
  // Typing the sixth digit submits on its own, as it does when iOS fills the code from Mail.
  await page.getByLabel("Code").fill(code);
}

export async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Sign out" });
  // Laptops: in the sidebar. Phones: at the end of Profile.
  if (!(await button.isVisible())) await page.goto("/profile");
  await page.getByRole("button", { name: "Sign out" }).click();
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
