import { expect, type Page, test } from "@playwright/test";
import { db, expectNoSideways, signIn, signOut } from "./helpers";

// Milestone 2 end to end: adding people, their own profile, pay changes, change requests,
// undo, encryption at rest, and access ending. Runs on desktop and on phones in light and dark.

const ADMIN = "admin@dashteam.local";
const TPN = "TPN4815162342";
const ACCOUNT = "200300400500";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function nextMonthName() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(new Date());
  const month = Number(today.slice(5, 7));
  return months[month % 12] ?? "";
}

function yesterday() {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(date);
}

type Added = { id: string; name: string; email: string };

async function addPerson(page: Page, project: string, type: "full_time" | "intern"): Promise<Added> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const name = type === "intern" ? `Pema Intern ${stamp}` : `Karma Dema ${stamp}`;
  const email = `${type}.${project}.${stamp}@dashteam.local`;

  await page.goto("/admin/people/new");
  // Typing before the form has hydrated would be lost, so wait for the page to settle.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Start date").fill("2026-01-05");
  await page.getByLabel("Bank", { exact: true }).selectOption("Bank of Bhutan");
  await page.getByLabel("Account number").fill(ACCOUNT);
  await page.getByLabel("TPN").fill(TPN);
  if (type === "intern") {
    await page.getByText("Intern", { exact: true }).click();
    await expect(page.getByLabel("Basic pay (Nu.)")).toHaveCount(0);
    await page.getByLabel("Stipend (Nu.)").fill("20,000");
  } else {
    await page.getByLabel("Basic pay (Nu.)").fill("40,000");
    await page.getByLabel("Allowance (Nu.)").fill("5,000");
  }
  await expect(page.getByText(/Take-home about/)).toBeVisible();
  await page.getByRole("button", { name: `Add ${name}` }).click();
  await expect(page).toHaveURL(/\/admin\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const id = page.url().split("/").pop() ?? "";
  return { id, name, email };
}

test.describe.configure({ mode: "serial" });

let fullTime: Added;
let intern: Added;

test("an admin adds a full-time employee and an intern, each with the right pay", async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);

  fullTime = await addPerson(page, testInfo.project.name, "full_time");
  await expect(page.getByText(/^Full-time · since/)).toBeVisible();
  await expect(page.getByText("Nu. 40,000", { exact: true })).toBeVisible();
  await expect(page.getByText("Nu. 5,000", { exact: true })).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("person", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  intern = await addPerson(page, testInfo.project.name, "intern");
  await expect(page.getByText(/^Intern · since/)).toBeVisible();
  await expect(page.getByText("Stipend")).toBeVisible();
  await expect(page.getByText("Nu. 20,000", { exact: true })).toBeVisible();

  await page.goto("/admin/people");
  await expect(page.getByRole("link", { name: new RegExp(fullTime.name) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(intern.name) })).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("people", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("TPN and bank account are encrypted at rest, masked on screen, and shown only on request", async ({ page }) => {
  const [row] = await db`select tpn_ciphertext, bank_account_ciphertext, tpn_last4 from public.people where id = ${fullTime.id}`;
  expect(row?.tpn_ciphertext).toMatch(/^v1:/);
  expect(row?.tpn_ciphertext).not.toContain(TPN);
  expect(row?.bank_account_ciphertext).not.toContain(ACCOUNT);
  expect(row?.tpn_last4).toBe(TPN.slice(-4));
  const leaks = await db`select id from public.audit_log where entity_id = ${fullTime.id}
                         and (coalesce(before::text, '') || coalesce(after::text, '')) like ${`%${TPN}%`}`;
  expect(leaks).toHaveLength(0);

  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
  const response = await page.goto(`/admin/people/${fullTime.id}`);
  expect(await response?.text()).not.toContain(TPN);
  await expect(page.getByText(`••••${TPN.slice(-4)}`)).toBeVisible();
  await page.getByRole("button", { name: "Show TPN" }).click();
  await expect(page.getByText(TPN)).toBeVisible();
  const [reveal] = await db`select action from public.audit_log where entity_id = ${fullTime.id} and action = 'sensitive.revealed'`;
  expect(reveal?.action).toBe("sensitive.revealed");
});

test("a new person signs in and sees only their own profile", async ({ page }, testInfo) => {
  await signIn(page, fullTime.email);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Hello, Karma" })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: fullTime.name })).toBeVisible();
  await expect(page.getByRole("main").getByText(fullTime.email)).toBeVisible();
  await expect(page.getByText("Nu. 40,000", { exact: true })).toBeVisible();
  await expectNoSideways(page);
  await testInfo.attach("profile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // Typing admin addresses: redirected home, nothing about anyone else.
  for (const path of ["/admin", "/admin/people", `/admin/people/${intern.id}`]) {
    const response = await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    expect(await response?.text()).not.toContain(intern.name);
  }
});

test("a pay change dated next month leaves this month's pay unchanged", async ({ page }) => {
  const month = nextMonthName();
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/people/${fullTime.id}/pay`);
  await page.getByLabel("Basic pay (Nu.)").fill("44,000");
  await expect(page.getByText(/now Nu\./)).toBeVisible();
  await page.getByRole("button", { name: `Change pay from ${month}` }).click();

  await expect(page).toHaveURL(new RegExp(`/admin/people/${fullTime.id}$`));
  await expect(page.getByText("Nu. 40,000", { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`^From ${month}`))).toBeVisible();
  await expect(page.getByText("Nu. 49,000", { exact: true })).toBeVisible();

  // Undo straight from the toast takes the change back out.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await expect(page.getByText(new RegExp(`^From ${month}`))).toHaveCount(0);
});

test("a change request reaches the admin, and approving it updates the record and the audit log", async ({ page }, testInfo) => {
  await signIn(page, fullTime.email);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Request a change" }).click();
  const sheet = page.getByRole("dialog", { name: "Request a change" });
  await sheet.getByLabel("Phone").fill("17 44 55 66");
  await testInfo.attach("request-sheet", { body: await page.screenshot(), contentType: "image/png" });
  await sheet.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Sent to your admin.")).toBeVisible();
  await expect(page.getByText("Waiting for approval", { exact: false })).toBeVisible();
  await signOut(page);

  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
  const card = page.getByRole("article").filter({ hasText: fullTime.name });
  await expect(card).toContainText("17 44 55 66");
  await testInfo.attach("needs-you", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/new details are saved/)).toBeVisible();
  await expect(card).toHaveCount(0);

  await page.goto(`/admin/people/${fullTime.id}`);
  await expect(page.getByText("17 44 55 66")).toBeVisible();
  const [entry] = await db`select actor_id from public.audit_log where entity_id = ${fullTime.id} and action = 'profile_change.approved'`;
  expect(entry?.actor_id).toBeTruthy();
});

test("someone who has left can't sign in, and the admin still sees their record", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/people/${intern.id}/exit`);
  await page.getByLabel("Last working day").fill(yesterday());
  await page.getByRole("button", { name: /^Mark Pema as left on/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/people/${intern.id}$`));
  await expect(page.getByText(/^Left on/)).toBeVisible();

  await page.goto("/admin/people");
  await expect(page.getByRole("heading", { name: "Former" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(intern.name) })).toBeVisible();
  await signOut(page);

  await page.goto("/login");
  await signIn(page, intern.email);
  await expect(page.getByText(/Your DashTeam access ended on/)).toBeVisible();
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login/);
});
