import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { payrollImports, payrollRuns, people } from "@/lib/db/schema";
import { monthOf } from "@/lib/format";
import { thisMonth } from "@/modules/people/repository";
import { resolvePayrollSettings } from "@/modules/rules/resolve";
import { loadRuleRows } from "@/modules/rules/repository";
import type { Chhertum, PayrollMonth } from "@/modules/rules/types";
import type { PayrollImportContext } from "./payroll-csv";

// Reads for bringing in past months. Admins only (RLS).

/** What a file is checked against: the first payroll month, months already in, people and rules. */
export async function importContext(user: SessionUser): Promise<PayrollImportContext> {
  const ruleRows = await loadRuleRows(claimsFor(user));
  return asUser(claimsFor(user), async (tx) => {
    const runs = await tx.select({ month: payrollRuns.month }).from(payrollRuns);
    const everyone = await tx.select({ id: people.id, email: people.email, fullName: people.fullName, startDate: people.startDate, endDate: people.endDate }).from(people);
    return {
      firstMonth: resolvePayrollSettings(ruleRows, thisMonth()).firstMonth,
      takenMonths: runs.map((run) => run.month.slice(0, 7)),
      people: everyone,
      ruleRows,
    };
  });
}

export type ImportView = {
  id: string;
  filename: string;
  months: PayrollMonth[];
  people: number;
  takeHome: Chhertum;
  importedAt: Date;
};

export type ImportsOverview = {
  firstMonth: PayrollMonth | null;
  imports: ImportView[];
  /** Imports can be removed until a month is locked in DashTeam. */
  canRemove: boolean;
};

export async function importsOverview(user: SessionUser): Promise<ImportsOverview> {
  const ruleRows = await loadRuleRows(claimsFor(user));
  return asUser(claimsFor(user), async (tx) => {
    const rows = await tx.select().from(payrollImports).where(isNull(payrollImports.removedAt)).orderBy(desc(payrollImports.importedAt));
    const runs = await tx
      .select({ importId: payrollRuns.importId, month: payrollRuns.month, people: payrollRuns.peopleCount, takeHome: payrollRuns.takeHomeCh })
      .from(payrollRuns)
      .where(eq(payrollRuns.source, "imported"))
      .orderBy(asc(payrollRuns.month));
    const [live] = await tx.execute<{ locked: boolean }>(sql`select public.live_month_locked() as locked`);
    return {
      firstMonth: resolvePayrollSettings(ruleRows, thisMonth()).firstMonth,
      canRemove: !live?.locked,
      imports: rows.map((row) => {
        const own = runs.filter((run) => run.importId === row.id);
        return {
          id: row.id,
          filename: row.filename,
          months: own.map((run) => monthOf(run.month)),
          people: Math.max(0, ...own.map((run) => run.people ?? 0)),
          takeHome: own.reduce((sum, run) => sum + (run.takeHome ?? 0), 0),
          importedAt: row.importedAt,
        };
      }),
    };
  });
}

/** The runs an import made, for issuing their payslips. */
export async function importRunIds(user: SessionUser, importId: string): Promise<string[]> {
  const rows = await asUser(claimsFor(user), (tx) =>
    tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.importId, importId), eq(payrollRuns.status, "locked"))),
  );
  return rows.map((row) => row.id);
}
