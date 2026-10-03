"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { claimsFor, requireRole, type SessionUser } from "@/lib/auth/session";
import { asUser, type Tx } from "@/lib/db/client";
import { holidays, leaveNotices } from "@/lib/db/schema";
import { addMonths, formatDays, formatSpan } from "@/lib/format";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { loadRuleRows } from "@/modules/rules/repository";
import { resolveLeaveRules } from "@/modules/rules/resolve";
import type { PayrollMonth } from "@/modules/rules/types";
import { lockedMessage, lockedMonthsIn } from "@/modules/run/locked";
import { lockedMonths } from "@/modules/run/repository";
import { type Holiday, type ImpactChange, copyFixedHolidays, holidayChangeLockedMonth, holidayImpact, impactFingerprint } from "./holidays";
import { LEAVE_TYPE_NAME } from "./labels";
import { allHolidays, impactRequests } from "./repository";

// Changing holidays changes how leave is counted. Every change is previewed (who is affected and
// how), then saved with a note to each affected person, in one audited transaction that Undo reverses.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const holidayValues = z
  .object({
    name: z.string().trim().min(1, "Give the holiday a name.").max(120, "That name is too long."),
    startDate: date,
    endDate: date,
    kind: z.enum(["fixed", "lunar", "one_off"]),
    scope: z.enum(["national", "thimphu"]),
    status: z.enum(["confirmed", "tentative"]),
    source: z.string().trim().min(1, "Say where the date comes from: a link, or who declared it.").max(500),
    note: z.string().trim().max(500).default(""),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "The last day can’t be before the first.", path: ["endDate"] })
  .refine((v) => v.startDate.slice(0, 4) === v.endDate.slice(0, 4), {
    message: "A holiday stays within one year. Add the days in the next year separately.",
    path: ["endDate"],
  });

const changeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("add"), values: holidayValues }),
  z.object({ mode: z.literal("edit"), id: z.uuid(), values: holidayValues }),
  z.object({ mode: z.literal("remove"), id: z.uuid() }),
  z.object({ mode: z.literal("confirm"), id: z.uuid() }),
  z.object({ mode: z.literal("copy"), fromYear: z.number().int(), toYear: z.number().int() }),
]);

export type HolidayChange = z.input<typeof changeSchema>;

export type HolidayPreview =
  | { status: "ready"; changes: ImpactChange[]; fingerprint: string; summary: string; copies?: { name: string; startDate: string; endDate: string }[]; skipped?: { name: string; reason: string }[] }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

export type HolidaySaveResult =
  | { status: "done"; message: string; transactionId: number }
  | { status: "changed"; preview: HolidayPreview }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

type Planned = {
  before: Holiday[];
  after: Holiday[];
  changes: ImpactChange[];
  summary: string;
  verb: string;
  holidayName: string;
  copies?: Holiday[];
  skipped?: { name: string; reason: string }[];
  apply: (tx: Tx, user: SessionUser) => Promise<void>;
};

function fieldErrorsOf(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path.at(-1) ?? "form")] ??= issue.message;
  return fieldErrors;
}

const monthNumber = ({ year, month }: PayrollMonth) => year * 12 + month;

