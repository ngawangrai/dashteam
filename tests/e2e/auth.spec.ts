import { expect, test } from "@playwright/test";
import { expectNoSideways, signIn, signOut } from "./helpers";

// Matches supabase/seed.sql.
const ADMIN = { email: "admin@dashteam.local", firstName: "Tashi" };
const EMPLOYEE = { email: "employee@dashteam.local", firstName: "Sonam" };

test("signed-out visitors are sent to sign in", async ({ page }) => {
  for (const path of ["/", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoSideways(page);
});

test("an employee lands on their own home and cannot reach admin", async ({ page }, testInfo) => {
  await signIn(page, EMPLOYEE.email);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: `Hello, ${EMPLOYEE.firstName}` })).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("employee-home", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // Typing the URL: the server redirects before any admin content renders.
  const response = await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
  expect(await response?.text()).not.toContain("Nothing needs you right now");
  await expect(page.getByText("Nothing needs you right now")).toHaveCount(0);
});

test("an admin lands on the admin home", async ({ page }, testInfo) => {
  await signIn(page, ADMIN.email);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: `Hello, ${ADMIN.firstName}` })).toBeVisible();
  await expect(page.getByText("Nothing needs you right now")).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("admin-home", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, EMPLOYEE.email);
  await expect(page).toHaveURL(/\/$/);
  await signOut(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("an email that isn't set up gets a clear next step", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("#email-error")).toContainText("Ask your admin to add you");
});

test("a wrong code says what to do", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMPLOYEE.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("Code").fill("000000");
  // Next.js renders its own empty role="alert" route announcer, so target the field error.
  await expect(page.locator("#code-error")).toContainText("send a new code");
  await testInfo.attach("login-code-error", { body: await page.screenshot(), contentType: "image/png" });

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email")).toHaveValue(EMPLOYEE.email);
});
