import { expect, type Page, test } from "@playwright/test";
import { db, expectNoSideways, signIn, signOut } from "./helpers";

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
    await tx`delete from public.payroll_snapshots`;
    await tx`delete from public.payroll_runs`;
    await tx`delete from public.payroll_lines`;
    await tx`delete from public.payroll_acknowledgements`;
    await tx`delete from public.rules where key = 'payroll_settings' and effective_from > '2026-01-01'`;
  });
  await db`delete from public.people where email like 'nopay.%@dashteam.local'`;
}

test.describe.configure({ mode: "serial" });
test.beforeAll(clearPayroll);
test.afterAll(clearPayroll);

async function openSonam(page: Page) {
  await page.getByRole("button", { name: /Sonam Wangmo/ }).click();
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
  await expect(page.getByRole("button", { name: /Sonam Wangmo/ })).toBeVisible();
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
  const sonamRow = page.getByRole("button", { name: /Sonam Wangmo/ });
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

test("the locked month and its bank list match the snapshot", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await page.goto(`/admin/payroll/${KEY}`);
  const snapshots = await db<{ full_name: string; take_home_ch: string }[]>`
    select s.full_name, s.take_home_ch::text from public.payroll_snapshots s join public.payroll_runs r on r.id = s.run_id
    where r.month = ${FIRST_DAY} order by s.full_name`;
  expect(snapshots.length).toBeGreaterThan(0);
  const sonam = snapshots.find((s) => s.full_name === "Sonam Wangmo");
  await expect(page.getByRole("button", { name: /Sonam Wangmo/ })).toBeVisible();
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
  await page.getByRole("button", { name: /Sonam Wangmo/ }).click();
  const sheet = page.getByRole("dialog", { name: "Sonam Wangmo" });
  await expect(sheet.getByText(`${NAME} is locked, so this can’t change.`)).toBeVisible();
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
