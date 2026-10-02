import type { EmploymentType, PlainDate, RuleKey, RuleRow } from "./types";

type StoredRule = {
  id: string;
  key: RuleKey;
  employmentType: EmploymentType;
  effectiveFrom: string;
  value: unknown;
};

/** A database row as the rules engine sees it. Values are validated later, when resolved. */
export function toRuleRow(row: StoredRule): RuleRow {
  return {
    id: row.id,
    key: row.key,
    employmentType: row.employmentType,
    effectiveFrom: row.effectiveFrom as PlainDate,
    value: row.value,
  };
}
