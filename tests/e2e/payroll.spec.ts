import { expect, type Page, test } from "@playwright/test";
import { db, expectNoSideways, signIn, signOut } from "./helpers";
import * as XLSX from "xlsx";
import { emailDetail, emailsTo, waitForEmails } from "./mailpit";
import { FILING_TODAY, NEXT_REMINDER_DAY, NOT_A_REMINDER_DAY, TEST_CRON_SECRET } from "./test-clock";

// Milestone 4 end to end: set the first month, review everyone, adjust one-offs inline with Undo,
// clear and acknowledge the checks, hold to lock, read the locked month and its bank list, and see
// a change inside the locked month refused with words that say what to do instead.

const ADMIN = "admin@dashteam.local";
const EMPLOYEE = "employee@dashteam.local";
const SONAM = "33333333-3333-4333-8333-333333333333";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// This month in Thimphu: the month each run sets as the first, and locks.
const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(new Date()));
const YEAR = today.getUTCFullYear();
const MONTH = today.getUTCMonth();
const NAME = MONTHS[MONTH] ?? "";
const KEY = `${YEAR}-${String(MONTH + 1).padStart(2, "0")}`;
const FIRST_DAY = `${KEY}-01`;

const nu = (text: string) => Math.round(Number(text.replace("Nu. ", "").replace(/,/g, "")) * 100);
const money = (chhertum: number) => {
  const whole = String(Math.floor(chhertum / 100));
  const grouped = whole.length <= 3 ? whole : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}`;
  return `Nu. ${grouped}${chhertum % 100 ? `.${String(chhertum % 100).padStart(2, "0")}` : ""}`;
};

/**
 * A locked month is permanent by design, even for the database owner, so the only way to run this
 * again is to switch triggers off for one transaction. That works on the local test database only;
 * it is here so the spec can repeat, not something the app can do.
 */
async function clearPayroll() {
  await db.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from public.filing_reminders`;
    await tx`update public.filings set receipt_id = null`;
    await tx`delete from public.filings`;
    await tx`delete from public.filing_receipts`;
    await tx`delete from public.it1a_schedules`;
    await tx`delete from public.email_deliveries where payslip_id is not null`;
    await tx`delete from public.payslips`;
    await tx`delete from public.payroll_snapshots`;
    await tx`delete from public.payroll_runs`;
    await tx`delete from public.payroll_lines`;
    await tx`delete from public.payroll_acknowledgements`;
    await tx`delete from public.rules where key = 'payroll_settings' and effective_from > '2026-01-01'`;
  });
  await db`delete from public.people where email like 'nopay.%@dashteam.local' or email like 'bounce.%'`;
}

// Someone paid this month whose payslip email fails at first (the local Mailpit route refuses this
// domain on purpose), so the spec can see a failure, fix it and try again.
let BOUNCE = "";
let BOUNCE_FIXED = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({}, testInfo) => {
  await clearPayroll();
  const stamp = `${testInfo.project.name}.${Date.now()}`;
  BOUNCE = `bounce.${stamp}@fail.dashteam.local`;
  BOUNCE_FIXED = `bounce.${stamp}@dashteam.local`;
  const [person] = await db<{ id: string }[]>`insert into public.people (full_name, email, start_date) values ('Ugyen Bounce', ${BOUNCE}, '2026-01-05') returning id`;
  await db`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch) values (${person?.id ?? ""}, '2026-01-01', 'full_time', 3000000, 0)`;
});
test.afterAll(clearPayroll);

