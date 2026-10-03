"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { claimsFor, requireRole, requireUser } from "@/lib/auth/session";
import { decryptField, encryptField, type EncryptedField, lastFour } from "@/lib/crypto/field";
import { asUser } from "@/lib/db/client";
import { payRecords, people, profileChangeRequests } from "@/lib/db/schema";
import { firstOfMonth, formatDate, formatMonth, monthOf } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { firstNameFrom } from "@/lib/auth/roles";
import { lockedMessage, lockedMonthsIn } from "@/modules/run/locked";
import { thisMonth } from "./repository";
import { type PayFields, changeRequestSchema, exitSchema, newPersonSchema, payChangeSchema, personDetailsSchema } from "./schema";

// Every write: check the role, validate, name the audit action, write in one transaction,
// and return the transaction id so the screen can offer Undo. Errors are plain words, never raw.

export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "done"; message: string; transactionId: number; redirectTo?: string };

const SAVE_FAILED = "We couldn’t save that just now. Try again in a minute.";

function invalid(error: z.ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return { status: "error", message: "Check the highlighted fields.", fieldErrors };
}

const formValues = (formData: FormData) => Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]));

function payColumns(pay: PayFields) {
  return pay.employmentType === "intern"
    ? { employmentType: pay.employmentType, stipendCh: pay.stipend, basicCh: null, allowancesCh: null }
    : { employmentType: pay.employmentType, basicCh: pay.basic, allowancesCh: pay.allowances, stipendCh: null };
}

function encrypted(personId: string, field: EncryptedField, value: string) {
  return { ciphertext: encryptField(value, { personId, field }), last4: lastFour(value) };
}

/** A change inside a locked payroll month, refused by the database, in words that say what to do instead. */
function lockedError(error: unknown, field: string): ActionState | null {
  const months = lockedMonthsIn(error);
  if (!months) return null;
  const message = lockedMessage(months, "admin");
  return { status: "error", message, fieldErrors: { [field]: message } };
}

const isUniqueViolation = (error: unknown, constraint: string) =>
  error instanceof Error && (error.message.includes(constraint) || String((error as { cause?: unknown }).cause ?? "").includes(constraint));

// ── Adding a person ─────────────────────────────────────────────────────────────

export async function addPerson(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("admin");
  const parsed = newPersonSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  const claims = claimsFor(admin);

  const existing = await asUser(claims, (tx) => tx.select({ id: people.id }).from(people).where(eq(people.email, input.email)).limit(1));
  if (existing.length) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: { email: "Someone with this email is already in DashTeam." } };
  }

  // Their login: reuse one that already exists for this email (for example the admin's own), or create it.
  const supabaseAdmin = createSupabaseAdminClient();
  const [found] = await asUser(claims, (tx) =>
    tx.execute<{ id: string | null }>(sql`select public.auth_user_id_for_email(${input.email}) as id`),
  );
  let profileId = found?.id ?? null;
  let createdLogin = false;
  if (!profileId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (error || !data.user) return { status: "error", message: "We couldn’t set up their sign-in just now. Try again in a minute." };
    profileId = data.user.id;
    createdLogin = true;
  }

  const personId = randomUUID();
  try {
    const transactionId = await asUser(claims, async (tx) => {
      await labelNextWrites(tx, "person.created");
      const bankAccount = input.bankAccount ? encrypted(personId, "bank_account", input.bankAccount) : null;
      const tpn = input.tpn ? encrypted(personId, "tpn", input.tpn) : null;
      await tx.insert(people).values({
        id: personId,
        profileId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        bankName: input.bankName,
        bankAccountCiphertext: bankAccount?.ciphertext ?? null,
        bankAccountLast4: bankAccount?.last4 ?? null,
        tpnCiphertext: tpn?.ciphertext ?? null,
        tpnLast4: tpn?.last4 ?? null,
        startDate: input.startDate,
      });
      await labelNextWrites(tx, "pay.set");
      await tx.insert(payRecords).values({
        personId,
        effectiveFrom: firstOfMonth(monthOf(input.startDate)),
        ...payColumns(input.pay),
        note: "Pay when they joined",
        createdBy: admin.id,
      });
      return currentTransactionId(tx);
    });
    revalidatePath("/admin/people");
    return {
      status: "done",
      message: `${firstNameFrom(input.fullName, input.email)} is added. They can sign in with ${input.email}.`,
      transactionId,
      redirectTo: `/admin/people/${personId}`,
    };
  } catch (error) {
    if (createdLogin && profileId) await supabaseAdmin.auth.admin.deleteUser(profileId);
    const locked = lockedError(error, "startDate");
    if (locked) return locked;
    if (isUniqueViolation(error, "people_profile_id_unique")) {
      return { status: "error", message: "Check the highlighted fields.", fieldErrors: { email: "This sign-in already belongs to someone in DashTeam." } };
    }
    return { status: "error", message: SAVE_FAILED };
  }
}

