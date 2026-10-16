import { expect, type Page, test } from "@playwright/test";
import { db, signIn } from "../e2e/helpers";

// A ready-to-click demo of the month-end loop, built through the app's own screens so pay, TPNs and
// bank details are encrypted, audited and worked out exactly as in real use. Run with `pnpm demo`,
// which resets the local database first. Never runs with the test suite.
//
//   September 2026  locked: payslips issued and emailed (to Mailpit), IT-1(a) made, TDS due 10 Oct
//   October 2026    the open draft, with a leave request waiting on the admin's Home
//
// Sign in as admin@dashteam.local (the founder) or employee@dashteam.local (Sonam). Codes arrive in
// Mailpit: http://127.0.0.1:54324

const SONAM = "33333333-3333-4333-8333-333333333333";

type NewPerson = { name: string; email: string; start: string; tpn: string; bank: string; account: string; pay: { basic: string; allowance: string } | { stipend: string } };

const TEAM: NewPerson[] = [
  { name: "Karma Wangchuk", email: "karma@xceed.studio", start: "2025-02-03", tpn: "KWA2025001", bank: "Bank of Bhutan", account: "200111222333", pay: { basic: "50,000", allowance: "10,000" } },
  { name: "Tshering Dorji", email: "tshering@xceed.studio", start: "2024-08-05", tpn: "TDO2024017", bank: "Bhutan National Bank", account: "110200300400", pay: { basic: "60,000", allowance: "10,000" } },
  { name: "Ugyen Tenzin", email: "ugyen@xceed.studio", start: "2025-11-03", tpn: "UTE2025044", bank: "T Bank", account: "300400500600", pay: { basic: "35,000", allowance: "3,000" } },
  { name: "Dechen Lhamo", email: "dechen@xceed.studio", start: "2026-06-01", tpn: "DLH2026008", bank: "Druk PNB Bank", account: "400500600700", pay: { stipend: "20,000" } },
  // Joins mid-September, so September is paid for 16 of 30 days.
  { name: "Pema Choden", email: "pema@xceed.studio", start: "2026-09-15", tpn: "PCH2026031", bank: "Bank of Bhutan", account: "200333444555", pay: { basic: "40,000", allowance: "5,000" } },
];

async function addPerson(page: Page, person: NewPerson): Promise<string> {
  await page.goto("/admin/people/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Full name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Start date").fill(person.start);
  await page.getByLabel("Bank", { exact: true }).selectOption(person.bank);
  await page.getByLabel("Account number").fill(person.account);
  await page.getByLabel("TPN").fill(person.tpn);
  if ("stipend" in person.pay) {
    await page.getByText("Intern", { exact: true }).click();
    await page.getByLabel("Stipend (Nu.)").fill(person.pay.stipend);
  } else {
    await page.getByLabel("Basic pay (Nu.)").fill(person.pay.basic);
    await page.getByLabel("Allowance (Nu.)").fill(person.pay.allowance);
  }
  await page.getByRole("button", { name: `Add ${person.name}` }).click();
  await expect(page).toHaveURL(/\/admin\/people\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() ?? "";
}

test("set up the demo", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@dashteam.local");

  // ── The team ──
  const ids: Record<string, string> = {};
  for (const person of TEAM) ids[person.name] = await addPerson(page, person);

  // Sonam (the seeded employee) gets her TPN and bank details, through Edit details.
  await page.goto(`/admin/people/${SONAM}/edit`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Bank", { exact: true }).selectOption("Bank of Bhutan");
  await page.getByLabel("Account number").fill("200444555666");
  await page.getByLabel("TPN").fill("SWA2025012");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/people/${SONAM}$`));

  // Tshering left on 20 September: paid for 20 of 30 days.
  await page.goto(`/admin/people/${ids["Tshering Dorji"]}/exit`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Last working day").fill("2026-09-20");
  await page.getByRole("button", { name: /^Mark Tshering as left on/ }).click();
  await expect(page).toHaveURL(/\/admin\/people\/[0-9a-f-]{36}$/);

  // Sonam took two days of unpaid leave in September (already approved).
  await db`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by, decided_by, decided_at, note)
           values (${SONAM}, 'unpaid', '2026-09-07', '2026-09-08', 'approved', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', now(), 'Family matter')`;

  // ── September: first payroll month ──
  await page.goto("/admin/payroll");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First payroll month").selectOption("2026-09");
  await page.getByRole("button", { name: "Start with September 2026" }).click();
  await expect(page).toHaveURL(/\/admin\/payroll\/2026-09$/);
  await page.waitForLoadState("networkidle");

  // Karma: a September increment paid as an arrear, and the first of three advance recoveries.
  for (const line of [
    { kind: "arrear", amount: "5,000", note: "August increment" },
    { kind: "advance_recovery", amount: "3,000", note: "Advance, 1 of 3" },
  ]) {
    await page.getByRole("button", { name: /^Karma Wangchuk/ }).click();
    const sheet = page.getByRole("dialog", { name: "Karma Wangchuk" });
    await sheet.getByLabel("Type").selectOption(line.kind);
    await sheet.getByLabel("Amount (Nu.)").fill(line.amount);
    await sheet.getByLabel("Note (optional)").fill(line.note);
    await sheet.getByRole("button", { name: /^Add / }).click();
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(500);
  }

  // Look at each check, then lock September with the hold.
  const acknowledge = page.getByRole("button", { name: "Acknowledge" });
  for (let i = 0; i < 30 && (await acknowledge.count()) > 0; i += 1) {
    const before = await acknowledge.count();
    await acknowledge.first().click();
    await expect(acknowledge).toHaveCount(before - 1);
  }
  await page.goto("/admin/payroll/2026-09/lock");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Hold to lock September" }).focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(1_800);
  await page.keyboard.up("Space");
  await expect(page).toHaveURL(/\/admin\/payroll\/2026-09$/);

  // Payslips and the IT-1(a) are made just after the lock.
  await expect.poll(async () => (await db`select count(*)::int as n from public.it1a_schedules`)[0]?.n, { timeout: 60_000 }).toBe(1);
  await expect.poll(async () => (await db`select count(*)::int as n from public.email_deliveries where status = 'sent'`)[0]?.n, { timeout: 60_000 }).toBe(6);

  // ── October: the open month ──
  // Sonam has asked for annual leave at the end of October, waiting on the admin.
  await db`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by, note)
           values (${SONAM}, 'annual', '2026-10-26', '2026-10-28', 'pending', '22222222-2222-4222-8222-222222222222', 'Visiting family in Bumthang')`;
});
