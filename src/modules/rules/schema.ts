import { z } from "zod";
import { BASIS_POINTS_PER_WHOLE, type LeaveAllowance, type LeavePolicy, type LeaveType, type RuleKey, type RuleValues } from "./types";

// Rule values are stored as snake_case jsonb and validated here before any calculation sees them.

const chhertum = z.number().int().nonnegative().refine(Number.isSafeInteger, "Amount is too large");
const positiveChhertum = chhertum.refine((value) => value > 0, "Must be more than zero");
const basisPoints = z.number().int().min(0).max(BASIS_POINTS_PER_WHOLE);
const rounding = z.enum(["nearest", "down", "up"]);

const tds = z
  .object({
    bands: z.array(z.object({ from_annual_ch: chhertum, rate_bp: basisPoints }).strict()).min(1),
    months_per_year: z.number().int().positive(),
    taxable_round_up_to_ch: positiveChhertum,
    result_round_to_ch: positiveChhertum,
    result_rounding: rounding,
  })
  .strict()
  .refine((value) => value.bands[0]?.from_annual_ch === 0, "The first TDS band must start at zero")
  .refine(
    (value) => value.bands.every((band, i) => i === 0 || band.from_annual_ch > (value.bands[i - 1]?.from_annual_ch ?? 0)),
    "TDS bands must rise",
  )
  .transform((value) => ({
    bands: value.bands.map((band) => ({ fromAnnual: band.from_annual_ch, rate: band.rate_bp })),
    monthsPerYear: value.months_per_year,
    taxableRoundUpTo: value.taxable_round_up_to_ch,
    resultRoundTo: value.result_round_to_ch,
    resultRounding: value.result_rounding,
  }));

const healthContribution = z
  .object({ enabled: z.boolean(), rate_bp: basisPoints, round_to_ch: positiveChhertum, rounding })
  .strict()
  .transform((value) => ({ enabled: value.enabled, rate: value.rate_bp, roundTo: value.round_to_ch, rounding: value.rounding }));

// PF cannot be switched on without its rate and its rounding: nothing is defaulted.
const providentFund = z
  .discriminatedUnion("enabled", [
    z.object({ enabled: z.literal(false) }).strict(),
    z.object({ enabled: z.literal(true), employee_rate_bp: basisPoints, round_to_ch: positiveChhertum, rounding }).strict(),
  ])
  .transform((value) =>
    value.enabled
      ? { enabled: true as const, employeeRate: value.employee_rate_bp, roundTo: value.round_to_ch, rounding: value.rounding }
      : { enabled: false as const },
  );

const gis = z
  .object({ amount_ch: chhertum })
  .strict()
  .transform((value) => ({ amount: value.amount_ch }));

const proration = z
  .object({ basis: z.literal("calendar_days"), round_to_ch: positiveChhertum, rounding })
  .strict()
  .transform((value) => ({ basis: value.basis, roundTo: value.round_to_ch, rounding: value.rounding }));

const it1aInclusion = z.object({ include: z.boolean() }).strict();

// ── Leave ─────────────────────────────────────────────────────────────────────

const LEAVE_TYPE_NAMES = [
  "annual",
  "sick",
  "professional_development",
  "maternity",
  "paternity",
  "bereavement",
  "family_emergency",
  "unpaid",
] as const satisfies readonly LeaveType[];

// Leave is counted in whole or half days.
const leaveDays = z
  .number()
  .nonnegative()
  .refine((days) => Number.isInteger(days * 2), "Leave days are whole or half days");

const allowance = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("per_year"), days: leaveDays, prorate: z.boolean() }).strict(),
    z
      .object({
        kind: z.literal("per_event"),
        days: leaveDays,
        later_child_days: leaveDays.nullable(),
        within_days_of_event: z.number().int().positive().nullable(),
      })
      .strict(),
    z.object({ kind: z.literal("approval_only") }).strict(),
    z.object({ kind: z.literal("unlimited") }).strict(),
  ])
  .transform((value): LeaveAllowance => {
    switch (value.kind) {
      case "per_year":
        return { kind: "perYear", days: value.days, prorate: value.prorate };
      case "per_event":
        return {
          kind: "perEvent",
          days: value.days,
          laterChildDays: value.later_child_days,
          withinDaysOfEvent: value.within_days_of_event,
        };
      case "approval_only":
        return { kind: "approvalOnly" };
      default:
        return { kind: "unlimited" };
    }
  });

const leaveTypePolicy = z
  .object({ allowance, count: z.enum(["working", "calendar"]), half_days: z.boolean(), paid: z.boolean() })
  .strict()
  .transform((value) => ({ allowance: value.allowance, count: value.count, halfDays: value.half_days, paid: value.paid }));

const leavePolicy = z
  .object({ types: z.partialRecord(z.enum(LEAVE_TYPE_NAMES), leaveTypePolicy) })
  .strict()
  .transform((value) => value.types as LeavePolicy);

const leaveCarryForward = z
  .object({ days: z.partialRecord(z.enum(LEAVE_TYPE_NAMES), leaveDays) })
  .strict()
  .transform((value) => value.days);

const workingWeek = z
  .object({ days: z.array(z.number().int().min(1).max(7)).min(1) })
  .strict()
  .refine((value) => new Set(value.days).size === value.days.length, "A weekday is listed twice");

const prorationCutoff = z.object({ day: z.number().int().min(1).max(28) }).strict();
const leaveBackdate = z.object({ months: z.number().int().min(0).max(12) }).strict();
const leaveExitPayout = z.object({ enabled: z.boolean() }).strict();

// ── Payroll settings ──────────────────────────────────────────────────────────

const payrollSettings = z
  .object({
    first_month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "The first month is stored as its 1st")
      .nullable(),
    large_change_bp: z.number().int().positive(),
    due_day: z.number().int().min(1).max(28),
  })
  .strict()
  .transform((value) => ({
    firstMonth: value.first_month ? { year: Number(value.first_month.slice(0, 4)), month: Number(value.first_month.slice(5, 7)) } : null,
    largeChange: value.large_change_bp,
    dueDay: value.due_day,
  }));

const schemas = {
  tds,
  health_contribution: healthContribution,
  provident_fund: providentFund,
  gis,
  proration,
  it1a_inclusion: it1aInclusion,
  leave_policy: leavePolicy,
  leave_carry_forward: leaveCarryForward,
  working_week: workingWeek,
  proration_cutoff: prorationCutoff,
  leave_backdate: leaveBackdate,
  leave_exit_payout: leaveExitPayout,
  payroll_settings: payrollSettings,
} satisfies { [K in RuleKey]: z.ZodType<RuleValues[K]> };

export function parseRuleValue<K extends RuleKey>(key: K, value: unknown): RuleValues[K] {
  return schemas[key].parse(value) as RuleValues[K];
}
