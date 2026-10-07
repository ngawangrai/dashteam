import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser, type Tx } from "@/lib/db/client";
import { filingReceipts, filings, it1aSchedules, payrollRuns, payrollSnapshots, rules } from "@/lib/db/schema";
import { decryptField } from "@/lib/crypto/field";
import type { SnapshotPerson } from "@/modules/run/repository";
import { serverEnv } from "@/lib/env/server";
import { addMonths, firstOfMonth, monthOf, thimphuToday } from "@/lib/format";
import { resolvePayrollSettings } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import type { Chhertum, PayrollMonth, RuleRow } from "@/modules/rules/types";
import { type DueStatus, dueDateFor, dueStatus, monthsToFile } from "./due";
import type { ScheduleRow, ScheduleTotals } from "./schedule";

// Reads for the filing screens and the admin home. Admins only (RLS). A month's state is worked out
// from what exists, never stored: Draft until it's locked, Ready once its schedule is made, Filed
// once the admin records the filing.

/** Today in Thimphu. Tests may fix the date with FILING_TODAY; production never reads it. */
export function filingToday(): string {
  return serverEnv.FILING_TODAY ?? thimphuToday();
}

export type FilingState = "draft" | "not_made" | "ready" | "filed";

export type FilingMonthView = {
  month: PayrollMonth;
  monthKey: string;
  state: FilingState;
  dueDate: string;
  runId: string | null;
  remit: Chhertum | null;
  tds: Chhertum | null;
  hc: Chhertum | null;
  pf: Chhertum | null;
  filedOn: string | null;
  paymentReference: string | null;
  acknowledgementNumber: string | null;
  receipt: { id: string; filename: string } | null;
};

const keyOf = ({ year, month }: PayrollMonth) => `${year}-${String(month).padStart(2, "0")}`;
const index = ({ year, month }: PayrollMonth) => year * 12 + month - 1;

type Loaded = {
  ruleRows: RuleRow[];
  runs: (typeof payrollRuns.$inferSelect)[];
  schedules: { id: string; runId: string }[];
  filingRows: (typeof filings.$inferSelect)[];
  receipts: { id: string; runId: string; filename: string }[];
};

async function load(tx: Tx): Promise<Loaded> {
  const [ruleRows, runs, schedules, filingRows, receipts] = await Promise.all([
    tx.select().from(rules).where(eq(rules.key, "payroll_settings")),
    tx.select().from(payrollRuns).where(eq(payrollRuns.status, "locked")).orderBy(desc(payrollRuns.month)),
    tx.select({ id: it1aSchedules.id, runId: it1aSchedules.runId }).from(it1aSchedules),
    tx.select().from(filings),
    tx.select({ id: filingReceipts.id, runId: filingReceipts.runId, filename: filingReceipts.filename }).from(filingReceipts),
  ]);
  return { ruleRows: ruleRows.map(toRuleRow), runs, schedules, filingRows, receipts };
}

function viewOf(month: PayrollMonth, data: Loaded): FilingMonthView {
  const run = data.runs.find((r) => r.month === firstOfMonth(month));
  const filing = run ? data.filingRows.find((f) => f.runId === run.id) : undefined;
  const schedule = run ? data.schedules.find((s) => s.runId === run.id) : undefined;
  const receipt = filing?.receiptId ? data.receipts.find((r) => r.id === filing.receiptId) : undefined;
  const state: FilingState = !run ? "draft" : filing?.filedOn ? "filed" : schedule ? "ready" : "not_made";
  return {
    month,
    monthKey: keyOf(month),
    state,
    dueDate: run?.dueDate ?? dueDateFor(month, resolvePayrollSettings(data.ruleRows, month).dueDay),
    runId: run?.id ?? null,
    remit: run?.remitCh ?? null,
    tds: run?.tdsCh ?? null,
    hc: run?.healthContributionCh ?? null,
    pf: run?.providentFundCh ?? null,
    filedOn: filing?.filedOn ?? null,
    paymentReference: filing?.paymentReference ?? null,
    acknowledgementNumber: filing?.acknowledgementNumber ?? null,
    receipt: receipt ? { id: receipt.id, filename: receipt.filename } : null,
  };
}

