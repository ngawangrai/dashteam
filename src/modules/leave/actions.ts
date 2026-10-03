"use server";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { firstNameFrom } from "@/lib/auth/roles";
import { claimsFor, requireRole, requireUser, type SessionUser } from "@/lib/auth/session";
import { asUser, type Tx } from "@/lib/db/client";
import { exitLeaveSettlements, leaveNotices, leaveRequests, people } from "@/lib/db/schema";
import { addMonths, firstOfMonth, formatDate, formatDays, formatSpan, monthOf, thimphuToday } from "@/lib/format";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { resolveLeaveRules } from "@/modules/rules/resolve";
import { assessRequest } from "./balance";
import { LEAVE_TYPE_NAME } from "./labels";
import { exitLeaveFor, loadLeaveContext } from "./repository";
import { leaveRequestSchema, settlementSchema } from "./schema";

// Every write: check the role, validate, check the rules and balance on the server (whatever the
// screen showed), name the audit action, and return the transaction id so the screen can offer Undo.

export type LeaveActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "done"; message: string; transactionId: number };

const SAVE_FAILED = "We couldn’t save that just now. Try again in a minute.";

const formValues = (formData: FormData) => Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]));

function invalid(error: z.ZodError): LeaveActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  return { status: "error", message: Object.values(fieldErrors)[0] ?? "Check the details and try again.", fieldErrors };
}

const errorText = (error: unknown) => (error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "");

