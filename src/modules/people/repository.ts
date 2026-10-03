import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { type PayRecord, type Person, payRecords, people, profileChangeRequests } from "@/lib/db/schema";
import { monthOf, thimphuToday } from "@/lib/format";
import { loadRulesFor } from "@/modules/rules/repository";
import type { PayrollMonth, PlainDate, ResolvedRules } from "@/modules/rules/types";
import { type PayTerms, nextPayChange, payInForce } from "./pay";

// Reads for the people screens. Everything runs as the signed-in person, so RLS decides what they see:
// an employee gets only their own record, an admin gets everyone. Ciphertext never leaves this module.

export type PayRecordView = PayTerms & { id: string; note: string; createdAt: Date };

export type PersonView = {
  id: string;
  profileId: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  bankName: string | null;
  bankAccountLast4: string | null;
  tpnLast4: string | null;
  startDate: PlainDate;
  endDate: PlainDate | null;
  isCurrent: boolean;
};

export type PendingRequestView = {
  id: string;
  personId: string;
  personName: string;
  createdAt: Date;
  phone: { from: string | null; to: string } | null;
  bank: { from: { name: string | null; last4: string | null }; to: { name: string | null; last4: string | null } } | null;
};

export type PersonDetail = {
  person: PersonView;
  pay: PayRecordView[];
  current: PayRecordView | null;
  upcoming: PayRecordView | null;
  pendingRequest: PendingRequestView | null;
};

export const thisMonth = (): PayrollMonth => monthOf(thimphuToday());

export function isCurrent(endDate: string | null, today: string = thimphuToday()): boolean {
  return endDate === null || endDate >= today;
}

function toPersonView(row: Person): PersonView {
  return {
    id: row.id,
    profileId: row.profileId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    bankName: row.bankName,
    bankAccountLast4: row.bankAccountLast4,
    tpnLast4: row.tpnLast4,
    startDate: row.startDate as PlainDate,
    endDate: row.endDate as PlainDate | null,
    isCurrent: isCurrent(row.endDate),
  };
}

export function toPayView(row: PayRecord): PayRecordView {
  const base = { id: row.id, note: row.note, createdAt: row.createdAt, effectiveFrom: row.effectiveFrom as PlainDate };
  return row.employmentType === "intern"
    ? { ...base, employmentType: "intern", stipend: row.stipendCh ?? 0 }
    : { ...base, employmentType: "full_time", basic: row.basicCh ?? 0, allowances: row.allowancesCh ?? 0 };
}

function toRequestView(
  request: typeof profileChangeRequests.$inferSelect,
  person: Pick<Person, "fullName" | "phone" | "bankName" | "bankAccountLast4">,
): PendingRequestView {
  const bankChanges = request.bankName !== null || request.bankAccountLast4 !== null;
  return {
    id: request.id,
    personId: request.personId,
    personName: person.fullName,
    createdAt: request.createdAt,
    phone: request.phone ? { from: person.phone, to: request.phone } : null,
    bank: bankChanges
      ? {
          from: { name: person.bankName, last4: person.bankAccountLast4 },
          to: { name: request.bankName ?? person.bankName, last4: request.bankAccountLast4 ?? person.bankAccountLast4 },
        }
      : null,
  };
}

export type PersonListItem = PersonView & { employmentType: PayTerms["employmentType"] | null };

export async function listPeople(user: SessionUser): Promise<PersonListItem[]> {
  return asUser(claimsFor(user), async (tx) => {
    const rows = await tx.select().from(people).orderBy(asc(people.fullName));
    const pay = rows.length
      ? await tx.select().from(payRecords).where(inArray(payRecords.personId, rows.map((row) => row.id)))
      : [];
    const month = thisMonth();
    return rows.map((row) => {
      const records = pay.filter((record) => record.personId === row.id).map(toPayView);
      // Someone starting next month has no pay in force yet; show the type they start on.
      const terms = payInForce(records, month) ?? nextPayChange(records, month);
      return { ...toPersonView(row), employmentType: terms?.employmentType ?? null };
    });
  });
}

async function detailFor(user: SessionUser, personId: string): Promise<PersonDetail | null> {
  return asUser(claimsFor(user), async (tx) => {
    const [row] = await tx.select().from(people).where(eq(people.id, personId)).limit(1);
    if (!row) return null;
    const pay = (await tx.select().from(payRecords).where(eq(payRecords.personId, personId)).orderBy(desc(payRecords.effectiveFrom))).map(
      toPayView,
    );
    const [pending] = await tx
      .select()
      .from(profileChangeRequests)
      .where(and(eq(profileChangeRequests.personId, personId), eq(profileChangeRequests.status, "pending")))
      .limit(1);
    const month = thisMonth();
    return {
      person: toPersonView(row),
      pay,
      current: (payInForce(pay, month) as PayRecordView | null) ?? null,
      upcoming: (nextPayChange(pay, month) as PayRecordView | null) ?? null,
      pendingRequest: pending ? toRequestView(pending, row) : null,
    };
  });
}

/** Admin: any person. Employees get null for anyone but themselves (RLS). */
export const getPersonDetail = (user: SessionUser, personId: string) => detailFor(user, personId);

/** The signed-in person's own record, or null if they have none (an admin who isn't on payroll). */
export async function getOwnProfile(user: SessionUser): Promise<PersonDetail | null> {
  return user.personId ? detailFor(user, user.personId) : null;
}

export async function listPendingRequests(user: SessionUser): Promise<PendingRequestView[]> {
  return asUser(claimsFor(user), async (tx) => {
    const rows = await tx
      .select({ request: profileChangeRequests, person: people })
      .from(profileChangeRequests)
      .innerJoin(people, eq(people.id, profileChangeRequests.personId))
      .where(eq(profileChangeRequests.status, "pending"))
      .orderBy(asc(profileChangeRequests.createdAt));
    return rows.map(({ request, person }) => toRequestView(request, person));
  });
}

/** Rules for both employment types in a month, for showing take-home as pay is typed. Admins only. */
export async function rulesForMonth(
  user: SessionUser,
  month: PayrollMonth = thisMonth(),
): Promise<Record<PayTerms["employmentType"], ResolvedRules> | null> {
  try {
    const [fullTime, intern] = await Promise.all([
      loadRulesFor(claimsFor(user), "full_time", month),
      loadRulesFor(claimsFor(user), "intern", month),
    ]);
    return { full_time: fullTime, intern };
  } catch {
    // No rules in force for that month: the estimate is left out rather than guessed.
    return null;
  }
}
