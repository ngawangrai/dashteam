import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { emailDeliveries, leaveRequests, payrollRuns, payrollSnapshots, payslips, people, rules } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env/server";
import { firstNameFrom } from "@/lib/auth/roles";
import { firstOfMonth, monthOf, thimphuToday } from "@/lib/format";
import type { PayrollMonth } from "@/modules/rules/types";
import { countLeaveDays } from "@/modules/leave/days";
import { calendarFrom, loadLeaveContext } from "@/modules/leave/repository";
import { labelNextWrites } from "@/modules/audit/labels";
import { resolveCompanyDetails } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import { leaveDecidedEmail, leaveRequestedEmail, payslipEmail, type Email } from "./emails";
import { type PayslipModel, type PayslipSnapshot, payslipModel, payslipReference } from "./model";
import { renderPayslip } from "./render";

// After a month is locked: make each payslip once, queue its email once, and send. Every step only
// does what's missing, so running it again (a retry, a second tab, a crash half way) is always safe.
// Nothing here can undo or block the lock: it runs after the lock has committed.

type Actor = SessionUser;

/** Long enough for the Undo toast to come and go before a leave email is sent. */
export const LEAVE_EMAIL_DELAY_SECONDS = 15;

/** Makes the payslips a locked month is missing. Returns the run's payslip ids. */
export async function generatePayslips(runId: string, actor: Actor): Promise<string[]> {
  const data = await asUser(claimsFor(actor), async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "locked"))).limit(1);
    if (!run) return null;
    const snapshots = await tx.select().from(payrollSnapshots).where(eq(payrollSnapshots.runId, runId)).orderBy(asc(payrollSnapshots.fullName), asc(payrollSnapshots.personId));
    const issued = await tx.select({ snapshotId: payslips.snapshotId }).from(payslips).where(eq(payslips.runId, runId));
    const ruleRows = (await tx.select().from(rules).where(eq(rules.key, "company_details"))).map(toRuleRow);
    return { run, snapshots, issued: new Set(issued.map((row) => row.snapshotId)), ruleRows };
  });
  if (!data) return [];
  const { run, snapshots, issued, ruleRows } = data;
  const month = monthOf(run.month);
  const company = resolveCompanyDetails(ruleRows, month);
  const issuedOn = thimphuToday(run.lockedAt ?? new Date());

  // Rendering happens outside any transaction; each insert is its own, and a payslip that already
  // exists (another run got there first) is left alone.
  for (const [index, snapshot] of snapshots.entries()) {
    if (issued.has(snapshot.id)) continue;
    const source: PayslipSnapshot = {
      month,
      fullName: snapshot.fullName,
      employmentType: snapshot.employmentType,
      person: { tpnLast4: (snapshot.person as { tpnLast4: string | null }).tpnLast4 },
      inputs: snapshot.inputs as PayslipSnapshot["inputs"],
      result: snapshot.result as PayslipSnapshot["result"],
    };
    const model = payslipModel(source, company, payslipReference(month, index + 1), issuedOn, actor.firstName);
    const { pdf, sha256 } = await renderPayslip(model);
    await asUser(claimsFor(actor), async (tx) => {
      await labelNextWrites(tx, "payslip.generated");
      await tx
        .insert(payslips)
        .values({
          runId,
          snapshotId: snapshot.id,
          personId: snapshot.personId,
          month: run.month,
          reference: model.reference,
          employmentType: snapshot.employmentType,
          takeHomeCh: snapshot.takeHomeCh,
          content: model,
          pdf,
          pdfSha256: sha256,
          generatedBy: actor.id,
        })
        .onConflictDoNothing({ target: payslips.snapshotId });
    });
  }
  const all = await asUser(claimsFor(actor), (tx) => tx.select({ id: payslips.id }).from(payslips).where(eq(payslips.runId, runId)));
  return all.map((row) => row.id);
}

/** Queues one email of the given kind. The automatic one is queued once per payslip, ever. */
export async function queuePayslipEmail(payslipId: string, kind: "payslip" | "payslip_resend" | "payslip_self", actor: Actor, nonce?: string): Promise<string> {
  return asUser(claimsFor(actor), async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`select public.queue_payslip_email(${payslipId}, ${kind}::public.email_kind, ${nonce ?? null}) as id`);
    return rows[0]?.id ?? "";
  });
}