/** One request at a time per person, so two quick requests can't both fit a balance that only has room for one. */
async function lockPerson(tx: Tx, personId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${personId}))`);
}

function describe(leaveType: keyof typeof LEAVE_TYPE_NAME, days: number, startDate: string, endDate: string) {
  // The same words the leave list uses, so the toast and the list match.
  return `${formatDays(days)} of ${LEAVE_TYPE_NAME[leaveType].toLowerCase()}, ${formatSpan(startDate, endDate)}`;
}

async function sendRequest(user: SessionUser, personId: string, formData: FormData, mode: "own" | "admin"): Promise<LeaveActionState> {
  const parsed = leaveRequestSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const request = parsed.data;

  try {
    // The lock is held until this transaction commits, so a second request for the same person
    // waits here and then sees the first one when it counts the balance.
    const result = await asUser(claimsFor(user), async (tx) => {
      await lockPerson(tx, personId);
      const context = await loadLeaveContext(user, personId);
      if (!context?.employmentType) return { error: "Pay isn’t set up yet, so leave can’t be worked out." };

      if (mode === "own") {
        // People can go back to the start of last month (a rule); older dates go through the admin.
        const rules = resolveLeaveRules(context.ruleRows, context.employmentType, monthOf(thimphuToday()));
        const earliest = firstOfMonth(addMonths(monthOf(thimphuToday()), -rules.backdateMonths));
        if (request.startDate < earliest) {
          return { error: `Leave before ${formatDate(earliest)} is entered by your admin. Ask them to add it.` };
        }
      }

      const assessment = assessRequest(request, {
        employmentType: context.employmentType,
        person: context.person,
        requests: context.requests,
        ruleRows: context.ruleRows,
        calendar: context.calendar,
      });
      if (!assessment.ok) return { error: assessment.reason };

      await labelNextWrites(tx, mode === "own" ? "leave.requested" : "leave.entered");
      await tx.insert(leaveRequests).values({
        personId,
        leaveType: request.leaveType,
        startDate: request.startDate,
        endDate: request.endDate,
        startHalf: request.startHalf,
        endHalf: request.endHalf,
        childOrder: request.childOrder,
        eventDate: request.eventDate,
        note: request.note,
        // Leave an admin enters is their decision already.
        status: mode === "admin" ? "approved" : "pending",
        requestedBy: user.id,
        ...(mode === "admin" ? { decidedBy: user.id, decidedAt: new Date() } : {}),
      });
      return { days: assessment.days, transactionId: await currentTransactionId(tx) };
    });

    if ("error" in result) return { status: "error", message: result.error ?? SAVE_FAILED };
    revalidatePath("/", "layout");
    const what = describe(request.leaveType, result.days, request.startDate, request.endDate);
    return {
      status: "done",
      message: mode === "own" ? `Sent to your admin: ${what}.` : `Added: ${what}.`,
      transactionId: result.transactionId,
    };
  } catch (error) {
    if (/no_overlap/.test(errorText(error))) return { status: "error", message: "There’s already leave on some of these days." };
    if (/locked/.test(errorText(error))) return { status: "error", message: "Payroll for this month is locked. Ask your admin to add a correction." };
    return { status: "error", message: SAVE_FAILED };
  }
}

export async function requestLeave(_previous: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const user = await requireUser();
  if (!user.personId) return { status: "error", message: "You don’t have a staff record, so there’s no leave to request." };
  return sendRequest(user, user.personId, formData, "own");
}

/** An admin adding leave for someone: any dates (back-dated too), approved on entry, audited. */
export async function enterLeaveFor(personId: string, _previous: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireRole("admin");
  return sendRequest(admin, personId, formData, "admin");
}

export async function decideLeave(requestId: string, decision: "approved" | "declined", note = ""): Promise<LeaveActionState> {
  const admin = await requireRole("admin");
  if (decision !== "approved" && decision !== "declined") return { status: "error", message: SAVE_FAILED };
  const decisionNote = String(note).trim().slice(0, 500);
  try {
    const result = await asUser(claimsFor(admin), async (tx) => {
      const [row] = await tx
        .select({ request: leaveRequests, name: people.fullName, email: people.email })
        .from(leaveRequests)
        .innerJoin(people, eq(people.id, leaveRequests.personId))
        .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, "pending")))
        .limit(1);
      if (!row) return null;
      await labelNextWrites(tx, decision === "approved" ? "leave.approved" : "leave.declined");
      await tx.update(leaveRequests).set({ status: decision, decisionNote }).where(eq(leaveRequests.id, requestId));
      return { name: firstNameFrom(row.name, row.email), transactionId: await currentTransactionId(tx) };
    });
    if (!result) return { status: "error", message: "This request was already decided or cancelled." };
    revalidatePath("/", "layout");
    return {
      status: "done",
      message: decision === "approved" ? `${result.name}’s leave is approved.` : `${result.name}’s leave is declined.`,
      transactionId: result.transactionId,
    };
  } catch (error) {
    if (/locked/.test(errorText(error))) return { status: "error", message: "Payroll for this month is locked. Add a correction in this month instead." };
    return { status: "error", message: SAVE_FAILED };
  }
}

export async function cancelLeave(requestId: string): Promise<LeaveActionState> {
  const user = await requireUser();
  try {
    const transactionId = await asUser(claimsFor(user), async (tx) => {
      await labelNextWrites(tx, "leave.cancelled");
      const updated = await tx
        .update(leaveRequests)
        .set({ status: "cancelled" })
        .where(eq(leaveRequests.id, requestId))
        .returning({ id: leaveRequests.id });
      if (!updated.length) throw new Error("not found");
      return currentTransactionId(tx);
    });
    revalidatePath("/", "layout");
    return { status: "done", message: "Leave cancelled.", transactionId };
  } catch (error) {
    if (/only be cancelled by an admin/.test(errorText(error))) {
      return { status: "error", message: "This leave has started. Ask your admin if it needs to change." };
    }
    return { status: "error", message: "This leave can’t be cancelled any more." };
  }
}

/** Clears the dot on the Leave tab once the person has seen their decisions and notes. */
export async function markDecisionsSeen(): Promise<void> {
  const user = await requireUser();
  if (!user.personId) return;
  const personId = user.personId;
  await asUser(claimsFor(user), async (tx) => {
    await tx
      .update(leaveRequests)
      .set({ ownerSeenAt: new Date() })
      .where(and(eq(leaveRequests.personId, personId), isNotNull(leaveRequests.decidedAt), isNull(leaveRequests.ownerSeenAt)));
    await tx
      .update(leaveNotices)
      .set({ seenAt: new Date() })
      .where(and(eq(leaveNotices.personId, personId), isNull(leaveNotices.seenAt)));
  });
  revalidatePath("/", "layout");
}

// ── Leave at exit ───────────────────────────────────────────────────────────────

export async function settleExitLeave(personId: string, _previous: LeaveActionState, formData: FormData): Promise<LeaveActionState> {
  const admin = await requireRole("admin");
  const parsed = settlementSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const view = await exitLeaveFor(admin, personId);
  if (view.state !== "suggested") return { status: "error", message: "There’s nothing to settle for this person." };
  const { settlement } = view;
  const { decision, amount } = parsed.data;
  const finalCh = decision === "waived" ? null : decision === "changed" ? amount : settlement.suggested;

  try {
    const transactionId = await asUser(claimsFor(admin), async (tx) => {
      await labelNextWrites(tx, `exit_leave.${decision}`);
      await tx.insert(exitLeaveSettlements).values({
        personId,
        leaveYear: settlement.year,
        daysOver: settlement.daysOver,
        dailyRateCh: settlement.dailyRate,
        suggestedCh: settlement.suggested,
        finalCh,
        unusedAnnualDays: settlement.unusedAnnualDays,
        status: decision,
        decidedBy: admin.id,
      });
      return currentTransactionId(tx);
    });
    revalidatePath(`/admin/people/${personId}`);
    const message =
      decision === "waived"
        ? "Recovery waived. Nothing will be taken from their final pay."
        : "Saved. It will appear as a recovery in their final payroll.";
    return { status: "done", message, transactionId };
  } catch {
    return { status: "error", message: SAVE_FAILED };
  }
}
