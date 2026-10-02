import type { EmploymentType, RuleKey, RuleRow } from "./types";

// The V1 rules from docs/PRD.md, in force from January 2026, as stored in the database (snake_case jsonb).
// supabase/migrations/*_v1_rules.sql inserts exactly these; tests/db/rules.test.ts checks the two match.
// Tests use these rows so they exercise the real values without a database.

export const V1_EFFECTIVE_FROM = "2026-01-01";

// DRC Annexure III, revised schedule for monthly salary income. Edges are annual, in chhertum.
const tds = {
  bands: [
    { from_annual_ch: 0, rate_bp: 0 },
    { from_annual_ch: 30_000_000, rate_bp: 1_000 },
    { from_annual_ch: 40_000_000, rate_bp: 1_500 },
    { from_annual_ch: 65_000_000, rate_bp: 2_000 },
    { from_annual_ch: 100_000_000, rate_bp: 2_500 },
    { from_annual_ch: 150_000_000, rate_bp: 3_000 },
  ],
  months_per_year: 12,
  taxable_round_up_to_ch: 10_000,
  result_round_to_ch: 100,
  result_rounding: "nearest",
};

const values: Record<EmploymentType, Record<RuleKey, unknown>> = {
  full_time: {
    tds,
    health_contribution: { enabled: true, rate_bp: 100, round_to_ch: 100, rounding: "nearest" },
    provident_fund: { enabled: false },
    gis: { amount_ch: 0 },
    proration: { basis: "calendar_days", round_to_ch: 100, rounding: "nearest" },
    it1a_inclusion: { include: true },
  },
  intern: {
    tds,
    // HC on intern stipends: setting, default on (PRD open question).
    health_contribution: { enabled: true, rate_bp: 100, round_to_ch: 100, rounding: "nearest" },
    // PF applies to employees only.
    provident_fund: { enabled: false },
    gis: { amount_ch: 0 },
    proration: { basis: "calendar_days", round_to_ch: 100, rounding: "nearest" },
    // Interns on IT-1(a): setting, default include (PRD open question).
    it1a_inclusion: { include: true },
  },
};

export const V1_NOTES: Record<RuleKey, string> = {
  tds: "DRC Annexure III, revised TDS schedule for monthly salary income",
  health_contribution: "Health contribution, 1% of gross. Rounding to confirm with the accountant",
  provident_fund: "Off until NPPF registration (2027)",
  gis: "Not applicable to Xceed",
  proration: "Calendar days, basic + allowances or stipend",
  it1a_inclusion: "Include interns on IT-1(a). To confirm with the accountant",
};

export const V1_RULE_ROWS: RuleRow[] = (Object.keys(values) as EmploymentType[]).flatMap((employmentType) =>
  (Object.keys(values[employmentType]) as RuleKey[]).map((key) => ({
    id: `v1:${key}:${employmentType}`,
    key,
    employmentType,
    effectiveFrom: V1_EFFECTIVE_FROM,
    value: values[employmentType][key],
  })),
);