// ── Editing details ─────────────────────────────────────────────────────────────

export async function updatePerson(personId: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("admin");
  const parsed = personDetailsSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  const claims = claimsFor(admin);

  const [current] = await asUser(claims, (tx) => tx.select().from(people).where(eq(people.id, personId)).limit(1));
  if (!current) return { status: "error", message: "This person couldn’t be found. They may have been removed." };

  if (input.email !== current.email) {
    const taken = await asUser(claims, (tx) => tx.select({ id: people.id }).from(people).where(eq(people.email, input.email)).limit(1));
    if (taken.length) {
      return { status: "error", message: "Check the highlighted fields.", fieldErrors: { email: "Someone with this email is already in DashTeam." } };
    }
  }

  // Their sign-in email follows their record.
  const supabaseAdmin = createSupabaseAdminClient();
  const emailChanged = input.email !== current.email && current.profileId !== null;
  if (emailChanged && current.profileId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(current.profileId, { email: input.email, email_confirm: true });
    if (error) return { status: "error", message: "We couldn’t change their sign-in email just now. Try again in a minute." };
  }

  try {
    const transactionId = await asUser(claims, async (tx) => {
      await labelNextWrites(tx, "person.updated");
      // A blank TPN or account number means "keep what's there"; the old value is never sent to the browser.
      const bankAccount = input.bankAccount ? encrypted(personId, "bank_account", input.bankAccount) : null;
      const tpn = input.tpn ? encrypted(personId, "tpn", input.tpn) : null;
      await tx
        .update(people)
        .set({
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          bankName: input.bankName ?? current.bankName,
          ...(bankAccount ? { bankAccountCiphertext: bankAccount.ciphertext, bankAccountLast4: bankAccount.last4 } : {}),
          ...(tpn ? { tpnCiphertext: tpn.ciphertext, tpnLast4: tpn.last4 } : {}),
          startDate: input.startDate,
        })
        .where(eq(people.id, personId));
      return currentTransactionId(tx);
    });
    revalidatePath(`/admin/people/${personId}`);
    revalidatePath("/admin/people");
    return { status: "done", message: "Changes saved.", transactionId, redirectTo: `/admin/people/${personId}` };
  } catch (error) {
    if (emailChanged && current.profileId) {
      await supabaseAdmin.auth.admin.updateUserById(current.profileId, { email: current.email, email_confirm: true });
    }
    return lockedError(error, "startDate") ?? { status: "error", message: SAVE_FAILED };
  }
}

// ── Pay changes ─────────────────────────────────────────────────────────────────

