import "server-only";
import { type JwtClaims, asUser } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { resolveRules } from "./resolve";
import { toRuleRow } from "./rows";
import type { EmploymentType, PayrollMonth, ResolvedRules, RuleRow } from "./types";

// Reads run as the signed-in person, so RLS decides who may see rules (admins only).

export async function loadRuleRows(claims: JwtClaims): Promise<RuleRow[]> {
  const stored = await asUser(claims, (tx) =>
    tx
      .select({
        id: rules.id,
        key: rules.key,
        employmentType: rules.employmentType,
        effectiveFrom: rules.effectiveFrom,
        value: rules.value,
      })
      .from(rules),
  );
  return stored.map(toRuleRow);
}

export async function loadRulesFor(
  claims: JwtClaims,
  employmentType: EmploymentType,
  month: PayrollMonth,
): Promise<ResolvedRules> {
  return resolveRules(await loadRuleRows(claims), employmentType, month);
}
