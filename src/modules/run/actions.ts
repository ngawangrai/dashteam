"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { firstNameFrom } from "@/lib/auth/roles";
import { claimsFor, requireRole } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { payrollAcknowledgements, payrollLines, payrollRuns, payrollSnapshots, rules } from "@/lib/db/schema";
import { addMonths, firstOfMonth, formatMonth, formatNu, parseNu } from "@/lib/format";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { issuePayslipsForMonth } from "@/modules/documents/issue";
import { makeScheduleForMonth } from "@/modules/filing/issue";
import { thisMonth } from "@/modules/people/repository";
import { resolvePayrollSettings } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import type { PayrollMonth } from "@/modules/rules/types";
import { buildRun, monthIndex, tryLine } from "./build";
import { LINE_KINDS, LINE_KIND_NAME } from "./lines";
import { lockedMessage, lockedMonthsIn } from "./locked";
import { firstMonthChoices, monthFromKey, monthKey } from "./months";
import { loadRunData, type SnapshotInputs, type SnapshotPerson } from "./repository";

// Every write: admin only, validated, worked out again on the server whatever the screen showed,
// named for the audit log, and (except locking) undoable from the toast.

export type RunActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "done"; message: string; transactionId: number; redirectTo?: string };

export type LockResult = { status: "locked"; message: string; redirectTo: string } | { status: "error"; message: string };

const SAVE_FAILED = "We couldn’t save that just now. Try again in a minute.";
const isLockedIn = (months: PayrollMonth[], month: PayrollMonth) => months.some((m) => monthIndex(m) === monthIndex(month));

function lockRefusal(error: unknown): string | null {
  const months = lockedMonthsIn(error);
  return months ? lockedMessage(months, "admin") : null;
}

// ── The first month ───────────────────────────────────────────────────────────

export async function setFirstMonth(_previous: RunActionState, formData: FormData): Promise<RunActionState> {
  const admin = await requireRole("admin");
  const month = monthFromKey(String(formData.get("month") ?? ""));
  const choices = firstMonthChoices(thisMonth());
  if (!month || !choices.some((choice) => monthIndex(choice) === monthIndex(month))) {
    return { status: "error", message: "Choose a month from the list.", fieldErrors: { month: "Choose a month from the list." } };
  }

  try {
    const transactionId = await asUser(claimsFor(admin), async (tx) => {
      const [locked] = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.status, "locked")).limit(1);
      if (locked) return null;
      const current = resolvePayrollSettings((await tx.select().from(rules).where(eq(rules.key, "payroll_settings"))).map(toRuleRow), thisMonth());
      const effectiveFrom = firstOfMonth(thisMonth());
      await labelNextWrites(tx, "payroll.first_month_set");
      // Settings set earlier this month are replaced; earlier months keep theirs.
      await tx.delete(rules).where(and(eq(rules.key, "payroll_settings"), eq(rules.effectiveFrom, effectiveFrom)));
      const value = { first_month: firstOfMonth(month), large_change_bp: current.largeChange, due_day: current.dueDay };
      await tx.insert(rules).values(
        (["full_time", "intern"] as const).map((employmentType) => ({
          key: "payroll_settings" as const,
          employmentType,
          effectiveFrom,
          value,
          note: `First payroll month set to ${formatMonth(month, { withYear: true })}`,
          createdBy: admin.id,
        })),
      );
      return currentTransactionId(tx);
    });
    if (transactionId === null) return { status: "error", message: "The first month can’t change once a month is locked." };
    revalidatePath("/admin/payroll", "layout");
    return {
      status: "done",
      message: `DashTeam pays from ${formatMonth(month, { withYear: true })}.`,
      transactionId,
      redirectTo: `/admin/payroll/${monthKey(month)}`,
    };
  } catch (error) {
    return { status: "error", message: lockRefusal(error) ?? SAVE_FAILED };
  }
}

// ── One-off lines ─────────────────────────────────────────────────────────────