export async function changePay(personId: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("admin");
  const parsed = payChangeSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { effectiveFrom, pay } = parsed.data;
  const month = monthOf(effectiveFrom);

  if (effectiveFrom < firstOfMonth(thisMonth())) {
    return { status: "error", message: "Check the highlighted fields.", fieldErrors: { effectiveFrom: "A pay change can start this month at the earliest." } };
  }

  try {
    const result = await asUser(claimsFor(admin), async (tx) => {
      const [person] = await tx.select({ fullName: people.fullName, email: people.email }).from(people).where(eq(people.id, personId)).limit(1);
      if (!person) return null;
      await labelNextWrites(tx, "pay.changed");
      await tx.insert(payRecords).values({ personId, effectiveFrom, ...payColumns(pay), note: "", createdBy: admin.id });
      return { person, transactionId: await currentTransactionId(tx) };
    });
    if (!result) return { status: "error", message: "This person couldn’t be found. They may have been removed." };
    revalidatePath(`/admin/people/${personId}`);
    return {
      status: "done",
      message: `${firstNameFrom(result.person.fullName, result.person.email)}’s pay changes from ${formatMonth(month, { withYear: true })}.`,
      transactionId: result.transactionId,
      redirectTo: `/admin/people/${personId}`,
    };
  } catch (error) {
    const locked = lockedError(error, "effectiveFrom");
    if (locked) return locked;
    if (isUniqueViolation(error, "pay_records_person_effective_from")) {
      return {
        status: "error",
        message: "Check the highlighted fields.",
        fieldErrors: { effectiveFrom: `There’s already a pay change from ${formatMonth(month)}. Pick another month.` },
      };
    }
    return { status: "error", message: SAVE_FAILED };
  }
}

// ── Leaving ─────────────────────────────────────────────────────────────────────

export async function markAsLeft(personId: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole("admin");
  const claims = claimsFor(admin);
  const [person] = await asUser(claims, (tx) => tx.select().from(people).where(eq(people.id, personId)).limit(1));
  if (!person) return { status: "error", message: "This person couldn’t be found. They may have been removed." };

  const parsed = exitSchema(person.startDate).safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const transactionId = await asUser(claims, async (tx) => {
      await labelNextWrites(tx, "person.exited");
      await tx.update(people).set({ endDate: parsed.data.endDate }).where(eq(people.id, personId));
      return currentTransactionId(tx);
    });
    revalidatePath("/admin/people");
    revalidatePath(`/admin/people/${personId}`);
    return {
      status: "done",
      message: `${firstNameFrom(person.fullName, person.email)} is marked as left on ${formatDate(parsed.data.endDate)}.`,
      transactionId,
      redirectTo: `/admin/people/${personId}`,
    };
  } catch (error) {
    return lockedError(error, "endDate") ?? { status: "error", message: SAVE_FAILED };
  }
}

// ── Showing a TPN or account number in full ─────────────────────────────────────

export type RevealResult = { ok: true; value: string } | { ok: false; message: string };

export async function revealField(personId: string, field: EncryptedField): Promise<RevealResult> {
  const user = await requireUser();
  if (field !== "tpn" && field !== "bank_account") return { ok: false, message: "Nothing to show." };
  try {
    // RLS returns the row only to its owner or an admin; record_reveal checks the same and logs it.
    const ciphertext = await asUser(claimsFor(user), async (tx) => {
      const [row] = await tx
        .select({ tpn: people.tpnCiphertext, bankAccount: people.bankAccountCiphertext })
        .from(people)
        .where(eq(people.id, personId))
        .limit(1);
      const stored = field === "tpn" ? row?.tpn : row?.bankAccount;
      if (!stored) return null;
      await tx.execute(sql`select public.record_reveal(${personId}, ${field})`);
      return stored;
    });
    if (!ciphertext) return { ok: false, message: "Nothing to show." };
    return { ok: true, value: decryptField(ciphertext, { personId, field }) };
  } catch {
    return { ok: false, message: "We couldn’t show this just now. Try again in a minute." };
  }
}

// ── Profile change requests ─────────────────────────────────────────────────────

