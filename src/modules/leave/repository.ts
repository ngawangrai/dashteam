import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { type Holiday as HolidayRow, exitLeaveSettlements, holidays, leaveNotices, leaveRequests, payRecords, people } from "@/lib/db/schema";
import { monthOf, thimphuToday } from "@/lib/format";
import { monthlyPayOf, payInForce } from "@/modules/people/pay";
import { toPayView } from "@/modules/people/repository";
import { loadRuleRows } from "@/modules/rules/repository";
import { resolveLeaveRules } from "@/modules/rules/resolve";
import { type EmploymentType, LEAVE_TYPES, type LeaveType, type RuleRow } from "@/modules/rules/types";
import { type Balance, type Employment, type LeaveRequestFacts, type LockedRange, balanceFor } from "./balance";
import { type LeaveCalendar, countLeaveDays } from "./days";
import { type ExitSettlement, exitSettlement } from "./exit";
import { type Holiday, type ImpactRequest, expandHolidays, holidayLabel, holidaysByDate, tentativeDates } from "./holidays";
import { unpaidLeaveDays } from "./unpaid";

// Reads for the leave screens. Everything runs as the signed-in person, so RLS decides what they see.
// Balances and day counts are worked out here from the stored dates; they are never stored.

export type LeaveRequestView = LeaveRequestFacts & {
  personId: string;
  eventDate: string | null;
  note: string;
  decisionNote: string;
  createdAt: string;
  decidedAt: string | null;
  ownerSeenAt: string | null;
  days: number;
};

export type LeaveContext = {
  personId: string;
  person: Employment;
  employmentType: EmploymentType | null;
  requests: LeaveRequestView[];
  ruleRows: RuleRow[];
  calendar: LeaveCalendar;
};

type RequestRow = typeof leaveRequests.$inferSelect;

function workingWeekNow(ruleRows: RuleRow[], employmentType: EmploymentType): number[] {
  try {
    return resolveLeaveRules(ruleRows, employmentType, monthOf(thimphuToday())).workingWeek;
  } catch {
    return [1, 2, 3, 4, 5];
  }
}

function toView(row: RequestRow, calendar: LeaveCalendar, ruleRows: RuleRow[], employmentType: EmploymentType | null): LeaveRequestView {
  const facts: LeaveRequestFacts = {
    id: row.id,
    leaveType: row.leaveType,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    startHalf: row.startHalf,
    endHalf: row.endHalf,
    childOrder: row.childOrder,
  };
  let count: "working" | "calendar" = "working";
  if (employmentType) {
    try {
      count = resolveLeaveRules(ruleRows, employmentType, monthOf(row.startDate)).policy[row.leaveType]?.count ?? "working";
    } catch {
      // No rules for that month: working days is the safe reading.
    }
  }
  return {
    ...facts,
    personId: row.personId,
    eventDate: row.eventDate,
    note: row.note,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    ownerSeenAt: row.ownerSeenAt?.toISOString() ?? null,
    days: countLeaveDays(facts, calendar, count).total,
  };
}

/** Everything needed to show and check one person's leave. Null if they can't be seen. */
export async function loadLeaveContext(user: SessionUser, personId: string): Promise<LeaveContext | null> {
  const ruleRows = await loadRuleRows(claimsFor(user));
  return asUser(claimsFor(user), async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, personId)).limit(1);
    if (!person) return null;
    const pay = (await tx.select().from(payRecords).where(eq(payRecords.personId, personId))).map(toPayView);
    const month = monthOf(thimphuToday());
    const employmentType = (payInForce(pay, month) ?? pay[0] ?? null)?.employmentType ?? null;
    const allHolidays = (await tx.select().from(holidays).orderBy(asc(holidays.startDate))).map(toHoliday);
    const calendar = calendarFrom(allHolidays, employmentType ? workingWeekNow(ruleRows, employmentType) : [1, 2, 3, 4, 5]);
    const rows = await tx.select().from(leaveRequests).where(eq(leaveRequests.personId, personId)).orderBy(asc(leaveRequests.startDate));
    return {
      personId,
      person: { startDate: person.startDate, endDate: person.endDate },
      employmentType,
      requests: rows.map((row) => toView(row, calendar, ruleRows, employmentType)),
      ruleRows,
      calendar,
    };
  });
}

