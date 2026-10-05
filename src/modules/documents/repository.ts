import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { emailDeliveries, payrollRuns, payrollSnapshots, payslips } from "@/lib/db/schema";
import { monthOf } from "@/lib/format";
import type { Chhertum, PayrollMonth } from "@/modules/rules/types";
import type { PayslipModel } from "./model";

// Reads for the payslip screens. RLS decides what anyone sees: a person their own payslips, an admin
// everyone's. The PDF itself is never read here; it's served through a signed link (see link.ts).

export type PayslipListItem = { id: string; month: PayrollMonth; monthKey: string; reference: string; takeHome: Chhertum; content: PayslipModel };

const columns = { id: payslips.id, month: payslips.month, reference: payslips.reference, takeHome: payslips.takeHomeCh, content: payslips.content };

function toItem(row: { id: string; month: string; reference: string; takeHome: number; content: unknown }): PayslipListItem {
  return { id: row.id, month: monthOf(row.month), monthKey: row.month.slice(0, 7), reference: row.reference, takeHome: row.takeHome, content: row.content as PayslipModel };
}

/** A person's payslips, newest first. Empty for anyone the signed-in person may not see. */
export async function payslipsFor(user: SessionUser, personId: string): Promise<PayslipListItem[]> {
  const rows = await asUser(claimsFor(user), (tx) => tx.select(columns).from(payslips).where(eq(payslips.personId, personId)).orderBy(desc(payslips.month)));
  return rows.map(toItem);
}

export async function ownPayslips(user: SessionUser): Promise<PayslipListItem[]> {
  return user.personId ? payslipsFor(user, user.personId) : [];
}

// ── Delivery status for a locked month ──────────────────────────────────────────

export type DeliveryState = "not_made" | "queued" | "sending" | "sent" | "failed";

export type DeliveryRow = {
  personId: string;
  fullName: string;
  payslip: PayslipListItem | null;
  state: DeliveryState;
  /** Waiting longer than it should: the background step may have stopped. Offer Try again. */
  stuck: boolean;
  toEmail: string | null;
  sentAt: Date | null;
  error: string | null;
};

const MINUTE = 60_000;

/**
 * For each person in a locked month: their payslip, and where its email is. A re-send counts: the
 * newest automatic or re-sent email is the one shown.
 */
export async function deliveryStatus(user: SessionUser, runId: string, now: Date = new Date()): Promise<DeliveryRow[]> {
  return asUser(claimsFor(user), async (tx) => {
    const [run] = await tx.select({ lockedAt: payrollRuns.lockedAt }).from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
    const people = await tx
      .select({ personId: payrollSnapshots.personId, fullName: payrollSnapshots.fullName, snapshotId: payrollSnapshots.id })
      .from(payrollSnapshots)
      .where(eq(payrollSnapshots.runId, runId))
      .orderBy(asc(payrollSnapshots.fullName));
    const slips = await tx.select({ ...columns, snapshotId: payslips.snapshotId }).from(payslips).where(eq(payslips.runId, runId));
    const ids = slips.map((slip) => slip.id);
    const deliveries = ids.length
      ? await tx
          .select()
          .from(emailDeliveries)
          .where(and(inArray(emailDeliveries.payslipId, ids), inArray(emailDeliveries.kind, ["payslip", "payslip_resend"])))
          .orderBy(desc(emailDeliveries.createdAt))
      : [];
    const lockedLongAgo = run?.lockedAt ? now.getTime() - run.lockedAt.getTime() > 2 * MINUTE : false;

    return people.map((person) => {
      const slip = slips.find((candidate) => candidate.snapshotId === person.snapshotId);
      const delivery = slip ? deliveries.find((candidate) => candidate.payslipId === slip.id) : undefined;
      const base = { personId: person.personId, fullName: person.fullName, payslip: slip ? toItem(slip) : null, toEmail: delivery?.toEmail ?? null, sentAt: delivery?.sentAt ?? null, error: null };
      if (!slip) return { ...base, state: "not_made" as const, stuck: lockedLongAgo };
      if (!delivery || delivery.status === "queued") {
        return { ...base, state: "queued" as const, stuck: !delivery ? lockedLongAgo : now.getTime() - delivery.createdAt.getTime() > 2 * MINUTE };
      }
      if (delivery.status === "sending") return { ...base, state: "sending" as const, stuck: !delivery.claimedAt || now.getTime() - delivery.claimedAt.getTime() > 5 * MINUTE };
      if (delivery.status === "failed") return { ...base, state: "failed" as const, stuck: false, error: delivery.lastError };
      return { ...base, state: "sent" as const, stuck: false };
    });
  });
}