async function openSonam(page: Page) {
  await page.getByRole("button", { name: /^Sonam Wangmo/ }).click();
  const sheet = page.getByRole("dialog", { name: "Sonam Wangmo" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("an admin sets the first month and sees everyone worked out", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto("/admin/payroll");
  await expect(page.getByRole("heading", { name: "Which month does DashTeam pay first?" })).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("first-month", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.getByRole("button", { name: `Start with ${NAME} ${YEAR}` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/payroll/${KEY}$`));
  await expect(page.getByText(`DashTeam pays from ${NAME} ${YEAR}.`)).toBeVisible();
  await expect(page.getByRole("heading", { name: `${NAME} ${YEAR}`, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sonam Wangmo/ })).toBeVisible();
  // The one primary action.
  await expect(page.getByRole("link", { name: `Lock ${NAME} payroll` })).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("draft", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("one-offs are added inline, undone, and an advance recovery leaves TDS and HC alone", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  await page.waitForLoadState("networkidle");
  let sheet = await openSonam(page);

  // An arrear: the sheet closes, the row shows it, and Undo takes it back.
  await sheet.getByLabel("Type").selectOption("arrear");
  await sheet.getByLabel("Amount (Nu.)").fill("5,000");
  await sheet.getByLabel("Note (optional)").fill("September increment");
  await sheet.getByRole("button", { name: "Add arrear of Nu. 5,000" }).click();
  await expect(page.getByText(/^Arrear of Nu\. 5,000 added\. Sonam’s take-home is now Nu\. [\d,]+\.$/)).toBeVisible();
  await expect(sheet).toBeHidden();
  const sonamRow = page.getByRole("button", { name: /^Sonam Wangmo/ });
  await expect(page.getByText("1 one-off").filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await expect(page.getByText("1 one-off")).toHaveCount(0);
  await expect(sonamRow).toBeVisible();

  // An advance recovery: the take-home shown before sending is exactly 2,000 less, and TDS and HC don't move.
  sheet = await openSonam(page);
  const row = (label: string) => sheet.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}`) }) }).locator("dd");
  const tdsBefore = await row("TDS").textContent();
  const hcBefore = await row("Health contribution").textContent();
  await sheet.getByLabel("Type").selectOption("advance_recovery");
  await sheet.getByLabel("Amount (Nu.)").fill("2,000");
  const preview = sheet.getByText(/^Take-home Nu\. [\d,]+ \(now Nu\. [\d,]+\)$/);
  await expect(preview).toBeVisible();
  const [after, now] = ((await preview.textContent()) ?? "").match(/Nu\. [\d,]+/g)?.map(nu) ?? [];
  expect((now ?? 0) - (after ?? 0)).toBe(200_000);
  await testInfo.attach("person-sheet", { body: await page.screenshot(), contentType: "image/png" });

  // A recovery larger than take-home is refused before it's sent.
  await sheet.getByLabel("Amount (Nu.)").fill("10,00,000");
  await expect(sheet.getByText("That’s more than Sonam’s take-home this month. Recover the rest next month.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add advance recovery/ })).toBeDisabled();

  await sheet.getByLabel("Amount (Nu.)").fill("2,000");
  await sheet.getByRole("button", { name: "Add advance recovery of Nu. 2,000" }).click();
  await expect(page.getByText(/^Advance recovery of Nu\. 2,000 added\./)).toBeVisible();
  await expect(page.getByText("1 one-off").filter({ visible: true })).toBeVisible();
  sheet = await openSonam(page);
  await expect(row("Advance recovery")).toContainText("2,000");
  expect(await row("TDS").textContent()).toBe(tdsBefore);
  expect(await row("Health contribution").textContent()).toBe(hcBefore);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("a check that must be cleared blocks the lock; the rest are acknowledged", async ({ page }, testInfo) => {
  // Someone employed this month with no pay at all.
  const [nopay] = await db<{ id: string }[]>`
    insert into public.people (full_name, email, start_date) values ('Nima Nopay', ${`nopay.${Date.now()}@dashteam.local`}, ${FIRST_DAY}) returning id`;
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  await expect(page.getByText(`Nima has no pay for ${NAME}`)).toBeVisible();
  await page.goto(`/admin/payroll/${KEY}/lock`);
  await expect(page.getByText(/still needs? you before/)).toBeVisible();
  await expect(page.getByRole("button", { name: `Hold to lock ${NAME}` })).toHaveCount(0);
  await testInfo.attach("lock-blocked", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await db`delete from public.people where id = ${nopay?.id ?? ""}`;

  await page.goto(`/admin/payroll/${KEY}`);
  await page.waitForLoadState("networkidle");
  const acknowledge = page.getByRole("button", { name: "Acknowledge" });
  for (let i = 0; i < 60 && (await acknowledge.count()) > 0; i += 1) {
    const before = await acknowledge.count();
    await acknowledge.first().click();
    await expect(acknowledge).toHaveCount(before - 1);
  }
  await expect(acknowledge).toHaveCount(0);
});

test("holding locks the month; letting go early doesn't", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}/lock`);
  await page.waitForLoadState("networkidle");
  const hold = page.getByRole("button", { name: `Hold to lock ${NAME}` });
  await expect(hold).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("lock-review", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // Let go after half a second: nothing happens.
  const box = await hold.boundingBox();
  if (!box) throw new Error("no button");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(new RegExp(`/lock$`));
  expect(await db`select id from public.payroll_runs where month = ${FIRST_DAY} and status = 'locked'`).toHaveLength(0);

  // Hold it: with the keyboard on a laptop, by pointer on a phone.
  if (testInfo.project.name === "desktop") {
    await hold.focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(1_800);
    await page.keyboard.up("Space");
  } else {
    await page.mouse.down();
    await page.waitForTimeout(1_800);
    await page.mouse.up();
  }
  await expect(page).toHaveURL(new RegExp(`/admin/payroll/${KEY}$`));
  await expect(page.getByText(`${NAME} payroll is locked.`)).toBeVisible();
  await expect(page.getByText(/^Locked on /)).toBeVisible();
});

test("locking makes a payslip for everyone and emails each person once", async ({ page }, testInfo) => {
  const lockedAt = await db<{ locked_at: Date }[]>`select locked_at from public.payroll_runs where month = ${FIRST_DAY} and status = 'locked'`;
  const since = new Date((lockedAt[0]?.locked_at ?? new Date()).getTime() - 2_000);
  const subject = `Your ${NAME} ${YEAR} payslip`;

  // A payslip for every snapshot, made from it.
  await expect
    .poll(async () => (await db`select count(*)::int as n from public.payslips p join public.payroll_runs r on r.id = p.run_id where r.month = ${FIRST_DAY}`)[0]?.n, { timeout: 20_000 })
    .toBe((await db`select count(*)::int as n from public.payroll_snapshots s join public.payroll_runs r on r.id = s.run_id where r.month = ${FIRST_DAY}`)[0]?.n);

  // Sonam's arrives once, with the PDF attached.
  const sonam = await waitForEmails("employee@dashteam.local", since, subject);
  expect(sonam).toHaveLength(1);
  const detail = await emailDetail(sonam[0]?.ID ?? "");
  expect(detail.Text).toContain("payslip for");
  expect(detail.Attachments).toEqual([expect.objectContaining({ FileName: `Payslip ${NAME} ${YEAR}.pdf`, ContentType: "application/pdf" })]);

  // The admin sees who doesn't have it yet; the failure leaves the month locked.
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  const needsYou = page.getByRole("list", { name: "Payslips that need you" });
  const bounceRow = needsYou.getByRole("listitem").filter({ hasText: "Ugyen Bounce" });
  await expect(bounceRow).toContainText("couldn’t send to this address", { timeout: 20_000 });
  await expect(needsYou.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText(/emailed\. 1 needs you\./)).toBeVisible();
  expect(await db`select id from public.payroll_runs where month = ${FIRST_DAY} and status = 'locked'`).toHaveLength(1);
  await expectNoSideways(page);
  await testInfo.attach("payslip-status", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // Fix their email and try again: they get exactly one, and nobody else gets a second.
  await db`update public.people set email = ${BOUNCE_FIXED} where email = ${BOUNCE}`;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/^Emailed to all \d+ people\.$/)).toBeVisible({ timeout: 20_000 });
  await expect(needsYou).toHaveCount(0);
  expect(await waitForEmails(BOUNCE_FIXED, since, subject)).toHaveLength(1);
  expect(await waitForEmails("employee@dashteam.local", since, subject, 2, 2_000)).toHaveLength(1);

  // Sending it again, on purpose, sends exactly one more.
  await page.getByRole("button", { name: /^Sonam Wangmo/ }).click();
  const sheet = page.getByRole("dialog", { name: `${NAME} ${YEAR}, Sonam Wangmo` });
  await expect(sheet.getByText("Take-home")).toBeVisible();
  await sheet.getByRole("button", { name: "Send it again" }).click();
  await expect(page.getByText("Sent to employee@dashteam.local.")).toBeVisible();
  expect(await waitForEmails("employee@dashteam.local", since, subject, 2)).toHaveLength(2);
});

test("an employee opens and downloads their payslip in two taps, and can't open anyone else's", async ({ page }, testInfo) => {
  // The admin's link to someone else's payslip, to try as the employee.
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  await page.getByRole("button", { name: /^Ugyen Bounce/ }).click();
  const adminSheet = page.getByRole("dialog", { name: /Ugyen Bounce/ });
  const download = adminSheet.getByRole("link", { name: "Download PDF" });
  await expect(download).toHaveAttribute("href", /^\/payslips\/file\//);
  const othersLink = (await download.getAttribute("href")) ?? "";
  const asAdmin = await page.request.get(othersLink);
  expect(asAdmin.headers()["content-type"]).toBe("application/pdf");
  await signOut(page);

  await signIn(page, EMPLOYEE);
  // Home shows the latest payslip.
  const latest = page.getByRole("link", { name: new RegExp(`${NAME} ${YEAR}`) });
  await expect(latest).toBeVisible();
  await page.goto("/payslips");
  await page.waitForLoadState("networkidle");
  // Tap one: the month. Tap two: Download PDF.
  await page.getByRole("button", { name: new RegExp(`^${NAME}`) }).click();
  const sheet = page.getByRole("dialog", { name: `${NAME} ${YEAR}` });
  await expect(sheet.getByText("Take-home").first()).toBeVisible();
  const own = sheet.getByRole("link", { name: "Download PDF" });
  await expect(own).toHaveAttribute("href", /^\/payslips\/file\//);
  const pdf = await page.request.get((await own.getAttribute("href")) ?? "");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expectNoSideways(page);
  await testInfo.attach("employee-payslip", { body: await page.screenshot(), contentType: "image/png" });

  // Email it to me.
  const since = new Date(Date.now() - 2_000);
  await sheet.getByRole("button", { name: "Email it to me" }).click();
  await expect(page.getByText("Sent to employee@dashteam.local.")).toBeVisible();
  const mine = await waitForEmails("employee@dashteam.local", since, `Your ${NAME} ${YEAR} payslip`);
  expect((await emailDetail(mine[0]?.ID ?? "")).Text).toContain("as you asked");

  // Someone else's link, or a made-up one, gets the same refusal.
  for (const link of [othersLink, "/payslips/file/not-a-real-link"]) {
    await page.goto(link);
    await expect(page).toHaveURL(/\/payslips\/unavailable$/);
    await expect(page.getByText("This link has expired or isn’t yours")).toBeVisible();
  }
});

test("the locked month and its bank list match the snapshot", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  const snapshots = await db<{ full_name: string; take_home_ch: string }[]>`
    select s.full_name, s.take_home_ch::text from public.payroll_snapshots s join public.payroll_runs r on r.id = s.run_id
    where r.month = ${FIRST_DAY} order by s.full_name`;
  expect(snapshots.length).toBeGreaterThan(0);
  const sonam = snapshots.find((s) => s.full_name === "Sonam Wangmo");
  await expect(page.getByRole("button", { name: /^Sonam Wangmo/ })).toBeVisible();
  // Laptop: the table row; phone: the list row. Either shows the locked take-home.
  await expect(page.getByText(money(Number(sonam?.take_home_ch ?? 0))).filter({ visible: true }).first()).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("locked", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  const link = page.getByRole("link", { name: "Download bank list" });
  await expect(link).toHaveAttribute("href", `/admin/payroll/${KEY}/bank-list`);
  const [beforeRow] = await db<{ count: number }[]>`
    select count(*)::int as count from public.audit_log where action = 'payroll.bank_list_downloaded' and after ->> 'month' = ${FIRST_DAY}`;
  const response = await page.request.get(`/admin/payroll/${KEY}/bank-list`);
  expect(response.headers()["content-disposition"]).toContain(`dashteam-bank-list-${KEY}.csv`);
  const lines = (await response.text()).trim().split("\r\n");
  expect(lines[0]).toBe("Name,Bank,Account number,Amount (Nu.)");
  expect(lines).toHaveLength(snapshots.length + 1);
  for (const snapshot of snapshots) {
    const amount = Number(snapshot.take_home_ch);
    expect(lines.some((line) => line.startsWith(snapshot.full_name) && line.endsWith(`,${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`))).toBe(true);
  }
  const [afterRow] = await db<{ count: number }[]>`
    select count(*)::int as count from public.audit_log where action = 'payroll.bank_list_downloaded' and after ->> 'month' = ${FIRST_DAY}`;
  expect(afterRow?.count).toBe((beforeRow?.count ?? 0) + 1);
});

test("a change inside the locked month is refused, saying what to do instead", async ({ page }, testInfo) => {
  // The admin can't add a one-off to the locked month any more: it's read-only.
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  await page.getByRole("button", { name: /^Sonam Wangmo/ }).click();
  const sheet = page.getByRole("dialog", { name: `${NAME} ${YEAR}, Sonam Wangmo` });
  await expect(sheet.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await expect(sheet.getByLabel("Amount (Nu.)")).toHaveCount(0);
  await signOut(page);

  // An employee asking for leave in the locked month is told before anything is sent.
  await signIn(page, EMPLOYEE);
  await page.goto("/leave");
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const request = page.getByRole("dialog", { name: "Request leave" });
  const first = new Date(Date.UTC(YEAR, MONTH, 1));
  while (first.getUTCDay() !== 1) first.setUTCDate(first.getUTCDate() + 1);
  const second = new Date(first.getTime() + 86_400_000);
  const label = (date: Date) => `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  await request.getByRole("button", { name: new RegExp(`^${label(first)}`) }).click();
  await request.getByRole("button", { name: new RegExp(`^${label(second)}`) }).click();
  await expect(request.getByText(`${NAME} payroll is locked. Ask your admin to add a correction.`)).toBeVisible();
  await expect(request.getByRole("button", { name: /^Request/ })).toBeDisabled();
  await testInfo.attach("leave-refused", { body: await page.screenshot(), contentType: "image/png" });

  // And the database refuses it whatever the screen does.
  await expect(
    db`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
       values (${SONAM}, 'annual', ${first.toISOString().slice(0, 10)}, ${second.toISOString().slice(0, 10)}, 'pending', '22222222-2222-4222-8222-222222222222')`,
  ).rejects.toThrow(new RegExp(`${NAME} ${YEAR} payroll is locked`));
});

// ── Milestone 6: the IT-1(a), filing, and reminders ────────────────────────────────

const cron = (page: Page, options: { secret?: string; today?: string } = {}) =>
  page.request.post(`/api/cron/filing-reminders${options.today ? `?today=${options.today}` : ""}`, {
    headers: options.secret === undefined ? { authorization: `Bearer ${TEST_CRON_SECRET}` } : options.secret ? { authorization: `Bearer ${options.secret}` } : {},
  });

test("the IT-1(a) is ready after lock, and its file matches the snapshot", async ({ page }, testInfo) => {
  await expect
    .poll(async () => (await db`select count(*)::int as n from public.it1a_schedules s join public.payroll_runs r on r.id = s.run_id where r.month = ${FIRST_DAY}`)[0]?.n, { timeout: 20_000 })
    .toBe(1);
  await signIn(page, ADMIN);
  // The home says how long is left (the test plays the 5th of next month: due on the 10th).
  const card = page.getByRole("link", { name: new RegExp(`^${NAME} TDS`) });
  await expect(card).toContainText("due in 5 days");
  await expectNoSideways(page);
  await testInfo.attach("home-due", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/admin/payroll/${KEY}/filing$`));
  await expect(page.getByText("Ready to file. Due in 5 days.")).toBeVisible();
  const [run] = await db<{ remit_ch: string }[]>`select remit_ch::text from public.payroll_runs where month = ${FIRST_DAY}`;
  await expect(page.getByText(money(Number(run?.remit_ch ?? 0))).first()).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("filing", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // The upload file: DRC's template, one row per person from row 4, every figure the snapshot's.
  await expect(page.getByRole("link", { name: "Download IT-1(a) file" })).toHaveAttribute("href", `/admin/payroll/${KEY}/filing/it1a`);
  const response = await page.request.get(`/admin/payroll/${KEY}/filing/it1a`);
  expect(response.headers()["content-type"]).toBe("application/vnd.ms-excel");
  const sheet = XLSX.read(await response.body(), { type: "buffer" }).Sheets.Sheet1 ?? {};
  expect([sheet.A1?.v, sheet.A2?.v, sheet.C3?.v, sheet.L3?.v]).toEqual(["FORM IT-1(a) MONTHLY SALARY SCHEDULE", "TName of Employee", "Basic Salary", "Total\n(8+9)"]);
  const snapshots = await db<{ full_name: string; gross_ch: string; tds_ch: string; health_contribution_ch: string }[]>`
    select s.full_name, s.gross_ch::text, s.tds_ch::text, s.health_contribution_ch::text
    from public.payroll_snapshots s join public.payroll_runs r on r.id = s.run_id where r.month = ${FIRST_DAY} order by s.full_name`;
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, range: 3 });
  expect(rows.map((row) => row[0])).toEqual(snapshots.map((s) => s.full_name));
  for (const [i, snapshot] of snapshots.entries()) {
    const row = rows[i] ?? [];
    expect([row[5], row[9], row[10]]).toEqual([Number(snapshot.gross_ch) / 100, Number(snapshot.tds_ch) / 100, Number(snapshot.health_contribution_ch) / 100]);
    expect(Number(row[2]) + Number(row[3]) + Number(row[4])).toBe(Number(snapshot.gross_ch) / 100);
  }
  const [audited] = await db`select count(*)::int as n from public.audit_log where action = 'filing.schedule_downloaded'`;
  expect(audited?.n).toBeGreaterThan(0);
});

test("the copy-ready screen copies plain numbers and keeps each tick", async ({ page, context }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}/filing/entry`);
  await page.waitForLoadState("networkidle");
  const people = (await db`select count(*)::int as n from public.payroll_snapshots s join public.payroll_runs r on r.id = s.run_id where r.month = ${FIRST_DAY}`)[0]?.n;
  await expect(page.getByText(`0 of ${people} entered`)).toBeVisible();

  const copy = page.getByRole("button", { name: /^Copy Sonam Wangmo’s Gross Salary/ }).filter({ visible: true });
  if (testInfo.project.name === "desktop") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d+(\.\d{2})?$/);
  } else {
    await copy.click();
  }
  await expect(copy).toContainText("Copied");

  await page.getByRole("checkbox", { name: "Sonam Wangmo entered" }).filter({ visible: true }).check();
  await expect(page.getByText(`1 of ${people} entered`)).toBeVisible();
  // The tick shows at once; wait for it to be saved before reloading.
  await expect
    .poll(async () => (await db`select f.entered from public.filings f join public.payroll_runs r on r.id = f.run_id where r.month = ${FIRST_DAY}`)[0]?.entered)
    .toContain("33333333-3333-4333-8333-333333333333");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Sonam Wangmo entered" }).filter({ visible: true })).toBeChecked();
  await expectNoSideways(page);
  await testInfo.attach("entry", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("the reminder job needs its secret, sends once a day, and only on reminder days", async ({ page }) => {
  expect((await cron(page, { secret: "" })).status()).toBe(401);
  expect((await cron(page, { secret: "wrong-secret-wrong-secret-wrong-secret" })).status()).toBe(401);
  expect((await page.request.get("/api/cron/filing-reminders", { headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } })).status()).toBe(405);

  const since = new Date(Date.now() - 2_000);
  const first = await cron(page);
  expect(await first.json()).toMatchObject({ sent: true, months: [KEY] });
  expect(await waitForEmails(ADMIN, since, `${NAME} TDS is due in 5 days`)).toHaveLength(1);
  expect(await (await cron(page)).json()).toEqual({ sent: false, reason: "already_sent_today" });
  expect(await (await cron(page, { today: NOT_A_REMINDER_DAY })).json()).toEqual({ sent: false, reason: "not_a_reminder_day" });
  expect((await emailsTo(ADMIN, since)).filter((m) => m.Subject.includes("TDS"))).toHaveLength(1);
});

test("marking the month filed, editing it with a receipt, and the history", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}/filing`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Mark as filed" }).click();
  const sheet = page.getByRole("dialog", { name: `Mark ${NAME} as filed` });
  await sheet.getByLabel("Payment reference").fill("PAY-123");
  await sheet.getByLabel("Acknowledgement number").fill("ACK-456");
  await testInfo.attach("mark-filed", { body: await page.screenshot(), contentType: "image/png" });
  await sheet.getByRole("button", { name: `Mark ${NAME} as filed` }).click();
  await expect(page.getByText(`${NAME} is marked as filed. Reminders stop.`)).toBeVisible();
  const filedOn = new Date(`${FILING_TODAY}T00:00:00Z`);
  const shortDate = `${filedOn.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][filedOn.getUTCMonth()]} ${filedOn.getUTCFullYear()}`;
  await expect(page.getByText(`Filed ${shortDate}`)).toBeVisible();

  // Edit: replace the reference and keep a receipt.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: `${NAME} filing` });
  await edit.getByLabel("Payment reference").fill("PAY-124");
  await edit.getByLabel("Receipt (optional)").setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 receipt") });
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByText("PAY-124")).toBeVisible();
  const receipt = await page.request.get(`/admin/payroll/${KEY}/filing/receipt`);
  expect(receipt.headers()["content-type"]).toBe("application/pdf");
  const actions = (await db`select action from public.audit_log where entity_table in ('filings', 'filing_receipts') order by id desc limit 6`).map((row) => row.action);
  expect(actions).toEqual(expect.arrayContaining(["filing.marked_filed", "filing.edited", "filing.receipt_added"]));

  // The history keeps it; the home stops asking; reminders stop.
  await page.goto("/admin/filing");
  await expect(page.getByRole("link", { name: new RegExp(`${NAME} ${YEAR}`) })).toContainText(`Filed ${shortDate.replace(/ \d{4}$/, "")}`);
  await expect(page.getByRole("link", { name: new RegExp(`${NAME} ${YEAR}`) })).toContainText("ACK-456");
  await expectNoSideways(page);
  await testInfo.attach("history", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: new RegExp(`^${NAME} TDS`) })).toHaveCount(0);
  expect(await (await cron(page, { today: NEXT_REMINDER_DAY })).json()).toEqual({ sent: false, reason: "nothing_to_file" });
});