export async function requestChange(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const personId = user.personId;
  if (!personId) return { status: "error", message: "You don’t have a staff record to change. Ask your admin." };
  const claims = claimsFor(user);

  const [current] = await asUser(claims, (tx) =>
    tx.select({ phone: people.phone, bankName: people.bankName }).from(people).where(eq(people.id, personId)).limit(1),
  );
  if (!current) return { status: "error", message: SAVE_FAILED };

  const parsed = changeRequestSchema(current).safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const change = parsed.data;

  try {
    const transactionId = await asUser(claims, async (tx) => {
      await labelNextWrites(tx, "profile_change.requested");
      const bankAccount = change.bankAccount ? encrypted(personId, "bank_account", change.bankAccount) : null;
      await tx.insert(profileChangeRequests).values({
        personId,
        requestedBy: user.id,
        phone: change.phone,
        bankName: change.bankName,
        bankAccountCiphertext: bankAccount?.ciphertext ?? null,
        bankAccountLast4: bankAccount?.last4 ?? null,
      });
      return currentTransactionId(tx);
    });
    revalidatePath("/profile");
    return { status: "done", message: "Sent to your admin.", transactionId };
  } catch (error) {
    if (isUniqueViolation(error, "profile_change_requests_one_pending")) {
      return { status: "error", message: "You already have a change waiting for approval. Withdraw it first to send a new one." };
    }
    return { status: "error", message: SAVE_FAILED };
  }
}

export async function withdrawRequest(requestId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    const transactionId = await asUser(claimsFor(user), async (tx) => {
      await labelNextWrites(tx, "profile_change.withdrawn");
      const updated = await tx
        .update(profileChangeRequests)
        .set({ status: "withdrawn" })
        .where(and(eq(profileChangeRequests.id, requestId), eq(profileChangeRequests.status, "pending")))
        .returning({ id: profileChangeRequests.id });
      if (!updated.length) throw new Error("not found");
      return currentTransactionId(tx);
    });
    revalidatePath("/profile");
    return { status: "done", message: "Request withdrawn.", transactionId };
  } catch {
    return { status: "error", message: "This request can’t be withdrawn any more." };
  }
}

export async function decideRequest(requestId: string, decision: "approved" | "declined"): Promise<ActionState> {
  const admin = await requireRole("admin");
  if (decision !== "approved" && decision !== "declined") return { status: "error", message: SAVE_FAILED };
  try {
    const result = await asUser(claimsFor(admin), async (tx) => {
      const [request] = await tx
        .select()
        .from(profileChangeRequests)
        .where(and(eq(profileChangeRequests.id, requestId), eq(profileChangeRequests.status, "pending")))
        .limit(1);
      if (!request) return null;
      const [person] = await tx.select({ fullName: people.fullName, email: people.email }).from(people).where(eq(people.id, request.personId));

      await labelNextWrites(tx, decision === "approved" ? "profile_change.approved" : "profile_change.declined");
      await tx.update(profileChangeRequests).set({ status: decision }).where(eq(profileChangeRequests.id, requestId));
      if (decision === "approved") {
        // The account was encrypted for this person and field, so the ciphertext moves across as it is.
        await tx
          .update(people)
          .set({
            ...(request.phone ? { phone: request.phone } : {}),
            ...(request.bankName ? { bankName: request.bankName } : {}),
            ...(request.bankAccountCiphertext
              ? { bankAccountCiphertext: request.bankAccountCiphertext, bankAccountLast4: request.bankAccountLast4 }
              : {}),
          })
          .where(eq(people.id, request.personId));
      }
      return { name: person ? firstNameFrom(person.fullName, person.email) : "Their", transactionId: await currentTransactionId(tx) };
    });
    if (!result) return { status: "error", message: "This request was already decided or withdrawn." };
    revalidatePath("/admin");
    return {
      status: "done",
      message: decision === "approved" ? `${result.name}’s new details are saved.` : `Declined. ${result.name}’s details stay as they are.`,
      transactionId: result.transactionId,
    };
  } catch {
    return { status: "error", message: SAVE_FAILED };
  }
}
