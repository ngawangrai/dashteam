import type { PayslipSnapshot } from "@/modules/documents/model";
import { prorateRegularPay } from "@/modules/payroll";
import type { Chhertum, EmploymentType, ProrationRule } from "@/modules/rules/types";
import { LINE_GROUP } from "@/modules/run/lines";

// The IT-1(a) monthly salary schedule, worked out from a locked month's snapshots and nothing live.
// Columns in the official order. How snapshot lines map to them (decided with the founder):
//
//   C Basic Salary         basic pro-rated by the days paid, or the stipend; minus any leave recovery
//   D Benefit / Allowance  the allowance for the days paid, plus bonuses and other earnings
//   E Salary Arrear        arrears
//   F Gross Salary         the snapshot's gross, always C + D + E
//   G PF, H GIS            the snapshot's
//   I Net Salary           the snapshot's taxable, always F − G − H
//   J TDS, K HC            the snapshot's
//   L Total                J + K
//
// After-tax deductions (advance recovery, other deduction) are not on the form. A part month splits
// the one pro-rated amount by pro-rating basic exactly as pay was pro-rated, with the allowance taking
// the remainder, so the two always add up to what was paid.

export type ScheduleSource = PayslipSnapshot & { personId: string; tpn: string | null };

export type ScheduleRow = {
  personId: string;
  name: string;
  /** In full: this is what DRC needs. Blank when there's none on file. */
  tpn: string;
  employmentType: EmploymentType;
  basic: Chhertum;
  allowance: Chhertum;
  arrear: Chhertum;
  gross: Chhertum;
  pf: Chhertum;
  gis: Chhertum;
  net: Chhertum;
  tds: Chhertum;
  hc: Chhertum;
  total: Chhertum;
};

export type ScheduleTotals = Omit<ScheduleRow, "personId" | "name" | "tpn" | "employmentType"> & { people: number };

export type ScheduleRules = {
  /** The proration rule in force for the month (the one pay was pro-rated with). */
  proration: (type: EmploymentType) => ProrationRule;
  /** Whether this employment type is on the IT-1(a) for the month (the it1a_inclusion setting). */
  included: (type: EmploymentType) => boolean;
};

/** A row that doesn't add up to the locked figures. The schedule is never written when this happens. */
export class ReconciliationError extends Error {}

const HALF_DAYS = 2;

function rowFor(source: ScheduleSource, rules: ScheduleRules): ScheduleRow {
  const { result, inputs } = source;
  const terms = inputs.terms;
  if (!terms) throw new ReconciliationError(`${source.fullName} has no pay terms in the snapshot`);

  let basic: Chhertum;
  let allowance: Chhertum;
  if (terms.employmentType === "intern") {
    basic = result.regularPayDue;
    allowance = 0;
  } else {
    basic = prorateRegularPay(terms.basic, result.daysPaid * HALF_DAYS, result.daysInMonth * HALF_DAYS, rules.proration(source.employmentType));
    allowance = result.regularPayDue - basic;
  }
  let arrear = 0;
  for (const line of inputs.lines) {
    if (line.kind === "arrear") arrear += line.amount;
    else if (line.kind === "leave_recovery") basic -= line.amount;
    else if (LINE_GROUP[line.kind] === "earning") allowance += line.amount;
  }

  const row: ScheduleRow = {
    personId: source.personId,
    name: source.fullName,
    tpn: source.tpn ?? "",
    employmentType: source.employmentType,
    basic,
    allowance,
    arrear,
    gross: result.gross,
    pf: result.providentFund,
    gis: result.gis,
    net: result.taxable,
    tds: result.tds,
    hc: result.healthContribution,
    total: result.tds + result.healthContribution,
  };

  if (row.basic + row.allowance + row.arrear !== row.gross) {
    throw new ReconciliationError(`${source.fullName}: basic, allowance and arrear don't add up to the locked gross`);
  }
  if (row.gross - row.pf - row.gis !== row.net) {
    throw new ReconciliationError(`${source.fullName}: net salary doesn't match the locked figures`);
  }
  if (row.allowance < 0) throw new ReconciliationError(`${source.fullName}: the allowance column would be below zero`);
  return row;
}

/** One row per person on the form, in name order. Throws ReconciliationError rather than mis-file. */
export function scheduleRows(sources: readonly ScheduleSource[], rules: ScheduleRules): ScheduleRow[] {
  return sources
    .filter((source) => rules.included(source.employmentType))
    .map((source) => rowFor(source, rules))
    .sort((a, b) => a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId));
}

export function scheduleTotals(rows: readonly ScheduleRow[]): ScheduleTotals {
  const sum = (pick: (row: ScheduleRow) => Chhertum) => rows.reduce((total, row) => total + pick(row), 0);
  return {
    people: rows.length,
    basic: sum((r) => r.basic),
    allowance: sum((r) => r.allowance),
    arrear: sum((r) => r.arrear),
    gross: sum((r) => r.gross),
    pf: sum((r) => r.pf),
    gis: sum((r) => r.gis),
    net: sum((r) => r.net),
    tds: sum((r) => r.tds),
    hc: sum((r) => r.hc),
    total: sum((r) => r.total),
  };
}
