import { expect, type Locator, type Page, test } from "@playwright/test";
import { db, expectNoSideways, signIn, signOut } from "./helpers";

// Milestone 3 end to end: requesting leave with the balance shown live, approving and undoing,
// declining with a note, cancelling, holidays, Who's out and leave at exit.

const ADMIN = "admin@dashteam.local";
const EMPLOYEE = "employee@dashteam.local";
const SONAM = "33333333-3333-4333-8333-333333333333";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The first Monday of a month some months ahead, so each device runs in its own month. */
function weekAhead(monthsAhead: number) {
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(new Date()));
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthsAhead, 1));
  while (first.getUTCDay() !== 1) first.setUTCDate(first.getUTCDate() + 1);
  const day = (offset: number) => new Date(first.getTime() + offset * 86_400_000);
  const label = (date: Date) => `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { monday: day(0), tuesday: day(1), wednesday: day(2), label, iso, monthsAhead };
}

// Months whose first fortnight has no seeded holiday on the days these tests book
// (Dec 2026, Mar 2027, May 2027 as of October 2026).
const offsetFor = (project: string) => ({ desktop: 2, "phone-light": 5, "phone-dark": 7 })[project] ?? 9;
const holidayOffsetFor = (project: string) => ({ desktop: 8, "phone-light": 9, "phone-dark": 10 })[project] ?? 11;

async function pickDates(page: Page | Locator, monthsAhead: number, first: string, last: string) {
  for (let i = 0; i < monthsAhead; i += 1) await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: new RegExp(`^${first}`) }).click();
  await page.getByRole("button", { name: new RegExp(`^${last}`) }).click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // A clean slate for the seeded employee's leave, so the run can be repeated without a reset.
  await db`delete from public.leave_requests where person_id = ${SONAM}`;
});

test("an employee requests leave in under 15 seconds and sees the balance before sending", async ({ page }, testInfo) => {
  const week = weekAhead(offsetFor(testInfo.project.name));
  await signIn(page, EMPLOYEE);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/leave");
  await expect(page.getByText("25 of 25 left")).toBeVisible();

  const started = Date.now();
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Request leave" });
  await pickDates(sheet, week.monthsAhead, week.label(week.monday), week.label(week.wednesday));
  // The consequence shows before anything is sent.
  await expect(sheet.getByText("This leaves you 22 days of annual leave.")).toBeVisible();
  await testInfo.attach("request-sheet", { body: await page.screenshot(), contentType: "image/png" });
  await sheet.getByRole("button", { name: "Request 3 days of annual leave" }).click();
  await expect(page.getByText(/^Sent to your admin: 3 days of annual leave/)).toBeVisible();
  expect(Date.now() - started).toBeLessThan(15_000);

  // Listed as waiting. (The balance above is this year's; the request may fall in next year.)
  await expect(page.getByRole("button", { name: /Annual leave.*3 days.*Waiting for approval/ })).toBeVisible();
  await expectNoSideways(page);
});

test("an admin approves from one inbox, undoes it, and approves again", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
  const card = page.getByRole("article").filter({ hasText: "Sonam Wangmo" }).filter({ hasText: "Annual leave" });
  await expect(card).toContainText("3 days");
  await expect(card).toContainText("leaves 22 days");
  await expectNoSideways(page);
  await testInfo.attach("needs-you", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Sonam’s leave is approved.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Sonam’s leave is approved.")).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("the employee sees the decision, and a declined request shows the admin's note", async ({ page }, testInfo) => {
  const week = weekAhead(offsetFor(testInfo.project.name));
  await signIn(page, EMPLOYEE);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /Leave/ }).filter({ hasText: "Leave" }).first()).toContainText("New decision on your leave");

  // A second request, a single day, which the admin declines with a note.
  await page.goto("/leave");
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Request leave" });
  const friday = new Date(week.monday.getTime() + 4 * 86_400_000);
  await pickDates(sheet, week.monthsAhead, week.label(friday), week.label(friday));
  await sheet.getByRole("button", { name: "Request 1 day of annual leave" }).click();
  await expect(page.getByText(/^Sent to your admin/)).toBeVisible();
  await signOut(page);

  await signIn(page, ADMIN);
  const card = page.getByRole("article").filter({ hasText: "Sonam Wangmo" });
  await card.getByRole("button", { name: "Add a note" }).click();
  await card.getByLabel(/Note for Sonam/).fill("We need you for the launch that day");
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Sonam’s leave is declined.")).toBeVisible();
  await signOut(page);

  await signIn(page, EMPLOYEE);
  await page.goto("/leave");
  await page.getByRole("button", { name: /Annual leave.*Declined/ }).click();
  await expect(page.getByText("We need you for the launch that day")).toBeVisible();
});

test("an employee cancels a pending request, and can undo the cancel", async ({ page }, testInfo) => {
  const week = weekAhead(offsetFor(testInfo.project.name));
  await signIn(page, EMPLOYEE);
  await page.goto("/leave");
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Request leave" });
  const nextMonday = new Date(week.monday.getTime() + 7 * 86_400_000);
  await pickDates(sheet, week.monthsAhead, week.label(nextMonday), week.label(nextMonday));
  await sheet.getByRole("button", { name: "Request 1 day of annual leave" }).click();
  await expect(page.getByText(/^Sent to your admin/)).toBeVisible();

  await page.getByRole("button", { name: /Annual leave.*Waiting for approval/ }).click();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Leave cancelled.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Annual leave.*Waiting for approval/ })).toHaveCount(0);
  // Undo the cancel itself (the earlier "Sent" toast may still be showing too).
  await page.locator("[data-sonner-toast]").filter({ hasText: "Leave cancelled." }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Annual leave.*Waiting for approval/ })).toBeVisible();
});

test("a holiday inside a request is not counted", async ({ page }, testInfo) => {
  const week = weekAhead(holidayOffsetFor(testInfo.project.name));
  const name = `Test holiday ${testInfo.project.name}`;
  // Clear anything an interrupted earlier run left behind.
  await db`delete from public.holidays where name = ${name}`;
  await signIn(page, ADMIN);
  await page.goto(`/admin/calendar/holidays?year=${week.tuesday.getUTCFullYear()}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add holiday" }).click();
  const sheet0 = page.getByRole("dialog", { name: "Add a holiday" });
  await sheet0.getByLabel("Name").fill(name);
  await sheet0.getByLabel("First day").fill(week.iso(week.tuesday));
  await sheet0.getByLabel("Source").fill("Declared for the test");
  await sheet0.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByText(`${name} added.`)).toBeVisible();
  await signOut(page);

  await signIn(page, EMPLOYEE);
  await page.goto("/leave");
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Request leave" });
  await pickDates(sheet, week.monthsAhead, week.label(week.monday), week.label(week.wednesday));
  // Monday to Wednesday with Tuesday a holiday: 2 days, not 3.
  await expect(sheet.getByText(/· 2 days$/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Request 2 days of annual leave" })).toBeVisible();
  await db`delete from public.holidays where name = ${`Test holiday ${testInfo.project.name}`}`;
});

