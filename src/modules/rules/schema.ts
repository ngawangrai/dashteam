import { z } from "zod";
import { BASIS_POINTS_PER_WHOLE, type RuleKey, type RuleValues } from "./types";

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

const schemas = {
  tds,
  health_contribution: healthContribution,
  provident_fund: providentFund,
  gis,
  proration,
  it1a_inclusion: it1aInclusion,
} satisfies { [K in RuleKey]: z.ZodType<RuleValues[K]> };

export function parseRuleValue<K extends RuleKey>(key: K, value: unknown): RuleValues[K] {
  return schemas[key].parse(value) as RuleValues[K];
}
