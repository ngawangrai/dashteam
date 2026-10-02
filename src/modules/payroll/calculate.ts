import { z } from "zod";
import {
  BASIS_POINTS_PER_WHOLE,
  type Chhertum,
  type EmploymentType,
  type HealthContributionRule,
  type PayrollMonth,
  type PlainDate,
  type ProrationRule,
  type ProvidentFundRule,
  type ResolvedRules,
  type TdsRule,
} from "@/modules/rules/types";
import { daysEmployedInMonth, daysInMonth } from "./calendar";
import { divideAndRound, toChhertum } from "./rounding";

// The payroll calculation: pure functions, input in, result out. Every rate, edge and
// rounding unit comes from the resolved rules; nothing here is a tax or pay value.

const money = z.number().int().refine(Number.isSafeInteger, "Amount is too large");
const nonNegativeMoney = money.refine((value) => value >= 0, "Amount cannot be negative");
const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/) as unknown as z.ZodType<PlainDate>;

const payInputSchema = z.object({
  employmentType: z.enum(["full_time", "intern"]),
  month: z
    .object({ year: z.number().int(), month: z.number().int() })
    .refine(({ year, month }) => new Date(Date.UTC(year, month - 1, 1)).getUTCMonth() === month - 1, "Not a payroll month"),
  regularPay: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("salary"), basic: nonNegativeMoney, allowances: nonNegativeMoney }),
    z.object({ kind: z.literal("stipend"), stipend: nonNegativeMoney }),
  ]),
  joinedOn: plainDate.optional(),
  lastWorkingDay: plainDate.optional(),
  // Whole or half days.
  unpaidLeaveDays: z
    .number()
    .nonnegative()
    .refine((days) => Number.isInteger(days * 2), "Unpaid leave is counted in whole or half days"),
  lines: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("arrear"), amount: nonNegativeMoney, note: z.string() }),
      z.object({ kind: z.literal("bonus"), amount: nonNegativeMoney, note: z.string() }),
      // An admin override; may lower gross.
      z.object({ kind: z.literal("adjustment"), amount: money, note: z.string() }),
    ]),
  ),
  recoveries: z.array(z.object({ kind: z.literal("advance_recovery"), amount: nonNegativeMoney, note: z.string() })),
});

export type PayInput = {
  employmentType: EmploymentType;
  month: PayrollMonth;
  regularPay: { kind: "salary"; basic: Chhertum; allowances: Chhertum } | { kind: "stipend"; stipend: Chhertum };
  joinedOn?: PlainDate;
  lastWorkingDay?: PlainDate;
  unpaidLeaveDays: number;
  lines: { kind: "arrear" | "bonus" | "adjustment"; amount: Chhertum; note: string }[];
  recoveries: { kind: "advance_recovery"; amount: Chhertum; note: string }[];
};

export type PayResult = {
  daysInMonth: number;
  daysPaid: number;
  regularPayDue: Chhertum;
  gross: Chhertum;
  healthContribution: Chhertum;
  providentFund: Chhertum;
  gis: Chhertum;
  /** gross − PF − GIS, exact. The IT-1(a) "net" figure. */
  taxable: Chhertum;
  /** Taxable rounded up as DRC's method requires; used only to find TDS. */
  taxableForTds: Chhertum;
  tds: Chhertum;
  recoveries: Chhertum;
  takeHome: Chhertum;
  ruleIds: string[];
};

const rateOf = (amount: Chhertum, rate: number) => BigInt(amount) * BigInt(rate);
const PER_WHOLE = BigInt(BASIS_POINTS_PER_WHOLE);

/**
 * Monthly pay × paid days ÷ days in the month, rounded once to the proration rule's unit.
 * Counted in half days so half-day leave stays exact. A full month is not rounded.
 */
export function prorateRegularPay(monthlyPay: Chhertum, paidHalfDays: number, monthHalfDays: number, rule: ProrationRule): Chhertum {
  if (paidHalfDays >= monthHalfDays) return monthlyPay;
  return divideAndRound(BigInt(monthlyPay) * BigInt(paidHalfDays), BigInt(monthHalfDays), rule.roundTo, rule.rounding);
}

export function calculateGross(regularPayDue: Chhertum, lines: PayInput["lines"]): Chhertum {
  return lines.reduce((sum, line) => sum + line.amount, regularPayDue);
}

/** HC is a share of gross, before any deduction. */
export function calculateHealthContribution(gross: Chhertum, rule: HealthContributionRule): Chhertum {
  if (!rule.enabled) return 0;
  return divideAndRound(rateOf(gross, rule.rate), PER_WHOLE, rule.roundTo, rule.rounding);
}