function firstMonthOf(data: Loaded): PayrollMonth | null {
  return resolvePayrollSettings(data.ruleRows, monthOf(filingToday())).firstMonth;
}

/** Every month from DashTeam's first to last month (and any locked since), newest first. */
export async function filingHistory(user: SessionUser): Promise<FilingMonthView[]> {
  return asUser(claimsFor(user), async (tx) => {
    const data = await load(tx);
    const first = firstMonthOf(data);
    if (!first) return [];
    const lastMonth = addMonths(monthOf(filingToday()), -1);
    const latestLocked = data.runs[0] ? monthOf(data.runs[0].month) : null;
    const end = latestLocked && index(latestLocked) > index(lastMonth) ? latestLocked : lastMonth;
    const months: FilingMonthView[] = [];
    for (let m = end; index(m) >= index(first); m = addMonths(m, -1)) months.push(viewOf(m, data));
    return months;
  });
}

export type FilingDetail = FilingMonthView & { scheduleId: string | null; rows: ScheduleRow[]; totals: ScheduleTotals | null; entered: string[] };

/** One month's filing: its state, the schedule's rows (TPN masked) and totals, and the record. */
export async function filingFor(user: SessionUser, month: PayrollMonth): Promise<FilingDetail> {
  return asUser(claimsFor(user), async (tx) => {
    const data = await load(tx);
    const view = viewOf(month, data);
    const [schedule] = view.runId
      ? await tx.select({ id: it1aSchedules.id, rows: it1aSchedules.rows, totals: it1aSchedules.totals }).from(it1aSchedules).where(eq(it1aSchedules.runId, view.runId)).limit(1)
      : [];
    const filing = view.runId ? data.filingRows.find((f) => f.runId === view.runId) : undefined;
    return {
      ...view,
      scheduleId: schedule?.id ?? null,
      rows: (schedule?.rows as ScheduleRow[] | undefined) ?? [],
      totals: (schedule?.totals as ScheduleTotals | undefined) ?? null,
      entered: (filing?.entered as string[] | undefined) ?? [],
    };
  });
}

export type DueCard = { month: PayrollMonth; monthKey: string; status: DueStatus; remit: Chhertum | null; locked: boolean; more: number };

/** The month most in need of filing, for the admin home: from the 1st of the next month until filed. */
export async function dueCard(user: SessionUser): Promise<DueCard | null> {
  return asUser(claimsFor(user), async (tx) => {
    const data = await load(tx);
    const filed = data.filingRows.filter((f) => f.filedOn).map((f) => monthOf(f.month));
    const toFile = monthsToFile(filingToday(), firstMonthOf(data), filed);
    const [next] = toFile;
    if (!next) return null;
    const view = viewOf(next, data);
    return { month: next, monthKey: view.monthKey, status: dueStatus(filingToday(), view.dueDate), remit: view.remit, locked: view.state !== "draft", more: toFile.length - 1 };
  });
}

/**
 * The schedule's rows with each TPN in full, for typing into RAMIS by hand. The TPN comes from the
 * snapshot (as it was at lock). Showing TPNs in full is recorded, the same as downloading the file.
 */
export async function entryRowsFor(user: SessionUser, detail: FilingDetail): Promise<ScheduleRow[]> {
  if (!detail.runId || !detail.scheduleId) return [];
  const runId = detail.runId;
  const scheduleId = detail.scheduleId;
  const people = await asUser(claimsFor(user), async (tx) => {
    await tx.execute(sql`select public.record_filing_download('schedule', ${scheduleId})`);
    return tx.select({ personId: payrollSnapshots.personId, person: payrollSnapshots.person }).from(payrollSnapshots).where(eq(payrollSnapshots.runId, runId));
  });
  return detail.rows.map((row) => {
    const person = people.find((p) => p.personId === row.personId)?.person as SnapshotPerson | undefined;
    const tpn = person?.tpnCiphertext ? decryptField(person.tpnCiphertext, { personId: row.personId, field: "tpn" }) : "";
    return { ...row, tpn };
  });
}
