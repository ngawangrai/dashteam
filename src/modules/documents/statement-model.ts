import { addMonths, formatLongDate, formatMonth } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import type { Chhertum, CompanyDetails, EmploymentType, PayrollMonth } from "@/modules/rules/types";
import { monthKey } from "@/modules/run/months";

// A pay statement: one line per month across a range, from the locked snapshots and nothing else, with
// totals for the range. Pure: snapshots in, statement out. The PDF and the app read the same model.

/** What a statement reads from one locked month's snapshot. */
export type StatementSnapshot = { month: PayrollMonth; employmentType: EmploymentType; gross: Chhertum; takeHome: Chhertum; imported: boolean };

export type StatementLine =
  | { kind: "paid"; month: PayrollMonth; monthName: string; gross: Chhertum; deductions: Chhertum; takeHome: Chhertum; imported: boolean }
  | { kind: "not_paid"; month: PayrollMonth; monthName: string };

export type StatementModel = {
  company: { name: string; addressLines: string[]; showLogo: boolean };
  title: string;
  person: { name: string; employmentType: string; tpn: string };
  period: string;
  from: PayrollMonth;
  to: PayrollMonth;
  lines: StatementLine[];
  paidMonths: number;
  totals: { gross: Chhertum; deductions: Chhertum; takeHome: Chhertum };
  anyImported: boolean;
  reference: string;
  issuedOn: string;
};

export type StatementRange = { from: PayrollMonth; to: PayrollMonth };
export const QUICK_RANGES = [3, 6, 12] as const;
export type QuickRange = (typeof QUICK_RANGES)[number];

const index = ({ year, month }: PayrollMonth) => year * 12 + month - 1;

/**
 * The last 3, 6 or 12 months, ending with the latest month paid. Never starts before the first month
 * paid, so someone who joined recently gets the months they have, not a run of empty ones.
 */
export function quickRange(paidMonths: readonly PayrollMonth[], months: QuickRange): StatementRange | null {
  if (!paidMonths.length) return null;
  const sorted = [...paidMonths].sort((a, b) => index(a) - index(b));
  const first = sorted[0] as PayrollMonth;
  const to = sorted[sorted.length - 1] as PayrollMonth;
  const start = addMonths(to, -(months - 1));
  return { from: index(start) < index(first) ? first : start, to };
}

/** "April to September 2026", or "November 2025 to April 2026" across a year, or one month. */
export function periodName({ from, to }: StatementRange): string {
  if (index(from) === index(to)) return formatMonth(to, { withYear: true });
  return from.year === to.year ? `${formatMonth(from)} to ${formatMonth(to, { withYear: true })}` : `${formatMonth(from, { withYear: true })} to ${formatMonth(to, { withYear: true })}`;
}

/** XS-PS-2026-0004: the year it was issued, then its place among that year's statements. */
export function statementReference(year: number, position: number): string {
  return `XS-PS-${year}-${String(position).padStart(4, "0")}`;
}

export function statementModel(input: {
  person: { name: string; tpnLast4: string | null };
  range: StatementRange;
  snapshots: readonly StatementSnapshot[];
  company: CompanyDetails;
  reference: string;
  issuedOn: string;
}): StatementModel {
  const { from, to } = input.range;
  const byMonth = new Map(input.snapshots.map((snapshot) => [monthKey(snapshot.month), snapshot]));
  const lines: StatementLine[] = [];
  for (let m = from; index(m) <= index(to); m = addMonths(m, 1)) {
    const snapshot = byMonth.get(monthKey(m));
    const monthName = formatMonth(m, { withYear: true });
    lines.push(
      snapshot
        ? { kind: "paid", month: m, monthName, gross: snapshot.gross, deductions: snapshot.gross - snapshot.takeHome, takeHome: snapshot.takeHome, imported: snapshot.imported }
        : { kind: "not_paid", month: m, monthName },
    );
  }
  const paid = lines.filter((line) => line.kind === "paid");
  const totals = paid.reduce((sum, line) => ({ gross: sum.gross + line.gross, deductions: sum.deductions + line.deductions, takeHome: sum.takeHome + line.takeHome }), {
    gross: 0,
    deductions: 0,
    takeHome: 0,
  });
  // The employment type as of the latest month in the range.
  const latest = [...input.snapshots].filter((s) => index(s.month) >= index(from) && index(s.month) <= index(to)).sort((a, b) => index(b.month) - index(a.month))[0];
  return {
    company: { name: input.company.name, addressLines: input.company.addressLines, showLogo: input.company.showLogo },
    title: "Pay statement",
    person: {
      name: input.person.name,
      employmentType: latest ? EMPLOYMENT_TYPE_LABEL[latest.employmentType] : "",
      tpn: input.person.tpnLast4 ? `TPN ••••${input.person.tpnLast4}` : "TPN not on file",
    },
    period: periodName(input.range),
    from,
    to,
    lines,
    paidMonths: paid.length,
    totals,
    anyImported: paid.some((line) => line.imported),
    reference: input.reference,
    issuedOn: formatLongDate(input.issuedOn),
  };
}