export type BalanceLine = { leaveType: LeaveType; balance: Balance };

/** Balances for every leave type this person can take, in a fixed order. */
export function balancesFor(context: LeaveContext, year: number): BalanceLine[] {
  if (!context.employmentType) return [];
  const type = context.employmentType;
  return LEAVE_TYPES.map((leaveType) => ({
    leaveType,
    balance: balanceFor({
      leaveType,
      year,
      employmentType: type,
      person: context.person,
      requests: context.requests,
      ruleRows: context.ruleRows,
      calendar: context.calendar,
    }),
  })).filter((line) => line.balance.kind !== "notOffered");
}

// ── Admin views ──────────────────────────────────────────────────────────────────

export type PendingLeaveView = LeaveRequestView & { personName: string; leftAfter: number | null };

export async function pendingLeaveRequests(user: SessionUser): Promise<PendingLeaveView[]> {
  const pending = await asUser(claimsFor(user), (tx) =>
    tx
      .select({ personId: leaveRequests.personId, name: people.fullName })
      .from(leaveRequests)
      .innerJoin(people, eq(people.id, leaveRequests.personId))
      .where(eq(leaveRequests.status, "pending")),
  );
  const personIds = [...new Set(pending.map((row) => row.personId))];
  const contexts = await Promise.all(personIds.map((id) => loadLeaveContext(user, id)));
  const names = new Map(pending.map((row) => [row.personId, row.name]));

  return contexts
    .flatMap((context) => {
      if (!context) return [];
      return context.requests
        .filter((request) => request.status === "pending")
        .map((request) => {
          // What would be left if this one is approved: pending already counts it in.
          let leftAfter: number | null = null;
          if (context.employmentType) {
            const balance = balanceFor({
              leaveType: request.leaveType,
              year: Number(request.startDate.slice(0, 4)),
              employmentType: context.employmentType,
              person: context.person,
              requests: context.requests,
              ruleRows: context.ruleRows,
              calendar: context.calendar,
              childOrder: request.childOrder,
            });
            if (balance.kind === "pool") leftAfter = balance.left;
            if (balance.kind === "perEvent") leftAfter = balance.allowance - request.days;
          }
          return { ...request, personName: names.get(context.personId) ?? "", leftAfter };
        });
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type OutEntry = {
  personId: string;
  fullName: string;
  startDate: string;
  endDate: string;
  startHalf: boolean;
  endHalf: boolean;
  /** Admins only. */
  leaveType?: LeaveType;
  pending?: boolean;
};

/**
 * Who's out between two dates. Everyone gets names and dates of approved leave (team_out);
 * admins also get the type and pending requests.
 */
export async function whoIsOut(user: SessionUser, from: string, to: string): Promise<OutEntry[]> {
  return asUser(claimsFor(user), async (tx) => {
    if (user.role === "admin") {
      const rows = await tx
        .select({ request: leaveRequests, name: people.fullName })
        .from(leaveRequests)
        .innerJoin(people, eq(people.id, leaveRequests.personId))
        .where(
          and(
            inArray(leaveRequests.status, ["pending", "approved"]),
            lte(leaveRequests.startDate, to),
            gte(leaveRequests.endDate, from),
          ),
        )
        .orderBy(asc(leaveRequests.startDate), asc(people.fullName));
      return rows.map(({ request, name }) => ({
        personId: request.personId,
        fullName: name,
        startDate: request.startDate,
        endDate: request.endDate,
        startHalf: request.startHalf,
        endHalf: request.endHalf,
        leaveType: request.leaveType,
        pending: request.status === "pending",
      }));
    }
    const rows = await tx.execute<{
      person_id: string;
      full_name: string;
      start_date: string;
      end_date: string;
      start_half: boolean;
      end_half: boolean;
    }>(sql`select person_id, full_name, start_date::text, end_date::text, start_half, end_half from public.team_out(${from}, ${to})`);
    return rows.map((row) => ({
      personId: row.person_id,
      fullName: row.full_name,
      startDate: row.start_date,
      endDate: row.end_date,
      startHalf: row.start_half,
      endHalf: row.end_half,
    }));
  });
}

export function toHoliday(row: HolidayRow): Holiday & { id: string } {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    year: row.year,
    kind: row.kind,
    scope: row.scope,
    status: row.status,
    source: row.source,
    note: row.note,
  };
}

/** Holiday dates for counting, plus which are tentative and what each is called, for display. */
export function calendarFrom(all: readonly Holiday[], workingWeek: readonly number[]): LeaveCalendar {
  const byDate = holidaysByDate(all);
  return {
    workingWeek,
    holidays: expandHolidays(all),
    tentative: tentativeDates(all),
    labels: Object.fromEntries(Object.entries(byDate).map(([date, list]) => [date, list.map(holidayLabel)])),
  };
}

export async function holidaysInYear(user: SessionUser, year: number): Promise<(Holiday & { id: string })[]> {
  const rows = await asUser(claimsFor(user), (tx) =>
    tx.select().from(holidays).where(eq(holidays.year, year)).orderBy(asc(holidays.startDate), asc(holidays.name)),
  );
  return rows.map(toHoliday);
}

export async function allHolidays(user: SessionUser): Promise<(Holiday & { id: string })[]> {
  const rows = await asUser(claimsFor(user), (tx) => tx.select().from(holidays).orderBy(asc(holidays.startDate)));
  return rows.map(toHoliday);
}

/** Admins: every pending or approved request, with who it belongs to, for working out a holiday change's impact. */
export async function impactRequests(user: SessionUser): Promise<ImpactRequest[]> {
  const rows = await asUser(claimsFor(user), (tx) =>
    tx
      .select({ request: leaveRequests, name: people.fullName })
      .from(leaveRequests)
      .innerJoin(people, eq(people.id, leaveRequests.personId))
      .where(inArray(leaveRequests.status, ["pending", "approved"])),
  );
  const pay = rows.length
    ? await asUser(claimsFor(user), (tx) =>
        tx.select().from(payRecords).where(inArray(payRecords.personId, [...new Set(rows.map((r) => r.request.personId))])),
      )
    : [];
  return rows.map(({ request, name }) => {
    const terms = payInForce(
      pay.filter((record) => record.personId === request.personId).map(toPayView),
      monthOf(request.startDate),
    );
    return {
      id: request.id,
      leaveType: request.leaveType,
      status: request.status,
      startDate: request.startDate,
      endDate: request.endDate,
      startHalf: request.startHalf,
      endHalf: request.endHalf,
      childOrder: request.childOrder,
      personId: request.personId,
      personName: name,
      employmentType: terms?.employmentType ?? null,
    };
  });
}

/** Notes for the signed-in person that they haven't seen yet. */
export async function unseenNotices(user: SessionUser) {
  if (!user.personId) return [];
  const personId = user.personId;
  return asUser(claimsFor(user), (tx) =>
    tx
      .select({ id: leaveNotices.id, message: leaveNotices.message, createdAt: leaveNotices.createdAt })
      .from(leaveNotices)
      .where(and(eq(leaveNotices.personId, personId), isNull(leaveNotices.seenAt)))
      .orderBy(asc(leaveNotices.createdAt)),
  );
}

/** Approved unpaid leave days in a month, for the payroll run (milestone 4). */
export async function unpaidLeaveDaysFor(user: SessionUser, personId: string, month: { year: number; month: number }) {
  const context = await loadLeaveContext(user, personId);
  return context ? unpaidLeaveDays(context.requests, month, context.calendar) : 0;
}

// ── Indicators ───────────────────────────────────────────────────────────────────

export async function pendingCount(user: SessionUser): Promise<number> {
  if (user.role !== "admin") return 0;
  return asUser(claimsFor(user), async (tx) => {
    const [row] = await tx.execute<{ count: number }>(sql`
      select (select count(*) from public.leave_requests where status = 'pending')
           + (select count(*) from public.profile_change_requests where status = 'pending') as count`);
    return Number(row?.count ?? 0);
  });
}

/** Decisions on the person's own requests they haven't seen yet (for the dot on the Leave tab). */
export async function unseenDecisions(user: SessionUser): Promise<number> {
  if (!user.personId) return 0;
  const personId = user.personId;
  return asUser(claimsFor(user), async (tx) => {
    const rows = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.personId, personId),
          inArray(leaveRequests.status, ["approved", "declined", "cancelled"]),
          isNotNull(leaveRequests.decidedAt),
          isNull(leaveRequests.ownerSeenAt),
          ne(leaveRequests.decidedBy, user.id),
        ),
      );
    const notices = await tx
      .select({ id: leaveNotices.id })
      .from(leaveNotices)
      .where(and(eq(leaveNotices.personId, personId), isNull(leaveNotices.seenAt)));
    return rows.length + notices.length;
  });
}