/** Everything that happens after a lock: payslips, then their emails. Safe to run again. */
export async function issuePayslips(runId: string, actor: Actor, options: { retryFailed?: boolean } = {}): Promise<void> {
  const ids = await generatePayslips(runId, actor);
  for (const id of ids) await queuePayslipEmail(id, "payslip", actor);
  if (options.retryFailed) await readdressFailed(ids, actor);
  const due = await asUser(claimsFor(actor), (tx) =>
    tx
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(
        and(
          inArray(emailDeliveries.payslipId, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
          inArray(emailDeliveries.status, options.retryFailed ? ["queued", "failed", "sending"] : ["queued"]),
        ),
      ),
  );
  await sendDeliveries(
    due.map((row) => row.id),
    actor,
  );
}

/**
 * An email keeps the address it was queued with. If one failed and the person's address has changed
 * since (usually the fix), close it as skipped and queue it again to the address on file now, once.
 */
async function readdressFailed(payslipIds: string[], actor: Actor): Promise<void> {
  if (!payslipIds.length) return;
  const failed = await asUser(claimsFor(actor), (tx) =>
    tx
      .select({ id: emailDeliveries.id, payslipId: emailDeliveries.payslipId, toEmail: emailDeliveries.toEmail, current: people.email })
      .from(emailDeliveries)
      .innerJoin(payslips, eq(payslips.id, emailDeliveries.payslipId))
      .innerJoin(people, eq(people.id, payslips.personId))
      .where(and(inArray(emailDeliveries.payslipId, payslipIds), eq(emailDeliveries.status, "failed"), inArray(emailDeliveries.kind, ["payslip", "payslip_resend"]))),
  );
  for (const delivery of failed) {
    if (!delivery.payslipId || delivery.toEmail.toLowerCase() === delivery.current.toLowerCase()) continue;
    const claimed = await asUser(claimsFor(actor), (tx) => tx.execute(sql`select id from public.claim_email_delivery(${delivery.id})`));
    if (!claimed.length) continue;
    await finish(delivery.id, "skipped", actor);
    await queuePayslipEmail(delivery.payslipId, "payslip_resend", actor, `readdressed:${delivery.id}`);
  }
}

/** issuePayslips for a locked month, by month. Never throws: it runs in the background after a lock. */
export async function issuePayslipsForMonth(month: PayrollMonth, actor: Actor): Promise<void> {
  try {
    const runId = await lockedRunId(month, actor);
    if (runId) await issuePayslips(runId, actor);
  } catch {
    // Whatever didn't happen shows on the month as not made or waiting, with Try again.
  }
}

export async function lockedRunId(month: PayrollMonth, actor: Actor): Promise<string | null> {
  const [run] = await asUser(claimsFor(actor), (tx) =>
    tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.month, firstOfMonth(month)), eq(payrollRuns.status, "locked"))).limit(1),
  );
  return run?.id ?? null;
}

// ── Sending ─────────────────────────────────────────────────────────────────────

type Outcome = { status: "sent" | "failed" | "skipped"; error?: string };

async function composePayslipEmail(delivery: typeof emailDeliveries.$inferSelect, actor: Actor) {
  const [slip] = await asUser(claimsFor(actor), (tx) =>
    tx.select({ content: payslips.content, pdf: payslips.pdf, personId: payslips.personId }).from(payslips).where(eq(payslips.id, delivery.payslipId ?? "")).limit(1),
  );
  if (!slip) return null;
  const model = slip.content as PayslipModel;
  const firstName = firstNameFrom(model.person.name, "");
  const email = payslipEmail({
    firstName,
    monthName: model.monthName,
    takeHome: model.takeHome,
    adminFirstName: model.contact,
    reason: delivery.kind === "payslip_self" ? "asked" : "issued",
  });
  return { email, attachments: [{ filename: `Payslip ${model.monthName}.pdf`, content: slip.pdf, contentType: "application/pdf" }] };
}