test("Who's out shows names and dates to everyone, and the kind of leave only to admins", async ({ page }, testInfo) => {
  const week = weekAhead(offsetFor(testInfo.project.name));
  const month = week.iso(week.monday).slice(0, 7);
  const [pema] = await db`insert into public.people (full_name, email, start_date)
                          values ('Pema Choden', ${`pema.${testInfo.project.name}.${Date.now()}@dashteam.local`}, '2025-01-06') returning id`;
  await db`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status)
           values (${pema?.id}, 'sick', ${week.iso(week.tuesday)}, ${week.iso(week.tuesday)}, 'approved')`;

  await signIn(page, EMPLOYEE);
  await page.goto(`/leave?month=${month}`);
  const out = page.getByRole("region", { name: /Who’s out/ });
  await expect(out).toContainText("Pema Choden");
  await expect(out).not.toContainText("Sick leave");
  await signOut(page);

  await signIn(page, ADMIN);
  await page.goto(`/admin/calendar?month=${month}`);
  await expect(page.getByRole("region", { name: /Who’s out/ })).toContainText("Pema Choden · Sick leave");
  await expectNoSideways(page);
  await testInfo.attach("calendar", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await db`delete from public.people where id = ${pema?.id}`;
});

test("leave taken beyond the entitlement at exit becomes a suggestion the admin accepts", async ({ page }, testInfo) => {
  // Left on 14 October 2026 (October doesn't count): 9 months → 19 days; 21 taken → 2 over.
  const [person] = await db`insert into public.people (full_name, email, start_date, end_date)
                            values ('Dorji Leaving', ${`dorji.${testInfo.project.name}.${Date.now()}@dashteam.local`}, '2025-03-03', '2026-10-14') returning id`;
  await db`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
           values (${person?.id}, '2025-03-01', 'full_time', 3000000, 600000)`;
  await db`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status)
           values (${person?.id}, 'annual', '2026-08-03', '2026-08-31', 'approved')`; // 21 working days, no holidays in August

  await signIn(page, ADMIN);
  await page.goto(`/admin/people/${person?.id}`);
  await expect(page.getByText("Suggested recovery: 2 days × Nu. 1,161.29 =")).toBeVisible();
  await expect(page.getByText("Nu. 2,323", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accept suggestion" }).click();
  await expect(page.getByText(/recovery in their final payroll/)).toBeVisible();
  const [entry] = await db`select action from public.audit_log where entity_table = 'exit_leave_settlements' and after ->> 'person_id' = ${person?.id ?? ""}`;
  expect(entry?.action).toBe("exit_leave.accepted");
  await db`delete from public.people where id = ${person?.id}`;
});
