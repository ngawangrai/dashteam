"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { claimsFor, requireRole } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { filingReceipts, filings } from "@/lib/db/schema";
import { formatMonth, monthOf } from "@/lib/format";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { lockedRunId } from "@/modules/documents/issue";
import { makeSchedule } from "./issue";
import { filingToday } from "./repository";

// Making the schedule, marking a month filed (or editing that), and ticking off rows entered by hand.
// Admins only; every write is audited by trigger. Marking filed returns its transaction for Undo.

export type FilingActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "done"; message: string; transactionId?: number };

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const SAVE_FAILED = "We couldn’t save that just now. Try again in a minute.";
const RECEIPT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

const monthFrom = (key: string) => (MONTH_KEY.test(key) ? monthOf(`${key}-01`) : null);

/** Makes a locked month's schedule if it's missing (it's normally made right after the lock). */
export async function makeScheduleNow(monthKey: string): Promise<FilingActionState> {
  const admin = await requireRole("admin");
  const month = monthFrom(monthKey);
  if (!month) return { status: "error", message: "This month couldn’t be found." };
  const runId = await lockedRunId(month, admin);
  if (!runId) return { status: "error", message: `${formatMonth(month)} isn’t locked yet. Lock it first.` };
  const result = await makeSchedule(runId, admin);
  revalidatePath(`/admin/payroll/${monthKey}/filing`);
  if (result.status === "mismatch") {
    return { status: "error", message: `The schedule didn’t add up to the locked figures, so it wasn’t made. Tell your developer: ${result.message}` };
  }
  return { status: "done", message: `${formatMonth(month)}’s IT-1(a) is ready.` };
}

const filedSchema = z.object({
  filedOn: z.iso.date({ error: "Choose the date you filed." }),
  paymentReference: z.string().trim().min(1, "Add the payment reference from RAMIS.").max(100, "That reference is too long."),
  acknowledgementNumber: z.string().trim().max(100, "That number is too long.").default(""),
});

export async function markFiled(monthKey: string, _previous: FilingActionState, formData: FormData): Promise<FilingActionState> {
  const admin = await requireRole("admin");
  const month = monthFrom(monthKey);
  if (!month) return { status: "error", message: "This month couldn’t be found." };
  const parsed = filedSchema.safeParse({
    filedOn: String(formData.get("filedOn") ?? ""),
    paymentReference: String(formData.get("paymentReference") ?? ""),
    acknowledgementNumber: String(formData.get("acknowledgementNumber") ?? ""),
  });
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  if (parsed.success && parsed.data.filedOn > filingToday()) fieldErrors.filedOn = "The filing date can’t be in the future.";

  const file = formData.get("receipt");
  const receipt = file instanceof File && file.size > 0 ? file : null;
  if (receipt && !RECEIPT_TYPES.includes(receipt.type as (typeof RECEIPT_TYPES)[number])) fieldErrors.receipt = "Upload a PDF, PNG or JPEG.";
  if (receipt && receipt.size > RECEIPT_MAX_BYTES) fieldErrors.receipt = "That file is over 5 MB. Upload a smaller copy.";
  if (Object.keys(fieldErrors).length || !parsed.success) {
    return { status: "error", message: Object.values(fieldErrors)[0] ?? "Check the highlighted fields.", fieldErrors };
  }

  const runId = await lockedRunId(month, admin);
  if (!runId) return { status: "error", message: `${formatMonth(month)} isn’t locked yet, so it can’t be filed.` };

  try {
    const [current] = await asUser(claimsFor(admin), (tx) => tx.select().from(filings).where(eq(filings.runId, runId)).limit(1));
    if (!current) return { status: "error", message: `${formatMonth(month)}’s IT-1(a) isn’t made yet. Make it first.` };
    if (!receipt && !parsed.data.acknowledgementNumber && !current.receiptId) {
      const message = "Add the acknowledgement number from RAMIS, or upload the receipt.";
      return { status: "error", message, fieldErrors: { acknowledgementNumber: message } };
    }

    // The receipt is saved on its own, first, so Undo of the filing below never has to remove a file.
    let receiptId = current.receiptId;
    if (receipt) {
      receiptId = await asUser(claimsFor(admin), async (tx) => {
        await labelNextWrites(tx, "filing.receipt_added");
        const [row] = await tx
          .insert(filingReceipts)
          .values({ runId, filename: receipt.name.slice(0, 200) || "receipt", contentType: receipt.type, bytes: Buffer.from(await receipt.arrayBuffer()), uploadedBy: admin.id })
          .returning({ id: filingReceipts.id });
        return row?.id ?? null;
      });
    }

    const wasFiled = Boolean(current.filedOn);
    const transactionId = await asUser(claimsFor(admin), async (tx) => {
      await labelNextWrites(tx, wasFiled ? "filing.edited" : "filing.marked_filed");
      await tx
        .update(filings)
        .set({
          filedOn: parsed.data.filedOn,
          paymentReference: parsed.data.paymentReference,
          acknowledgementNumber: parsed.data.acknowledgementNumber || null,
          receiptId,
        })
        .where(eq(filings.runId, runId));
      return currentTransactionId(tx);
    });
    revalidatePath("/admin", "layout");
    return { status: "done", message: wasFiled ? "Changes saved." : `${formatMonth(month)} is marked as filed. Reminders stop.`, transactionId };
  } catch {
    return { status: "error", message: SAVE_FAILED };
  }
}

/** Ticks a person off (or back on) on the manual-entry screen. Saved, so it survives a reload. */
export async function setEntered(monthKey: string, personId: string, entered: boolean): Promise<FilingActionState> {
  const admin = await requireRole("admin");
  const month = monthFrom(monthKey);
  if (!month || !z.uuid().safeParse(personId).success) return { status: "error", message: SAVE_FAILED };
  const runId = await lockedRunId(month, admin);
  if (!runId) return { status: "error", message: SAVE_FAILED };
  try {
    await asUser(claimsFor(admin), async (tx) => {
      const [current] = await tx.select({ entered: filings.entered }).from(filings).where(eq(filings.runId, runId)).limit(1);
      const list = new Set((current?.entered as string[] | undefined) ?? []);
      if (entered) list.add(personId);
      else list.delete(personId);
      await labelNextWrites(tx, "filing.entry_ticked");
      await tx.update(filings).set({ entered: [...list] }).where(eq(filings.runId, runId));
    });
    return { status: "done", message: "" };
  } catch {
    return { status: "error", message: "That tick didn’t save. Try again." };
  }
}
