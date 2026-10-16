import "server-only";
import { and, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { people } from "@/lib/db/schema";
import { firstOfMonth } from "@/lib/format";
import { thisMonth } from "@/modules/people/repository";
import { resolvePayrollSettings } from "@/modules/rules/resolve";
import { loadRuleRows } from "@/modules/rules/repository";
import type { LeaveType } from "@/modules/rules/types";
import { balancesFor, loadLeaveContext } from "./repository";

// Leave already taken this leave year before DashTeam started: one number per person and yearly
// leave type, entered once by an admin. It counts as used in every balance from then on.

export type OpeningLine = {
  leaveType: LeaveType;
  entitlement: number;
  /** Approved in DashTeam this year, not counting the opening days. */
  inDashTeam: number;
  pending: number;
  opening: number;
};

export type OpeningPerson = { personId: string; name: string; lines: OpeningLine[] };

export type OpeningView =
  | { ready: false }
  | { ready: true; year: number; asOf: string; locked: boolean; people: OpeningPerson[] };

/** Everyone who worked here when DashTeam started, with their yearly leave and what's entered. */
export async function openingLeaveView(admin: SessionUser): Promise<OpeningView> {
  const ruleRows = await loadRuleRows(claimsFor(admin));
  const first = resolvePayrollSettings(ruleRows, thisMonth()).firstMonth;
  if (!first) return { ready: false };
  const asOf = firstOfMonth(first);
  const { team, locked } = await asUser(claimsFor(admin), async (tx) => {
    const team = await tx
      .select({ id: people.id, name: people.fullName })
      .from(people)
      .where(and(sql`${people.startDate} < ${asOf}`, sql`(${people.endDate} is null or ${people.endDate} >= ${asOf})`))
      .orderBy(people.fullName);
    const [live] = await tx.execute<{ locked: boolean }>(sql`select public.live_month_locked() as locked`);
    return { team, locked: Boolean(live?.locked) };
  });

  const rows: OpeningPerson[] = [];
  for (const person of team) {
    const context = await loadLeaveContext(admin, person.id);
    if (!context) continue;
    const lines = balancesFor(context, first.year).flatMap(({ leaveType, balance }) =>
      balance.kind === "pool" ? [{ leaveType, entitlement: balance.entitlement, inDashTeam: balance.used - balance.opening, pending: balance.pending, opening: balance.opening }] : [],
    );
    rows.push({ personId: person.id, name: person.name, lines });
  }
  return { ready: true, year: first.year, asOf, locked, people: rows };
}
