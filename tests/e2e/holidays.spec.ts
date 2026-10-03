import { expect, test } from "@playwright/test";
import { db, expectNoSideways, signIn, signOut } from "./helpers";

// Holidays: moving one shows its impact on leave first and tells the people affected; copying forward
// copies fixed dates only, as tentative; tentative dates say so everywhere; short-notice holidays.

const ADMIN = "admin@dashteam.local";
const EMPLOYEE = "employee@dashteam.local";
const SONAM = "33333333-3333-4333-8333-333333333333";

// Each device works in its own month of 2029, clear of the seeded holidays.
const monthFor = (project: string) => ({ desktop: "03", "phone-light": "04", "phone-dark": "05" })[project] ?? "06";

/** The first Monday of a month in 2029, and the days after it. */
function week2029(month: string) {
  const first = new Date(`2029-${month}-01T00:00:00Z`);
  while (first.getUTCDay() !== 1) first.setUTCDate(first.getUTCDate() + 1);
  const day = (offset: number) => new Date(first.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return { mon: day(0), tue: day(1), wed: day(2), nextMon: day(7) };
}

test.describe.configure({ mode: "serial" });

test("moving a holiday shows the leave it changes first, then tells the person", async ({ page }, testInfo) => {
  const week = week2029(monthFor(testInfo.project.name));
  const name = `Move test ${testInfo.project.name}`;
  await db`delete from public.holidays where name = ${name}`;
  await db`delete from public.leave_requests where person_id = ${SONAM} and start_date = ${week.mon}`;
  await db`insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
           values (${name}, ${week.tue}, ${week.tue}, 2029, 'one_off', 'national', 'confirmed', 'test')`;
  await db`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status)
           values (${SONAM}, 'annual', ${week.mon}, ${week.wed}, 'approved')`;

  await signIn(page, ADMIN);
  await page.goto("/admin/calendar/holidays?year=2029");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  const sheet = page.getByRole("dialog", { name: "Edit holiday" });
  await sheet.getByLabel("First day").fill(week.nextMon);
  await sheet.getByRole("button", { name: "Save changes" }).click();

  // The impact, before anything is saved: Mon–Wed with Tuesday off was 2 days; now it's 3.
  const review = page.getByRole("dialog", { name: "Check the leave this changes" });
  await expect(review).toContainText("Sonam Wangmo");
  await expect(review.getByLabel("2 days becomes 3 days")).toBeVisible();
  await testInfo.attach("impact", { body: await page.screenshot(), contentType: "image/png" });
  await review.getByRole("button", { name: "Save and update 1 request" }).click();
  await expect(page.getByText(`${name} saved. 1 leave request updated.`)).toBeVisible();
  await signOut(page);

  await signIn(page, EMPLOYEE);
  await page.goto("/leave");
  await expect(page.getByText(new RegExp(`${name} moved, so your annual leave on .* now counts 3 days \\(was 2 days\\)\\.`))).toBeVisible();
  await expectNoSideways(page);

  await db`delete from public.leave_requests where person_id = ${SONAM} and start_date = ${week.mon}`;
  await db`delete from public.holidays where name = ${name}`;
});

test("copying forward copies fixed dates only, marked tentative", async ({ page }) => {
  await db`delete from public.holidays where year = 2028`;
  await signIn(page, ADMIN);
  await page.goto("/admin/calendar/holidays?year=2027");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Copy fixed dates to 2028" }).click();
  const sheet = page.getByRole("dialog", { name: "Copy fixed dates to 2028" });
  await expect(sheet).toContainText("National Day");
  await expect(sheet).not.toContainText("Losar");
  await sheet.getByRole("button", { name: "Copy 6 fixed holidays to 2028" }).click();
  await expect(page.getByText("6 fixed holidays copied to 2028.")).toBeVisible();

  await page.goto("/admin/calendar/holidays?year=2028");
  await expect(page.getByRole("button", { name: /National Day/ })).toContainText("Tentative");
  await expect(page.getByRole("button", { name: /Losar/ })).toHaveCount(0);
  const rows = await db`select status from public.holidays where year = 2028`;
  expect(rows.map((row) => row.status)).toEqual(Array(6).fill("tentative"));
  await db`delete from public.holidays where year = 2028`;
});

test("tentative dates show as tentative wherever they appear", async ({ page }, testInfo) => {
  await signIn(page, EMPLOYEE);
  await page.goto("/holidays?year=2027");
  await expect(page.getByText("Thimphu Tshechu")).toBeVisible();
  await expect(page.getByText("Tentative").first()).toBeVisible();
  await expect(page.getByText(/Tentative dates aren’t official yet/)).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("holidays-2027", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.goto("/holidays?year=2026");
  await expect(page.getByText("Thimphu Tshechu")).toBeVisible();
  await expect(page.getByText("Tentative")).toHaveCount(0);

  await page.goto("/leave?month=2027-10");
  await expect(page.getByRole("region", { name: /Who’s out/ })).toContainText("Thimphu Tshechu (tentative)");

  await page.getByRole("button", { name: "Request leave" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Request leave" });
  for (let i = 0; i < 12 && !(await sheet.getByText("October 2027").isVisible()); i += 1) {
    await sheet.getByRole("button", { name: "Next month" }).click();
  }
  await expect(sheet.getByRole("button", { name: /^Monday 11 October, Thimphu Tshechu \(tentative\), holiday, not counted/ })).toBeVisible();
});

test("an admin adds a holiday declared at short notice, removes it, and can undo the removal", async ({ page }, testInfo) => {
  const name = `Short notice ${testInfo.project.name}`;
  await db`delete from public.holidays where name = ${name}`;
  await signIn(page, ADMIN);
  await page.goto("/admin/calendar/holidays?year=2029");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add holiday" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a holiday" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByLabel("First day").fill(`2029-07-1${["desktop", "phone-light", "phone-dark"].indexOf(testInfo.project.name) + 1}`);
  await sheet.getByLabel("Source").fill("Declared by the Cabinet");
  await sheet.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByText(`${name} added.`)).toBeVisible();

  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("dialog", { name: "Edit holiday" }).getByRole("button", { name: "Remove holiday" }).click();
  await expect(page.getByText(`${name} removed.`)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);
  await page.locator("[data-sonner-toast]").filter({ hasText: `${name} removed.` }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await db`delete from public.holidays where name = ${name}`;
});
