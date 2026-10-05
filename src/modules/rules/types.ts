// Types shared by the rules engine and the payroll module.
// modules/payroll may import from this file and nothing else in the app.

export type EmploymentType = "full_time" | "intern";
export const EMPLOYMENT_TYPES = ["full_time", "intern"] as const satisfies readonly EmploymentType[];

// Payroll rules feed the payroll calculation; leave rules feed the leave module. They are resolved
// separately so a leave rule can never change how pay is calculated.
export type PayrollRuleKey = "tds" | "health_contribution" | "provident_fund" | "gis" | "proration" | "it1a_inclusion";
export const PAYROLL_RULE_KEYS = [
  "tds",
  "health_contribution",
  "provident_fund",
  "gis",
  "proration",
  "it1a_inclusion",
] as const satisfies readonly PayrollRuleKey[];

export type LeaveRuleKey =
  | "leave_policy"
  | "leave_carry_forward"
  | "working_week"
  | "proration_cutoff"
  | "leave_backdate"
  | "leave_exit_payout";
export const LEAVE_RULE_KEYS = [
  "leave_policy",
  "leave_carry_forward",
  "working_week",
  "proration_cutoff",
  "leave_backdate",
  "leave_exit_payout",
] as const satisfies readonly LeaveRuleKey[];

// Company-wide settings: payroll (milestone 4) and the company's details on documents (milestone 5).
// Stored for both employment types and written together.
export type SettingsRuleKey = "payroll_settings" | "company_details";
export const SETTINGS_RULE_KEYS = ["payroll_settings", "company_details"] as const satisfies readonly SettingsRuleKey[];

export type RuleKey = PayrollRuleKey | LeaveRuleKey | SettingsRuleKey;
// Order matters: it is the order of the database enum, which only ever grows at the end.
export const RULE_KEYS = [...PAYROLL_RULE_KEYS, ...LEAVE_RULE_KEYS, ...SETTINGS_RULE_KEYS] as const satisfies readonly RuleKey[];

/** Integer chhertum. 1 Nu. = 100 Ch. Never a float. */
export type Chhertum = number;

/** Rates are basis points: 1% = 100. This is the unit definition, not a rate. */
export type BasisPoints = number;
export const BASIS_POINTS_PER_WHOLE = 10_000;

/** "nearest" always rounds half up. */
export type RoundingMode = "nearest" | "down" | "up";

/** A payroll month is a calendar month. month is 1 to 12. */
export type PayrollMonth = { year: number; month: number };

/** A calendar date in Asia/Thimphu, "YYYY-MM-DD". */
export type PlainDate = `${number}-${number}-${number}`;

export type TdsBand = { fromAnnual: Chhertum; rate: BasisPoints };

export type TdsRule = {
  /** Band edges are annual amounts; a month's edge is the annual edge divided by monthsPerYear, kept exact. */
  bands: TdsBand[];
  monthsPerYear: number;
  taxableRoundUpTo: Chhertum;
  resultRoundTo: Chhertum;
  resultRounding: RoundingMode;
};

export type HealthContributionRule = {
  enabled: boolean;
  rate: BasisPoints;
  roundTo: Chhertum;
  rounding: RoundingMode;
};

export type ProvidentFundRule =
  | { enabled: false }
  | { enabled: true; employeeRate: BasisPoints; roundTo: Chhertum; rounding: RoundingMode };

export type GisRule = { amount: Chhertum };

export type ProrationRule = { basis: "calendar_days"; roundTo: Chhertum; rounding: RoundingMode };

export type It1aInclusionRule = { include: boolean };

export type PayrollRuleValues = {
  tds: TdsRule;
  health_contribution: HealthContributionRule;
  provident_fund: ProvidentFundRule;
  gis: GisRule;
  proration: ProrationRule;
  it1a_inclusion: It1aInclusionRule;
};

// ── Leave ─────────────────────────────────────────────────────────────────────

