"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { claimsFor, requireRole, requireUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { emailDeliveries, payrollRuns, payslips, salaryCertificates } from "@/lib/db/schema";
import { serverEnv } from "@/lib/env/server";
import { issuePayslips, queuePayslipEmail, sendDeliveries } from "./issue";
import { linkKeyFrom, signDocumentLink, signPayslipLink } from "./link";
import { deliveryStatus } from "./repository";
import { makeStatement } from "./statements";

// Opening, emailing and re-sending payslips. Each checks who's asking as the signed-in person, so RLS
// and the database functions decide; nothing here trusts what the screen sent.

export type DocumentResult = { status: "done"; message: string } | { status: "error"; message: string };
export type LinkResult = { status: "ready"; url: string } | { status: "error"; message: string };

const uuid = z.uuid();
const NOT_FOUND = "This payslip couldn’t be found. Refresh to see your latest.";

/** A short-lived link to the payslip's PDF, only if the signed-in person may see it. */
export async function payslipLink(payslipId: string): Promise<LinkResult> {
  const user = await requireUser();
  if (!uuid.safeParse(payslipId).success) return { status: "error", message: NOT_FOUND };
  const [visible] = await asUser(claimsFor(user), (tx) => tx.select({ id: payslips.id }).from(payslips).where(eq(payslips.id, payslipId)).limit(1));
  if (!visible) return { status: "error", message: NOT_FOUND };
  const token = signPayslipLink({ payslipId, userId: user.id }, linkKeyFrom(Buffer.from(serverEnv.FIELD_ENCRYPTION_KEY, "base64")));
  return { status: "ready", url: `/payslips/file/${token}` };
}

async function sendOne(deliveryId: string, user: Awaited<ReturnType<typeof requireUser>>): Promise<DocumentResult> {
  const outcomes = await sendDeliveries([deliveryId], user);
  const [row] = await asUser(claimsFor(user), (tx) => tx.select({ toEmail: emailDeliveries.toEmail }).from(emailDeliveries).where(eq(emailDeliveries.id, deliveryId)).limit(1));
  const outcome = outcomes.get(deliveryId);
  if (outcome?.status === "sent") return { status: "done", message: `Sent to ${row?.toEmail ?? "their email"}.` };
  return { status: "error", message: outcome?.error ?? "It didn’t send. Try again in a minute." };
}

/** Emails a person their own payslip. Each tap is one email; a double tap still sends once. */
export async function emailMyPayslip(payslipId: string, tap: string): Promise<DocumentResult> {
  const user = await requireUser();
  if (!uuid.safeParse(payslipId).success || !uuid.safeParse(tap).success) return { status: "error", message: NOT_FOUND };
  try {
    return await sendOne(await queuePayslipEmail(payslipId, "payslip_self", user, tap), user);
  } catch {
    return { status: "error", message: NOT_FOUND };
  }
}

/** An admin sending someone their payslip again, on purpose. */
export async function resendPayslip(payslipId: string, tap: string): Promise<DocumentResult> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(payslipId).success || !uuid.safeParse(tap).success) return { status: "error", message: NOT_FOUND };
  try {
    const result = await sendOne(await queuePayslipEmail(payslipId, "payslip_resend", admin, tap), admin);
    revalidatePath("/admin", "layout");
    return result;
  } catch {
    return { status: "error", message: NOT_FOUND };
  }
}

/** Makes any missing payslips and sends every email that failed or stalled. Sends nothing twice. */
export async function retryPayslipEmails(runId: string): Promise<DocumentResult> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(runId).success) return { status: "error", message: "This month couldn’t be found." };
  const [run] = await asUser(claimsFor(admin), (tx) => tx.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1));
  if (run?.status !== "locked") return { status: "error", message: "Payslips are made once a month is locked." };
  try {
    await issuePayslips(runId, admin, { retryFailed: true });
  } catch {
    return { status: "error", message: "We couldn’t finish just now. Nothing was sent twice. Try again in a minute." };
  }
  revalidatePath("/admin", "layout");
  const rows = await deliveryStatus(admin, runId);
  const unsent = rows.filter((row) => row.state !== "sent").length;
  if (!unsent) return { status: "done", message: rows.length === 1 ? "Their payslip is sent." : `All ${rows.length} payslips are sent.` };
  return { status: "done", message: unsent === 1 ? "1 payslip still isn’t sent. The reason is in the list." : `${unsent} payslips still aren’t sent. The reasons are in the list.` };
}

// ── Pay statements ──────────────────────────────────────────────────────────────

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const keyToMonth = (key: string) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) });

/**
 * Makes (or finds today's) statement for a range and returns a link to it. A person gets their own;
 * an admin anyone's, including people who have left.
 */
export async function statementLink(personId: string, fromKey: string, toKey: string): Promise<LinkResult> {
  const user = await requireUser();
  if (!uuid.safeParse(personId).success || !MONTH_KEY.test(fromKey) || !MONTH_KEY.test(toKey) || fromKey > toKey) {
    return { status: "error", message: "Choose the months again." };
  }
  if (user.role !== "admin" && personId !== user.personId) return { status: "error", message: "This statement couldn’t be made." };
  try {
    const made = await makeStatement(user, personId, { from: keyToMonth(fromKey), to: keyToMonth(toKey) });
    if (made.status === "nothing_paid") return { status: "error", message: "There’s no pay in those months. Choose others." };
    if (made.status === "not_found") return { status: "error", message: "This statement couldn’t be made." };
    const token = signDocumentLink({ kind: "statement", id: made.id, userId: user.id }, linkKeyFrom(Buffer.from(serverEnv.FIELD_ENCRYPTION_KEY, "base64")));
    return { status: "ready", url: `/statements/file/${token}` };
  } catch {
    return { status: "error", message: "We couldn’t make the statement just now. Try again in a minute." };
  }
}

/** A short-lived link to an issued certificate, only if the signed-in person may see it. */
export async function certificateLink(certificateId: string): Promise<LinkResult> {
  const user = await requireUser();
  const missing = { status: "error", message: "This certificate couldn’t be found." } as const;
  if (!uuid.safeParse(certificateId).success) return missing;
  const [visible] = await asUser(claimsFor(user), (tx) => tx.select({ id: salaryCertificates.id }).from(salaryCertificates).where(eq(salaryCertificates.id, certificateId)).limit(1));
  if (!visible) return missing;
  const token = signDocumentLink({ kind: "certificate", id: certificateId, userId: user.id }, linkKeyFrom(Buffer.from(serverEnv.FIELD_ENCRYPTION_KEY, "base64")));
  return { status: "ready", url: `/certificates/file/${token}` };
}
