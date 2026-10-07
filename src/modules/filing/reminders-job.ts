import "server-only";
import { eq, sql } from "drizzle-orm";
import { asSystem } from "@/lib/db/client";
import { filingReminders, filings, payrollRuns, rules } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env/server";
import { firstOfMonth, monthOf } from "@/lib/format";
import { resolveFilingSettings, resolvePayrollSettings } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import { dueDateFor, monthsToFile, remindersToday } from "./due";
import { type ReminderMonth, filingReminderEmail } from "./emails";

// The daily reminder job, run by a scheduled GitHub Action behind a secret. It's the one piece of
// DashTeam that runs with no one signed in, so it uses the server's own connection (asSystem).
// At most one reminder a day: the job holds a lock while it checks, sends and records the day.

export type ReminderOutcome =
  | { sent: true; months: string[]; recipients: number }
  | { sent: false; reason: "not_a_reminder_day" | "nothing_to_file" | "already_sent_today" | "no_admins" }
  | { sent: false; reason: "send_failed"; error: string };

const keyOf = (date: string) => date.slice(0, 7);

export async function sendFilingReminders(today: string): Promise<ReminderOutcome> {
  return asSystem(async (tx) => {
    // One run at a time: a second call waits here, then finds today's row and stops.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dashteam:filing-reminders'))`);
    const [already] = await tx.select({ id: filingReminders.id }).from(filingReminders).where(eq(filingReminders.sentOn, today)).limit(1);
    if (already) return { sent: false, reason: "already_sent_today" };

    const ruleRows = (await tx.select().from(rules)).map(toRuleRow);
    const thisMonth = monthOf(today);
    const { reminderDays } = resolveFilingSettings(ruleRows, thisMonth);
    const firstMonth = resolvePayrollSettings(ruleRows, thisMonth).firstMonth;
    const filed = (await tx.select({ month: filings.month, filedOn: filings.filedOn }).from(filings)).filter((f) => f.filedOn).map((f) => monthOf(f.month));
    const toFile = monthsToFile(today, firstMonth, filed);
    if (!toFile.length) return { sent: false, reason: "nothing_to_file" };
    const due = remindersToday(today, reminderDays, toFile);
    if (!due.length) return { sent: false, reason: "not_a_reminder_day" };

    const runs = await tx.select().from(payrollRuns).where(eq(payrollRuns.status, "locked"));
    const months: ReminderMonth[] = due.map((month) => {
      const run = runs.find((r) => r.month === firstOfMonth(month));
      return {
        month,
        dueDate: run?.dueDate ?? dueDateFor(month, resolvePayrollSettings(ruleRows, month).dueDay),
        remit: run?.remitCh ?? null,
        locked: Boolean(run),
      };
    });
    const recipients = (await tx.execute<{ email: string }>(sql`select public.admin_emails() as email`)).map((row) => row.email);
    if (!recipients.length) return { sent: false, reason: "no_admins" };

    const [only] = months;
    const url = months.length === 1 && only ? `${serverEnv.APP_URL}/admin/payroll/${firstOfMonth(only.month).slice(0, 7)}/filing` : `${serverEnv.APP_URL}/admin/filing`;
    const email = filingReminderEmail({ today, months, url });
    const results = await Promise.all(recipients.map((to) => sendEmail({ to, ...email, idempotencyKey: `filing-reminder:${today}:${to}` })));
    const failed = results.find((result) => !result.ok);
    // If nobody got it, record nothing: the job reports the failure and can be run again today.
    if (results.every((result) => !result.ok)) return { sent: false, reason: "send_failed", error: failed && !failed.ok ? failed.error : "It didn’t send." };

    await tx.insert(filingReminders).values({
      sentOn: today,
      months: months.map((m) => keyOf(firstOfMonth(m.month))),
      recipients: recipients.filter((_to, i) => results[i]?.ok),
    });
    return { sent: true, months: months.map((m) => keyOf(firstOfMonth(m.month))), recipients: results.filter((result) => result.ok).length };
  });
}