export type LeaveType =
  | "annual"
  | "sick"
  | "professional_development"
  | "maternity"
  | "paternity"
  | "bereavement"
  | "family_emergency"
  | "unpaid";
export const LEAVE_TYPES = [
  "annual",
  "sick",
  "professional_development",
  "maternity",
  "paternity",
  "bereavement",
  "family_emergency",
  "unpaid",
] as const satisfies readonly LeaveType[];

export type ChildOrder = "first_or_second" | "later";

export type LeaveAllowance =
  /** A pool for the leave year, pro-rated by months employed if `prorate`. */
  | { kind: "perYear"; days: number; prorate: boolean }
  /** An allowance for each event (a birth, a bereavement). `laterChildDays` applies from the third child. */
  | { kind: "perEvent"; days: number; laterChildDays: number | null; withinDaysOfEvent: number | null }
  /** Paid, needs approval, counted and recorded, but no allowance is set yet. */
  | { kind: "approvalOnly" }
  /** No limit (unpaid leave). */
  | { kind: "unlimited" };

export type LeaveTypePolicy = {
  allowance: LeaveAllowance;
  /** Working days skip weekends and holidays; calendar days count every day. */
  count: "working" | "calendar";
  halfDays: boolean;
  paid: boolean;
};

/** Leave types an employment type can take. A type that isn't listed isn't offered. */
export type LeavePolicy = Partial<Record<LeaveType, LeaveTypePolicy>>;

export type LeaveRuleValues = {
  leave_policy: LeavePolicy;
  leave_carry_forward: Partial<Record<LeaveType, number>>;
  /** ISO weekdays: 1 is Monday, 7 is Sunday. */
  working_week: { days: number[] };
  /** A joining month counts if they start on or before this day; an exit month if they leave on or after it. */
  proration_cutoff: { day: number };
  /** How many earlier months a person may still request leave for, besides this one. */
  leave_backdate: { months: number };
  leave_exit_payout: { enabled: boolean };
};

export type SettingsRuleValues = {
  payroll_settings: {
    /** The first month DashTeam pays. Null until the admin sets it. Earlier months are never run here. */
    firstMonth: PayrollMonth | null;
    /** A take-home this far up or down from last month is flagged on the review screen. */
    largeChange: BasisPoints;
    /** TDS and HC for a month are due on this day of the next month. */
    dueDay: number;
  };
  company_details: {
    name: string;
    /** Printed under the name on payslips. Empty until the address is added. */
    addressLines: string[];
    /** Whether documents show the logo file in src/modules/documents/assets. */
    showLogo: boolean;
  };
};

export type RuleValues = PayrollRuleValues & LeaveRuleValues & SettingsRuleValues;

export type PayrollSettings = SettingsRuleValues["payroll_settings"] & { ruleIds: string[] };
export type CompanyDetails = SettingsRuleValues["company_details"] & { ruleIds: string[] };

/** Every leave rule in force for one employment type in one month. */
export type ResolvedLeaveRules = {
  employmentType: EmploymentType;
  month: PayrollMonth;
  policy: LeavePolicy;
  carryForward: Partial<Record<LeaveType, number>>;
  workingWeek: number[];
  prorationCutoffDay: number;
  backdateMonths: number;
  exitPayout: { enabled: boolean };
  ruleIds: string[];
};

/** A row as stored: value is the raw jsonb, validated when resolved. */
export type RuleRow = {
  id: string;
  key: RuleKey;
  employmentType: EmploymentType;
  effectiveFrom: PlainDate;
  value: unknown;
};

/** Every rule in force for one employment type in one payroll month. */
export type ResolvedRules = {
  employmentType: EmploymentType;
  month: PayrollMonth;
  tds: TdsRule;
  healthContribution: HealthContributionRule;
  providentFund: ProvidentFundRule;
  gis: GisRule;
  proration: ProrationRule;
  it1aInclusion: It1aInclusionRule;
  /** Ids of the rows used, recorded with every result as its rules version. */
  ruleIds: string[];
};
