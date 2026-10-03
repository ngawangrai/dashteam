import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { decryptField } from "@/lib/crypto/field";
import { type Tx, asUser } from "@/lib/db/client";
import {
  type Person,
  type PayrollRun,
  holidays,
  leaveRequests,
  payRecords,
  payrollAcknowledgements,
  payrollLines,
  payrollRuns,
  payrollSnapshots,
  people,
  profileChangeRequests,
  rules,
} from "@/lib/db/schema";
import { addMonths, firstOfMonth, monthBounds, monthOf, thimphuToday } from "@/lib/format";
import type { LockedRange } from "@/modules/leave/balance";
import { toHoliday } from "@/modules/leave/repository";
import type { PayInput, PayResult } from "@/modules/payroll";
import { toPayView, thisMonth } from "@/modules/people/repository";
import { resolvePayrollSettings } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import type { Chhertum, EmploymentType, PayrollMonth } from "@/modules/rules/types";
import { type RunInput, type RunView, buildRun, monthIndex } from "./build";
import type { BankListRow } from "./bank-list";
import type { RunLine } from "./lines";

// Reads for the payroll screens. Admins only (RLS). A draft is worked out from its inputs on every
// read; a locked month is read from its snapshot and never recalculated.

const sameMonth = (a: PayrollMonth, b: PayrollMonth) => monthIndex(a) === monthIndex(b);

export type RunData = { input: RunInput; personRows: Person[] };

/** Everything a month's run is worked out from, read in the caller's transaction. */
export async function loadRunData(tx: Tx, month: PayrollMonth): Promise<RunData> {
  const { from, to } = monthBounds(month);
  const start = firstOfMonth(month);
  const [personRows, pay, leave, changes, holidayRows, ruleRows, lineRows, acknowledgements, locked] = await Promise.all([
    tx.select().from(people),
    tx.select().from(payRecords),
    tx.select().from(leaveRequests).where(and(lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from))),
    tx.select().from(profileChangeRequests).where(eq(profileChangeRequests.status, "pending")),
    tx.select().from(holidays),
    tx.select().from(rules),
    tx.select().from(payrollLines).where(eq(payrollLines.month, start)).orderBy(asc(payrollLines.createdAt)),
    tx.select({ checkKey: payrollAcknowledgements.checkKey }).from(payrollAcknowledgements).where(eq(payrollAcknowledgements.month, start)),
    tx.select({ id: payrollRuns.id, month: payrollRuns.month }).from(payrollRuns).where(eq(payrollRuns.status, "locked")),
  ]);

  const previous = locked.find((run) => sameMonth(monthOf(run.month), addMonths(month, -1)));
  const previousSnapshots = previous
    ? await tx.select({ personId: payrollSnapshots.personId, takeHome: payrollSnapshots.takeHomeCh }).from(payrollSnapshots).where(eq(payrollSnapshots.runId, previous.id))
    : [];

  const allRules = ruleRows.map(toRuleRow);
  const input: RunInput = {
    month,
    people: personRows.map((person) => {
      const change = changes.find((c) => c.personId === person.id);
      return {
        id: person.id,
        fullName: person.fullName,
        startDate: person.startDate,
        endDate: person.endDate,
        pay: pay.filter((record) => record.personId === person.id).map(toPayView),
        hasTpn: person.tpnCiphertext !== null,
        hasBankAccount: person.bankAccountCiphertext !== null,
        leave: leave
          .filter((request) => request.personId === person.id)
          .map(({ id, leaveType, status, startDate, endDate, startHalf, endHalf, childOrder }) => ({
            id,
            leaveType,
            status,
            startDate,
            endDate,
            startHalf,
            endHalf,
            childOrder,
          })),
        pendingChange: change
          ? {
              id: change.id,
              fields: [
                ...(change.phone !== null ? (["phone"] as const) : []),
                ...(change.bankName !== null || change.bankAccountCiphertext !== null ? (["bank"] as const) : []),
              ],
            }
          : null,
      };
    }),
    lines: lineRows.map((row): RunLine => ({ id: row.id, personId: row.personId, kind: row.kind, amount: row.amountCh, note: row.note, source: row.source })),
    ruleRows: allRules,
    holidays: holidayRows.map(toHoliday),
    firstMonth: resolvePayrollSettings(allRules, thisMonth()).firstMonth,
    lockedMonths: locked.map((run) => monthOf(run.month)),
    previousTakeHome: Object.fromEntries(previousSnapshots.map((row) => [row.personId, row.takeHome])),
    acknowledged: acknowledgements.map((row) => row.checkKey),
    today: thimphuToday(),
  };
  return { input, personRows };
}

export async function draftRun(user: SessionUser, month: PayrollMonth): Promise<RunView> {
  return asUser(claimsFor(user), async (tx) => buildRun((await loadRunData(tx, month)).input));
}

// ── The Payroll screen ──────────────────────────────────────────────────────────

export type PayrollOverview = {
  firstMonth: PayrollMonth | null;
  /** The month to work on now: the first one from the first month that isn't locked. */
  openMonth: PayrollMonth | null;
  locked: PayrollRun[];
};

export async function payrollOverview(user: SessionUser): Promise<PayrollOverview> {
  return asUser(claimsFor(user), async (tx) => {
    const [ruleRows, locked] = await Promise.all([
      tx.select().from(rules).where(eq(rules.key, "payroll_settings")),
      tx.select().from(payrollRuns).where(eq(payrollRuns.status, "locked")).orderBy(desc(payrollRuns.month)),
    ]);
    const firstMonth = resolvePayrollSettings(ruleRows.map(toRuleRow), thisMonth()).firstMonth;
    if (!firstMonth) return { firstMonth, openMonth: null, locked };
    const lockedKeys = new Set(locked.map((run) => run.month));
    let openMonth = firstMonth;
    while (lockedKeys.has(firstOfMonth(openMonth))) openMonth = addMonths(openMonth, 1);
    return { firstMonth, openMonth, locked };
  });
}