export function calculateProvidentFund(gross: Chhertum, rule: ProvidentFundRule): Chhertum {
  if (!rule.enabled) return 0;
  return divideAndRound(rateOf(gross, rule.employeeRate), PER_WHOLE, rule.roundTo, rule.rounding);
}

export function calculateTaxable(gross: Chhertum, providentFund: Chhertum, gis: Chhertum): Chhertum {
  return gross - providentFund - gis;
}

/**
 * Progressive bands on taxable, after rounding taxable up. Band edges are annual; rather than
 * dividing them (and rounding), taxable is multiplied by monthsPerYear so every step stays exact.
 */
export function calculateTds(taxable: Chhertum, rule: TdsRule): { taxableForTds: Chhertum; tds: Chhertum } {
  if (taxable <= 0) return { taxableForTds: 0, tds: 0 };
  const taxableForTds = divideAndRound(BigInt(taxable), 1n, rule.taxableRoundUpTo, "up");
  const annualised = BigInt(taxableForTds) * BigInt(rule.monthsPerYear);

  let scaledTax = 0n;
  rule.bands.forEach((band, i) => {
    const lower = BigInt(band.fromAnnual);
    if (annualised <= lower) return;
    const next = rule.bands[i + 1];
    const upper = next && annualised > BigInt(next.fromAnnual) ? BigInt(next.fromAnnual) : annualised;
    scaledTax += (upper - lower) * BigInt(band.rate);
  });

  const tds = divideAndRound(scaledTax, BigInt(rule.monthsPerYear) * PER_WHOLE, rule.resultRoundTo, rule.resultRounding);
  return { taxableForTds, tds };
}

export function calculateTakeHome(parts: {
  gross: Chhertum;
  providentFund: Chhertum;
  gis: Chhertum;
  tds: Chhertum;
  healthContribution: Chhertum;
  recoveries: Chhertum;
}): Chhertum {
  return parts.gross - parts.providentFund - parts.gis - parts.tds - parts.healthContribution - parts.recoveries;
}

/** One person, one month: gross → HC → PF → GIS → taxable → TDS → take-home. */
export function calculatePay(rawInput: PayInput, rules: ResolvedRules): PayResult {
  const input = payInputSchema.parse(rawInput) as PayInput;

  if (input.employmentType !== rules.employmentType) {
    throw new Error("These rules are for a different employment type");
  }
  if (input.month.year !== rules.month.year || input.month.month !== rules.month.month) {
    throw new Error("These rules are for a different month");
  }
  const expectedKind = input.employmentType === "intern" ? "stipend" : "salary";
  if (input.regularPay.kind !== expectedKind) {
    throw new Error(`A ${input.employmentType} employment type is paid by ${expectedKind}`);
  }

  const monthDays = daysInMonth(input.month);
  const employedDays = daysEmployedInMonth(input.month, input.joinedOn, input.lastWorkingDay);
  if (employedDays === 0) throw new Error("This person is not employed in this month");

  const halfDay = 2;
  const unpaidHalfDays = input.unpaidLeaveDays * halfDay;
  const paidHalfDays = employedDays * halfDay - unpaidHalfDays;
  if (paidHalfDays < 0) throw new Error("More unpaid leave than days employed this month");

  const monthlyPay =
    input.regularPay.kind === "salary" ? input.regularPay.basic + input.regularPay.allowances : input.regularPay.stipend;
  const regularPayDue = prorateRegularPay(monthlyPay, paidHalfDays, monthDays * halfDay, rules.proration);

  const gross = calculateGross(regularPayDue, input.lines);
  if (gross < 0) throw new Error("Adjustments cannot make gross pay negative");

  const healthContribution = calculateHealthContribution(gross, rules.healthContribution);
  const providentFund = calculateProvidentFund(gross, rules.providentFund);
  const gis = rules.gis.amount;
  const taxable = calculateTaxable(gross, providentFund, gis);
  const { taxableForTds, tds } = calculateTds(taxable, rules.tds);
  const recoveries = toChhertum(input.recoveries.reduce((sum, recovery) => sum + BigInt(recovery.amount), 0n));
  const takeHome = calculateTakeHome({ gross, providentFund, gis, tds, healthContribution, recoveries });

  return {
    daysInMonth: monthDays,
    daysPaid: paidHalfDays / halfDay,
    regularPayDue,
    gross,
    healthContribution,
    providentFund,
    gis,
    taxable,
    taxableForTds,
    tds,
    recoveries,
    takeHome,
    ruleIds: [...rules.ruleIds],
  };
}