// ── Exit ─────────────────────────────────────────────────────────────────────────

export type ExitLeaveView =
  | { state: "none" }
  | { state: "suggested"; settlement: ExitSettlement }
  | { state: "decided"; settlement: ExitSettlement; decision: typeof exitLeaveSettlements.$inferSelect };

export async function exitLeaveFor(user: SessionUser, personId: string): Promise<ExitLeaveView> {
  const context = await loadLeaveContext(user, personId);
  if (!context?.person.endDate || !context.employmentType) return { state: "none" };
  const endDate = context.person.endDate;
  const pay = await asUser(claimsFor(user), (tx) => tx.select().from(payRecords).where(eq(payRecords.personId, personId)));
  const terms = payInForce(pay.map(toPayView), monthOf(endDate));
  if (!terms) return { state: "none" };

  let settlement: ExitSettlement;
  try {
    settlement = exitSettlement({
      person: { startDate: context.person.startDate, endDate },
      employmentType: context.employmentType,
      monthlyPay: monthlyPayOf(terms),
      requests: context.requests,
      ruleRows: context.ruleRows,
      calendar: context.calendar,
    });
  } catch {
    return { state: "none" };
  }
  const [decision] = await asUser(claimsFor(user), (tx) =>
    tx
      .select()
      .from(exitLeaveSettlements)
      .where(and(eq(exitLeaveSettlements.personId, personId), eq(exitLeaveSettlements.leaveYear, settlement.year)))
      .limit(1),
  );
  return decision ? { state: "decided", settlement, decision } : { state: "suggested", settlement };
}

/** What the request sheet needs to check a request live, in the browser, exactly as the server will. */
export function sheetContextFor(context: LeaveContext, locked: LockedRange | null = null) {
  if (!context.employmentType) return null;
  const today = thimphuToday();
  let policy;
  try {
    policy = resolveLeaveRules(context.ruleRows, context.employmentType, monthOf(today)).policy;
  } catch {
    return null;
  }
  return {
    person: context.person,
    employmentType: context.employmentType,
    requests: context.requests.map(({ id, leaveType, status, startDate, endDate, startHalf, endHalf, childOrder }) => ({
      id,
      leaveType,
      status,
      startDate,
      endDate,
      startHalf,
      endHalf,
      childOrder,
    })),
    ruleRows: context.ruleRows,
    calendar: context.calendar,
    policy,
    today,
    locked: locked ?? undefined,
  };
}