/** The latest locked month, for the lock checks on other screens. Anyone signed in may ask. */
export async function latestLockedMonth(user: SessionUser): Promise<PayrollMonth | null> {
  return asUser(claimsFor(user), async (tx) => {
    // Through the security-definer function, so it works for employees, who can't read payroll runs.
    const rows = await tx.execute<{ month: string | null }>(sql`select public.latest_locked_month()::text as month`);
    const month = rows[0]?.month;
    return month ? monthOf(month) : null;
  });
}

/**
 * The locked months as a range, from the first month DashTeam paid to the end of the latest locked
 * month, for checking leave before it's sent. Anyone signed in may ask (security-definer functions).
 */
export async function lockedRange(user: SessionUser): Promise<LockedRange | null> {
  return asUser(claimsFor(user), async (tx) => {
    const rows = await tx.execute<{ first: string | null; latest: string | null }>(
      sql`select public.payroll_first_month()::text as first, public.latest_locked_month()::text as latest`,
    );
    const { first, latest } = rows[0] ?? { first: null, latest: null };
    if (!first || !latest) return null;
    return { from: first, through: monthBounds(monthOf(latest)).to, audience: user.role === "admin" ? "admin" : "employee" };
  });
}

/** Every locked month, for checks that need to know exactly which (holidays span several). Admins only. */
export async function lockedMonths(user: SessionUser): Promise<PayrollMonth[]> {
  const rows = await asUser(claimsFor(user), (tx) => tx.select({ month: payrollRuns.month }).from(payrollRuns).where(eq(payrollRuns.status, "locked")));
  return rows.map((row) => monthOf(row.month));
}

// ── A locked month ──────────────────────────────────────────────────────────────

export type SnapshotPerson = { phone: string | null; bankName: string | null; bankAccountCiphertext: string | null; bankAccountLast4: string | null; tpnCiphertext: string | null; tpnLast4: string | null };

export type SnapshotInputs = {
  terms: unknown;
  startDate: string;
  endDate: string | null;
  unpaidLeaveDays: number;
  lines: RunLine[];
  payInput: PayInput;
};

/** One person's locked figures, safe to send to the browser: no ciphertext, only the last 4. */
export type LockedPersonView = {
  personId: string;
  fullName: string;
  employmentType: EmploymentType;
  result: PayResult;
  lines: RunLine[];
  unpaidLeaveDays: number;
  startDate: string;
  endDate: string | null;
  bankName: string | null;
  bankAccountLast4: string | null;
  deductions: Chhertum;
};

export type LockedRunView = { run: PayrollRun; people: LockedPersonView[] };

export async function lockedRun(user: SessionUser, month: PayrollMonth): Promise<LockedRunView | null> {
  return asUser(claimsFor(user), async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.month, firstOfMonth(month)), eq(payrollRuns.status, "locked")))
      .limit(1);
    if (!run) return null;
    const rows = await tx.select().from(payrollSnapshots).where(eq(payrollSnapshots.runId, run.id)).orderBy(asc(payrollSnapshots.fullName));
    return {
      run,
      people: rows.map((row) => {
        const inputs = row.inputs as SnapshotInputs;
        const person = row.person as SnapshotPerson;
        return {
          personId: row.personId,
          fullName: row.fullName,
          employmentType: row.employmentType,
          result: row.result as PayResult,
          lines: inputs.lines,
          unpaidLeaveDays: inputs.unpaidLeaveDays,
          startDate: inputs.startDate,
          endDate: inputs.endDate,
          bankName: person.bankName,
          bankAccountLast4: person.bankAccountLast4,
          deductions: row.grossCh - row.takeHomeCh,
        };
      }),
    };
  });
}

export async function isLocked(user: SessionUser, month: PayrollMonth): Promise<boolean> {
  const rows = await asUser(claimsFor(user), (tx) =>
    tx
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.month, firstOfMonth(month)), eq(payrollRuns.status, "locked")))
      .limit(1),
  );
  return rows.length > 0;
}

/**
 * The bank transfer list for a locked month, from its snapshot: account numbers in full, so the
 * download is recorded in the audit log in the same transaction. Null if the month isn't locked.
 */
export async function bankListFor(user: SessionUser, month: PayrollMonth): Promise<BankListRow[] | null> {
  const rows = await asUser(claimsFor(user), async (tx) => {
    const [run] = await tx
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.month, firstOfMonth(month)), eq(payrollRuns.status, "locked")))
      .limit(1);
    if (!run) return null;
    await tx.execute(sql`select public.record_bank_list_download(${run.id})`);
    return tx
      .select({ personId: payrollSnapshots.personId, fullName: payrollSnapshots.fullName, person: payrollSnapshots.person, takeHome: payrollSnapshots.takeHomeCh })
      .from(payrollSnapshots)
      .where(eq(payrollSnapshots.runId, run.id))
      .orderBy(asc(payrollSnapshots.fullName));
  });
  if (!rows) return null;
  return rows.map((row) => {
    const person = row.person as SnapshotPerson;
    return {
      name: row.fullName,
      bank: person.bankName,
      account: person.bankAccountCiphertext ? decryptField(person.bankAccountCiphertext, { personId: row.personId, field: "bank_account" }) : null,
      takeHome: row.takeHome,
    };
  });
}
