// Types shared by the rules engine and the payroll module.
// modules/payroll may import from this file and nothing else in the app.

export type EmploymentType = "full_time" | "intern";
export const EMPLOYMENT_TYPES = ["full_time", "intern"] as const satisfies readonly EmploymentType[];

export type RuleKey = "tds" | "health_contribution" | "provident_fund" | "gis" | "proration" | "it1a_inclusion";
export const RULE_KEYS = [
  "tds",
  "health_contribution",
  "provident_fund",
  "gis",
  "proration",
  "it1a_inclusion",
] as const satisfies readonly RuleKey[];

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

export type RuleValues = {
  tds: TdsRule;
  health_contribution: HealthContributionRule;
  provident_fund: ProvidentFundRule;
  gis: GisRule;
  proration: ProrationRule;
  it1a_inclusion: It1aInclusionRule;
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