/** Works out what a change does, without saving anything. */
async function plan(user: SessionUser, change: z.output<typeof changeSchema>): Promise<Planned | { error: string }> {
  const [before, requests, ruleRows, locked] = await Promise.all([allHolidays(user), impactRequests(user), loadRuleRows(claimsFor(user)), lockedMonths(user)]);
  const lockedMonth = holidayChangeLockedMonth(change, before, locked);
  if (lockedMonth) {
    const latest = locked.reduce((a, b) => (monthNumber(a) > monthNumber(b) ? a : b));
    return { error: lockedMessage({ locked: lockedMonth, draft: addMonths(latest, 1) }, "admin") };
  }
  const find = (id: string) => before.find((holiday) => holiday.id === id);
  let after: Holiday[];
  let summary: string;
  let verb: string;
  let holidayName: string;
  let apply: Planned["apply"];
  let copies: Holiday[] | undefined;
  let skipped: { name: string; reason: string }[] | undefined;

  const withYear = (values: z.output<typeof holidayValues>) => ({ ...values, year: Number(values.startDate.slice(0, 4)) });

  switch (change.mode) {
    case "add": {
      const holiday = withYear(change.values);
      after = [...before, holiday];
      summary = `${holiday.name} added.`;
      verb = "was added";
      holidayName = holiday.name;
      apply = async (tx, admin) => {
        await labelNextWrites(tx, "holiday.added");
        await tx.insert(holidays).values({ ...holiday, createdBy: admin.id });
      };
      break;
    }
    case "edit": {
      const current = find(change.id);
      if (!current) return { error: "This holiday was removed. Refresh to see the latest list." };
      const holiday = withYear(change.values);
      after = before.map((h) => (h.id === change.id ? { ...h, ...holiday } : h));
      const moved = current.startDate !== holiday.startDate || current.endDate !== holiday.endDate;
      summary = `${holiday.name} saved.`;
      verb = moved ? "moved" : "changed";
      holidayName = holiday.name;
      apply = async (tx) => {
        await labelNextWrites(tx, moved ? "holiday.moved" : "holiday.updated");
        await tx.update(holidays).set(holiday).where(eq(holidays.id, change.id));
      };
      break;
    }
    case "remove": {
      const current = find(change.id);
      if (!current) return { error: "This holiday was already removed." };
      after = before.filter((h) => h.id !== change.id);
      summary = `${current.name} removed.`;
      verb = "was removed";
      holidayName = current.name;
      apply = async (tx) => {
        await labelNextWrites(tx, "holiday.removed");
        await tx.delete(holidays).where(eq(holidays.id, change.id));
      };
      break;
    }
    case "confirm": {
      const current = find(change.id);
      if (!current) return { error: "This holiday was removed. Refresh to see the latest list." };
      // Tentative holidays already count, so confirming changes no leave; it only changes the label.
      after = before.map((h) => (h.id === change.id ? { ...h, status: "confirmed" as const } : h));
      summary = `${current.name} is confirmed.`;
      verb = "was confirmed";
      holidayName = current.name;
      apply = async (tx) => {
        await labelNextWrites(tx, "holiday.confirmed");
        await tx.update(holidays).set({ status: "confirmed" }).where(eq(holidays.id, change.id));
      };
      break;
    }
    case "copy": {
      const result = copyFixedHolidays(before, change.fromYear, change.toYear);
      copies = result.copies;
      skipped = result.skipped;
      after = [...before, ...result.copies];
      summary = result.copies.length === 1 ? `1 fixed holiday copied to ${change.toYear}.` : `${result.copies.length} fixed holidays copied to ${change.toYear}.`;
      verb = "was added";
      holidayName = "A fixed holiday";
      apply = async (tx, admin) => {
        if (!result.copies.length) return;
        await labelNextWrites(tx, "holiday.copied");
        await tx.insert(holidays).values(result.copies.map((holiday) => ({ ...holiday, createdBy: admin.id })));
      };
      break;
    }
  }

  // The working week in force now; it's the same for both employment types in V1.
  let workingWeek = [1, 2, 3, 4, 5];
  try {
    workingWeek = resolveLeaveRules(ruleRows, "full_time", { year: new Date().getUTCFullYear(), month: 1 }).workingWeek;
  } catch {
    // Before any leave rules exist: Monday to Friday.
  }
  const changes = holidayImpact({ requests, ruleRows, workingWeek, before, after });
  return { before, after, changes, summary, verb, holidayName, copies, skipped, apply };
}

function toPreview(planned: Planned): HolidayPreview {
  return {
    status: "ready",
    changes: planned.changes,
    fingerprint: impactFingerprint(planned.changes),
    summary: planned.summary,
    copies: planned.copies?.map(({ name, startDate, endDate }) => ({ name, startDate, endDate })),
    skipped: planned.skipped,
  };
}

/** Read-only: what a holiday change would do to everyone's leave. */
export async function previewHolidayChange(input: HolidayChange): Promise<HolidayPreview> {
  const admin = await requireRole("admin");
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const planned = await plan(admin, parsed.data);
  if ("error" in planned) return { status: "error", message: planned.error };
  return toPreview(planned);
}

/**
 * Saves a previewed change. If anyone's leave would now change differently from what the admin saw,
 * nothing is saved and the fresh preview comes back for another look.
 */
export async function saveHolidayChange(input: HolidayChange, fingerprint: string): Promise<HolidaySaveResult> {
  const admin = await requireRole("admin");
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const planned = await plan(admin, parsed.data);
  if ("error" in planned) return { status: "error", message: planned.error };
  if (impactFingerprint(planned.changes) !== fingerprint) return { status: "changed", preview: toPreview(planned) };

  try {
    const transactionId = await asUser(claimsFor(admin), async (tx) => {
      await planned.apply(tx, admin);
      if (planned.changes.length) {
        await tx.insert(leaveNotices).values(
          planned.changes.map((change) => ({
            personId: change.personId,
            leaveRequestId: change.requestId,
            message: `${planned.holidayName} ${planned.verb}, so your ${LEAVE_TYPE_NAME[change.leaveType].toLowerCase()} on ${formatSpan(change.startDate, change.endDate)} now counts ${formatDays(change.after)} (was ${formatDays(change.before)}).`,
          })),
        );
      }
      return currentTransactionId(tx);
    });
    revalidatePath("/", "layout");
    const updated = planned.changes.length ? ` ${planned.changes.length === 1 ? "1 leave request" : `${planned.changes.length} leave requests`} updated.` : "";
    return { status: "done", message: `${planned.summary}${updated}`, transactionId };
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
    if (/holidays_name_year/.test(text)) {
      return { status: "error", message: "There’s already a holiday with this name that year.", fieldErrors: { name: "There’s already a holiday with this name that year." } };
    }
    const lockedMonths = lockedMonthsIn(error);
    if (lockedMonths) return { status: "error", message: lockedMessage(lockedMonths, "admin") };
    return { status: "error", message: "We couldn’t save that just now. Try again in a minute." };
  }
}
