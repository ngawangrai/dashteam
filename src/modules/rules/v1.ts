import type { EmploymentType, LeaveRuleKey, PayrollRuleKey, RuleRow } from "./types";

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

const values: Record<EmploymentType, Record<PayrollRuleKey, unknown>> = {
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

export const V1_NOTES: Record<PayrollRuleKey, string> = {
  tds: "DRC Annexure III, revised TDS schedule for monthly salary income",
  health_contribution: "Health contribution, 1% of gross. Rounding to confirm with the accountant",
  provident_fund: "Off until NPPF registration (2027)",
  gis: "Not applicable to Xceed",
  proration: "Calendar days, basic + allowances or stipend",
  it1a_inclusion: "Include interns on IT-1(a). To confirm with the accountant",
};

export const V1_RULE_ROWS: RuleRow[] = (Object.keys(values) as EmploymentType[]).flatMap((employmentType) =>
  (Object.keys(values[employmentType]) as PayrollRuleKey[]).map((key) => ({
    id: `v1:${key}:${employmentType}`,
    key,
    employmentType,
    effectiveFrom: V1_EFFECTIVE_FROM,
    value: values[employmentType][key],
  })),
);

// ── Leave rules (milestone 3) ───────────────────────────────────────────────────
// The founder's V1 policy. Maternity, paternity, bereavement and family emergency are provisional
// pending the legal minimums; they are rules so they change without code.

const perYear = (days: number, prorate: boolean) => ({ kind: "per_year", days, prorate });
const working = (allowance: unknown, halfDays = true) => ({ allowance, count: "working", half_days: halfDays, paid: true });
const approvalOnly = (count: "working" | "calendar", halfDays: boolean) => ({
  allowance: { kind: "approval_only" },
  count,
  half_days: halfDays,
  paid: true,
});
const unpaid = { allowance: { kind: "unlimited" }, count: "working", half_days: true, paid: false };

const leavePolicy: Record<EmploymentType, unknown> = {
  full_time: {
    types: {
      annual: working(perYear(25, true)),
      sick: working(perYear(14, true)),
      professional_development: working(perYear(5, true)),
      maternity: {
        allowance: { kind: "per_event", days: 180, later_child_days: 90, within_days_of_event: null },
        count: "calendar",
        half_days: false,
        paid: true,
      },
      paternity: working({ kind: "per_event", days: 10, later_child_days: 5, within_days_of_event: 30 }, false),
      bereavement: working({ kind: "per_event", days: 7, later_child_days: null, within_days_of_event: null }),
      family_emergency: working(perYear(3, false)),
      unpaid,
    },
  },
  intern: {
    types: {
      sick: working(perYear(14, true)),
      maternity: approvalOnly("calendar", false),
      paternity: approvalOnly("working", false),
      bereavement: approvalOnly("working", true),
      family_emergency: approvalOnly("working", true),
      unpaid,
    },
  },
};

const sharedLeaveValues: Record<Exclude<LeaveRuleKey, "leave_policy">, unknown> = {
  leave_carry_forward: { days: { annual: 0, sick: 0, professional_development: 0, family_emergency: 0 } },
  working_week: { days: [1, 2, 3, 4, 5] },
  proration_cutoff: { day: 15 },
  leave_backdate: { months: 1 },
  leave_exit_payout: { enabled: false },
};

export const V1_LEAVE_NOTES: Record<LeaveRuleKey, string> = {
  leave_policy: "V1 leave policy. Special leave values provisional pending the legal minimums",
  leave_carry_forward: "No carry-forward in V1",
  working_week: "Monday to Friday",
  proration_cutoff: "Joining month counts on or before the 15th; exit month on or after it",
  leave_backdate: "Requests may go back to the start of last month",
  leave_exit_payout: "Unused annual leave is not paid out on exit",
};

export const V1_LEAVE_RULE_ROWS: RuleRow[] = (["full_time", "intern"] as const).flatMap((employmentType) =>
  (["leave_policy", ...Object.keys(sharedLeaveValues)] as LeaveRuleKey[]).map((key) => ({
    id: `v1:${key}:${employmentType}`,
    key,
    employmentType,
    effectiveFrom: V1_EFFECTIVE_FROM,
    value: key === "leave_policy" ? leavePolicy[employmentType] : sharedLeaveValues[key as Exclude<LeaveRuleKey, "leave_policy">],
  })),
);

// ── Payroll settings (milestone 4) ──────────────────────────────────────────────
// No first month until the admin chooses one on the Payroll screen.

export const V1_SETTINGS_VALUE = { first_month: null, large_change_bp: 1_000, due_day: 10 };
export const V1_SETTINGS_NOTE = "Payroll settings. First month not set yet; flag a 10% change; TDS and HC due on the 10th";

export const V1_SETTINGS_RULE_ROWS: RuleRow[] = (["full_time", "intern"] as const).map((employmentType) => ({
  id: `v1:payroll_settings:${employmentType}`,
  key: "payroll_settings",
  employmentType,
  effectiveFrom: V1_EFFECTIVE_FROM,
  value: V1_SETTINGS_VALUE,
}));
