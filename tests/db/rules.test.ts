import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { calculatePay, type PayInput } from "@/modules/payroll";
import { resolveRules } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import type { EmploymentType, RuleKey, RuleRow } from "@/modules/rules/types";
import { V1_COMPANY_RULE_ROWS, V1_LEAVE_RULE_ROWS, V1_RULE_ROWS, V1_SETTINGS_RULE_ROWS } from "@/modules/rules/v1";
import { ADMIN_ID, EMPLOYEE_ID, as, rolledBack } from "./local-db";

type DbRule = { id: string; key: RuleKey; employment_type: EmploymentType; effective_from: string; value: unknown };

async function ruleRows(tx: postgres.TransactionSql): Promise<RuleRow[]> {
  const rows = await tx<DbRule[]>`select id, key, employment_type, effective_from::text, value from public.rules`;
  return rows.map((row) =>
    toRuleRow({ id: row.id, key: row.key, employmentType: row.employment_type, effectiveFrom: row.effective_from, value: row.value }),
  );
}

const ALL_V1_ROWS = [...V1_RULE_ROWS, ...V1_LEAVE_RULE_ROWS, ...V1_SETTINGS_RULE_ROWS, ...V1_COMPANY_RULE_ROWS];
const october = { year: 2026, month: 10 };
const november = { year: 2026, month: 11 };
const fullTimeInput = (month = october): PayInput => ({
  employmentType: "full_time",
  month,
  regularPay: { kind: "salary", basic: 5_000_000, allowances: 1_000_000 },
  unpaidLeaveDays: 0,
  lines: [],
  recoveries: [],
});

describe("rules access", () => {
  it("lets admins read every rule", async () => {
    const rows = await as(ADMIN_ID, (tx) => tx`select id from public.rules`);
    expect(rows).toHaveLength(ALL_V1_ROWS.length);
  });

  // Since milestone 3: rates and leave policy aren't secret, and everyone's leave balance needs them.
  it("lets employees read rules, but not change them", async () => {
    const rows = await as(EMPLOYEE_ID, (tx) => tx`select id from public.rules`);
    expect(rows).toHaveLength(ALL_V1_ROWS.length);
    await expect(as(EMPLOYEE_ID, (tx) => tx`update public.rules set note = 'x'`)).rejects.toThrow(/permission denied/);
  });

  it("gives signed-out visitors nothing", async () => {
    await expect(as(null, (tx) => tx`select id from public.rules`)).rejects.toThrow(/permission denied/);
  });

  it("refuses rate and leave rules through the API, even from an admin", async () => {
    await expect(
      as(ADMIN_ID, (tx) => tx`insert into public.rules (key, employment_type, effective_from, value, note)
                              values ('gis', 'full_time', '2027-01-01', '{"amount_ch": 0}', 'test')`),
    ).rejects.toThrow(/row-level security/);
  });

  // Since milestone 4: the first payroll month is set from the Payroll screen.
  it("lets an admin add payroll settings, and nobody else", async () => {
    const insertSettings = (tx: postgres.TransactionSql) =>
      tx`insert into public.rules (key, employment_type, effective_from, value, note)
         values ('payroll_settings', 'full_time', '2027-01-01', '{"first_month": "2027-01-01", "large_change_bp": 1000, "due_day": 10}', 'test')
         returning id`;
    expect(await as(ADMIN_ID, insertSettings)).toHaveLength(1);
    await expect(as(EMPLOYEE_ID, insertSettings)).rejects.toThrow(/row-level security/);
  });
});

describe("rules are append-only", () => {
  it("rejects any update, even by the database owner", async () => {
    await expect(rolledBack((tx) => tx`update public.rules set note = 'changed'`)).rejects.toThrow(/cannot be changed/);
  });

  it("rejects deleting a rule that is already in force", async () => {
    await expect(rolledBack((tx) => tx`delete from public.rules where effective_from = '2026-01-01'`)).rejects.toThrow(
      /already in force/,
    );
  });

  it("allows deleting a future rule entered by mistake", async () => {
    const deleted = await rolledBack(async (tx) => {
      await tx`insert into public.rules (key, employment_type, effective_from, value, note)
               values ('gis', 'full_time', '2099-01-01', '{"amount_ch": 0}', 'mistake')`;
      return tx`delete from public.rules where effective_from = '2099-01-01' returning id`;
    });
    expect(deleted).toHaveLength(1);
  });

  it("only starts a rule on the first of a month", async () => {
    await expect(
      rolledBack((tx) => tx`insert into public.rules (key, employment_type, effective_from, value, note)
                            values ('gis', 'full_time', '2027-01-15', '{"amount_ch": 0}', 'mid-month')`),
    ).rejects.toThrow(/rules_effective_from_first_of_month/);
  });
});

describe("V1 rules in the database", () => {
  it("match src/modules/rules/v1.ts exactly", async () => {
    const stored = await rolledBack(ruleRows);
    const normalise = (rows: RuleRow[]) =>
      rows
        .map(({ key, employmentType, effectiveFrom, value }) => ({ key, employmentType, effectiveFrom, value }))
        .sort((a, b) => `${a.key}${a.employmentType}`.localeCompare(`${b.key}${b.employmentType}`));
    expect(normalise(stored)).toEqual(normalise(ALL_V1_ROWS));
  });

  it("calculate the same pay as the rules the unit tests use", async () => {
    const stored = await rolledBack(ruleRows);
    const fromDatabase = calculatePay(fullTimeInput(), resolveRules(stored, "full_time", october));
    const fromV1 = calculatePay(fullTimeInput(), resolveRules(V1_RULE_ROWS, "full_time", october));
    expect({ ...fromDatabase, ruleIds: [] }).toEqual({ ...fromV1, ruleIds: [] });
    expect(fromDatabase.tds).toBe(512_500);
  });
});

describe("a new rule row changes the calculation with no code change", () => {
  it("applies from its month and leaves earlier months alone", async () => {
    const { before, after } = await rolledBack(async (tx) => {
      const before = await ruleRows(tx);
      await tx`insert into public.rules (key, employment_type, effective_from, value, note)
               values ('health_contribution', 'full_time', '2026-11-01',
                       '{"enabled": true, "rate_bp": 200, "round_to_ch": 100, "rounding": "nearest"}', 'test: 2% from November')`;
      return { before, after: await ruleRows(tx) };
    });

    const hc = (rows: RuleRow[], month: typeof october) =>
      calculatePay(fullTimeInput(month), resolveRules(rows, "full_time", month)).healthContribution;

    expect(hc(after, october)).toBe(hc(before, october));
    expect(hc(before, november)).toBe(60_000);
    expect(hc(after, november)).toBe(120_000);
  });
});