const lineSchema = z.object({
  kind: z.enum(LINE_KINDS, { error: "Choose what this line is." }),
  amount: z
    .string()
    .transform((text) => parseNu(text))
    .refine((amount): amount is number => amount !== null && amount > 0, "Enter an amount, like 5,000."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").default(""),
});

export async function addLine(monthKey: string, personId: string, _previous: RunActionState, formData: FormData): Promise<RunActionState> {
  const admin = await requireRole("admin");
  const month = monthFromKey(monthKey);
  if (!month || !z.uuid().safeParse(personId).success) return { status: "error", message: SAVE_FAILED };
  const parsed = lineSchema.safeParse({
    kind: formData.get("kind") ?? undefined,
    amount: String(formData.get("amount") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { status: "error", message: Object.values(fieldErrors)[0] ?? "Check the line and try again.", fieldErrors };
  }
  const line = parsed.data;

  try {
    const result = await asUser(claimsFor(admin), async (tx) => {
      // One change to a month at a time, so two quick recoveries can't both fit a take-home with room for one.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payroll:${monthKey}`}))`);
      const { input, personRows } = await loadRunData(tx, month);
      if (isLockedIn(input.lockedMonths, month)) return { error: lockedMessage({ locked: month, draft: addMonths(month, 1) }, "admin") };
      const attempt = tryLine(input, { id: "new", personId, kind: line.kind, amount: line.amount, note: line.note, source: "manual" });
      if (!attempt.ok) return { error: attempt.reason };
      await labelNextWrites(tx, "payroll.line_added");
      await tx.insert(payrollLines).values({ month: firstOfMonth(month), personId, kind: line.kind, amountCh: line.amount, note: line.note, createdBy: admin.id });
      const person = personRows.find((row) => row.id === personId);
      return { takeHome: attempt.takeHome, name: firstNameFrom(person?.fullName, person?.email ?? ""), transactionId: await currentTransactionId(tx) };
    });
    if ("error" in result) return { status: "error", message: result.error ?? SAVE_FAILED };
    revalidatePath(`/admin/payroll/${monthKey}`);
    return {
      status: "done",
      message: `${LINE_KIND_NAME[line.kind]} of ${formatNu(line.amount)} added. ${result.name}’s take-home is now ${formatNu(result.takeHome)}.`,
      transactionId: result.transactionId,
    };
  } catch (error) {
    return { status: "error", message: lockRefusal(error) ?? SAVE_FAILED };
  }
}

export async function removeLine(lineId: string): Promise<RunActionState> {
  const admin = await requireRole("admin");
  if (!z.uuid().safeParse(lineId).success) return { status: "error", message: SAVE_FAILED };
  try {
    const result = await asUser(claimsFor(admin), async (tx) => {
      await labelNextWrites(tx, "payroll.line_removed");
      const [removed] = await tx.delete(payrollLines).where(eq(payrollLines.id, lineId)).returning({ kind: payrollLines.kind, month: payrollLines.month });
      if (!removed) return null;
      return { removed, transactionId: await currentTransactionId(tx) };
    });
    if (!result) return { status: "error", message: "This line was already removed." };
    revalidatePath(`/admin/payroll/${result.removed.month.slice(0, 7)}`);
    return { status: "done", message: `${LINE_KIND_NAME[result.removed.kind]} removed.`, transactionId: result.transactionId };
  } catch (error) {
    return { status: "error", message: lockRefusal(error) ?? SAVE_FAILED };
  }
}

// ── Checks ──────────────────────────────────────────────────────────────────────

export async function acknowledgeCheck(monthKey: string, checkKey: string): Promise<RunActionState> {
  const admin = await requireRole("admin");
  const month = monthFromKey(monthKey);
  if (!month || typeof checkKey !== "string" || checkKey.length > 300) return { status: "error", message: SAVE_FAILED };
  try {
    const result = await asUser(claimsFor(admin), async (tx) => {
      const view = buildRun((await loadRunData(tx, month)).input);
      const check = view.checks.find((c) => c.key === checkKey);
      if (!check) return { error: "This is already sorted. Refresh to see the latest." };
      if (check.kind !== "acknowledge") return { error: "This one needs sorting out before locking." };
      await labelNextWrites(tx, "payroll.acknowledged");
      await tx.insert(payrollAcknowledgements).values({ month: firstOfMonth(month), checkKey, acknowledgedBy: admin.id }).onConflictDoNothing();
      return { transactionId: await currentTransactionId(tx) };
    });
    if ("error" in result) return { status: "error", message: result.error ?? SAVE_FAILED };
    revalidatePath(`/admin/payroll/${monthKey}`, "layout");
    return { status: "done", message: "Acknowledged.", transactionId: result.transactionId };
  } catch (error) {
    return { status: "error", message: lockRefusal(error) ?? SAVE_FAILED };
  }
}

// ── Locking ─────────────────────────────────────────────────────────────────────

/**
 * Locks a month in one transaction: work it out again, refuse if any check is open, write a snapshot
 * per person, then mark the run locked with its totals. The inputs are held still (share locks) until
 * it commits, so the snapshot is exactly what was locked. Locking an already locked month does nothing.
 */
export async function lockPayroll(monthKey: string): Promise<LockResult> {
  const admin = await requireRole("admin");
  const month = monthFromKey(monthKey);
  if (!month) return { status: "error", message: SAVE_FAILED };
  const redirectTo = `/admin/payroll/${monthKey}`;
  const name = formatMonth(month);

  try {
    const outcome = await asUser(claimsFor(admin), async (tx) => {
      await tx.execute(sql`
        lock table public.people, public.pay_records, public.leave_requests, public.holidays, public.rules,
                   public.payroll_lines, public.payroll_acknowledgements, public.profile_change_requests
        in share mode`);
      const { input, personRows } = await loadRunData(tx, month);
      if (isLockedIn(input.lockedMonths, month)) return "already" as const;
      const view = buildRun(input);
      if (!view.ready) return "not_ready" as const;

      await tx.insert(payrollRuns).values({ month: firstOfMonth(month) }).onConflictDoNothing();
      const [run] = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.month, firstOfMonth(month))).limit(1);
      if (!run) throw new Error("run missing");

      await labelNextWrites(tx, "payroll.locked");
      const snapshots = view.people.flatMap((person) => {
        const row = personRows.find((p) => p.id === person.personId);
        if (!row || !person.result || !person.input || !person.employmentType) return [];
        const identity: SnapshotPerson = {
          phone: row.phone,
          bankName: row.bankName,
          bankAccountCiphertext: row.bankAccountCiphertext,
          bankAccountLast4: row.bankAccountLast4,
          tpnCiphertext: row.tpnCiphertext,
          tpnLast4: row.tpnLast4,
        };
        const inputs: SnapshotInputs = {
          terms: person.terms,
          startDate: person.startDate,
          endDate: person.endDate,
          unpaidLeaveDays: person.unpaidLeaveDays,
          lines: person.lines,
          payInput: person.input,
        };
        const result = person.result;
        return [
          {
            runId: run.id,
            personId: person.personId,
            fullName: row.fullName,
            email: row.email,
            employmentType: person.employmentType,
            person: identity,
            inputs,
            result,
            ruleIds: result.ruleIds,
            grossCh: result.gross,
            healthContributionCh: result.healthContribution,
            providentFundCh: result.providentFund,
            gisCh: result.gis,
            tdsCh: result.tds,
            recoveriesCh: result.recoveries,
            takeHomeCh: result.takeHome,
          },
        ];
      });
      if (snapshots.length) await tx.insert(payrollSnapshots).values(snapshots);

      const { totals } = view;
      const locked = await tx
        .update(payrollRuns)
        .set({
          status: "locked",
          peopleCount: totals.people,
          grossCh: totals.gross,
          healthContributionCh: totals.healthContribution,
          providentFundCh: totals.providentFund,
          gisCh: totals.gis,
          tdsCh: totals.tds,
          recoveriesCh: totals.recoveries,
          takeHomeCh: totals.takeHome,
          remitCh: totals.remit,
          dueDate: view.dueDate,
          ruleIds: view.ruleIds,
        })
        .where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.status, "draft")))
        .returning({ id: payrollRuns.id });
      return locked.length ? ("locked" as const) : ("already" as const);
    });

    if (outcome === "not_ready") return { status: "error", message: `Some checks still need you. Go back to ${name} to look at them.` };
    // Payslips are made and emailed once the lock has committed, so nothing about them can fail it.
    // Safe to schedule again for a month already locked: it only does what's missing.
    after(async () => {
      await issuePayslipsForMonth(month, admin);
      await makeScheduleForMonth(month, admin);
    });
    revalidatePath("/", "layout");
    if (outcome === "already") return { status: "locked", message: `${name} payroll is already locked.`, redirectTo };
    return { status: "locked", message: `${name} payroll is locked.`, redirectTo };
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
    const order = /Months lock in order\. Lock (\w+ \d{4}) first/.exec(text);
    if (order) return { status: "error", message: `Months lock in order. Lock ${order[1]} first.` };
    return { status: "error", message: lockRefusal(error) ?? "We couldn’t lock this month just now. Nothing was changed. Try again in a minute." };
  }
}