async function composeLeaveEmail(delivery: typeof emailDeliveries.$inferSelect, actor: Actor): Promise<{ email: Email } | { skip: true }> {
  const [row] = await asUser(claimsFor(actor), (tx) =>
    tx
      .select({ request: leaveRequests, name: people.fullName, email: people.email })
      .from(leaveRequests)
      .innerJoin(people, eq(people.id, leaveRequests.personId))
      .where(eq(leaveRequests.id, delivery.leaveRequestId ?? ""))
      .limit(1),
  );
  // Undone or changed since it was queued: the email would no longer be true.
  const context = delivery.context as { status?: string; decided_at?: string };
  if (!row || row.request.status !== context.status) return { skip: true };
  if (delivery.kind === "leave_decided" && context.decided_at && new Date(context.decided_at).getTime() !== row.request.decidedAt?.getTime()) return { skip: true };

  const leave = await loadLeaveContext(actor, row.request.personId);
  const days = leave?.requests.find((request) => request.id === row.request.id)?.days ?? countLeaveDays(row.request, calendarFrom([], [1, 2, 3, 4, 5]), "working").total;
  if (delivery.kind === "leave_requested") {
    return {
      email: leaveRequestedEmail({
        personName: row.name,
        leaveType: row.request.leaveType,
        days,
        startDate: row.request.startDate,
        endDate: row.request.endDate,
        note: row.request.note,
        url: `${serverEnv.APP_URL}/admin`,
      }),
    };
  }
  return {
    email: leaveDecidedEmail({
      firstName: firstNameFrom(row.name, row.email),
      decision: row.request.status === "approved" ? "approved" : "declined",
      leaveType: row.request.leaveType,
      days,
      startDate: row.request.startDate,
      endDate: row.request.endDate,
      note: row.request.decisionNote,
      adminFirstName: actor.firstName,
      url: `${serverEnv.APP_URL}/leave`,
    }),
  };
}

/** Claims, sends and records each delivery in turn. One failing never stops the rest. */
export async function sendDeliveries(deliveryIds: string[], actor: Actor): Promise<Map<string, Outcome>> {
  const outcomes = new Map<string, Outcome>();
  for (const id of deliveryIds) {
    const claimed = await asUser(claimsFor(actor), async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`select id from public.claim_email_delivery(${id})`);
      if (!rows.length) return null;
      const [delivery] = await tx.select().from(emailDeliveries).where(eq(emailDeliveries.id, id)).limit(1);
      return delivery ?? null;
    });
    if (!claimed) continue;

    let outcome: Outcome;
    try {
      if (claimed.kind === "leave_requested" || claimed.kind === "leave_decided") {
        const composed = await composeLeaveEmail(claimed, actor);
        if ("skip" in composed) outcome = { status: "skipped" };
        else {
          const sent = await sendEmail({ to: claimed.toEmail, ...composed.email, idempotencyKey: claimed.id });
          outcome = sent.ok ? { status: "sent" } : { status: "failed", error: sent.error };
          if (sent.ok) await finish(id, "sent", actor, sent.providerId);
        }
      } else {
        const composed = await composePayslipEmail(claimed, actor);
        if (!composed) outcome = { status: "failed", error: "The payslip couldn’t be found." };
        else {
          const sent = await sendEmail({ to: claimed.toEmail, ...composed.email, attachments: composed.attachments, idempotencyKey: claimed.id });
          outcome = sent.ok ? { status: "sent" } : { status: "failed", error: sent.error };
          if (sent.ok) await finish(id, "sent", actor, sent.providerId);
        }
      }
    } catch {
      outcome = { status: "failed", error: "Something went wrong preparing this email. Try again." };
    }
    if (outcome.status !== "sent") await finish(id, outcome.status, actor, undefined, outcome.error);
    outcomes.set(id, outcome);
  }
  return outcomes;
}

async function finish(id: string, outcome: Outcome["status"], actor: Actor, providerId?: string, error?: string) {
  await asUser(claimsFor(actor), (tx) =>
    tx.execute(sql`select public.finish_email_delivery(${id}, ${outcome}::public.email_status, ${providerId ?? null}, ${error ?? null})`),
  );
}

/** Queues a leave email and sends it once Undo has had its moment. Never throws. */
export async function notifyLeave(requestId: string, kind: "leave_requested" | "leave_decided", actor: Actor, delaySeconds = LEAVE_EMAIL_DELAY_SECONDS): Promise<void> {
  try {
    await asUser(claimsFor(actor), (tx) => tx.execute(sql`select public.queue_leave_email(${requestId}, ${kind}::public.email_kind, ${delaySeconds})`));
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000 + 500));
    const due = await asUser(claimsFor(actor), (tx) =>
      tx
        .select({ id: emailDeliveries.id })
        .from(emailDeliveries)
        .where(and(eq(emailDeliveries.leaveRequestId, requestId), eq(emailDeliveries.kind, kind), eq(emailDeliveries.status, "queued"))),
    );
    await sendDeliveries(
      due.map((row) => row.id),
      actor,
    );
  } catch {
    // A leave email is a courtesy; the change itself is already saved and shows in the app.
  }
}
