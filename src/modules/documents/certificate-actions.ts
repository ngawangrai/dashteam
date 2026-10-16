"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { claimsFor, requireRole, requireUser } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { rules, signatureImages } from "@/lib/db/schema";
import { firstOfMonth } from "@/lib/format";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { thisMonth } from "@/modules/people/repository";
import { declineCertificate, emailCertificate, issueCertificate, requestCertificate, withdrawCertificateRequest } from "./certificates";

// Asking for, withdrawing, issuing and declining salary certificates, and setting who signs them.
// Each returns the transaction it wrote, so the screen can offer Undo.

export type CertificateActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "done"; message: string; transactionId: number };

const uuid = z.uuid();

const requestSchema = z.object({
  addressee: z.string().trim().max(200, "Keep who it’s addressed to under 200 characters."),
  purpose: z.string().trim().max(120, "Keep the purpose under 120 characters."),
});

function fieldErrorsOf(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  return { status: "error" as const, message: Object.values(fieldErrors)[0] ?? "Check the details and try again.", fieldErrors };
}

export async function requestSalaryCertificate(_previous: CertificateActionState, formData: FormData): Promise<CertificateActionState> {
  const user = await requireUser();
  const parsed = requestSchema.safeParse({ addressee: String(formData.get("addressee") ?? ""), purpose: String(formData.get("purpose") ?? "") });
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const result = await requestCertificate(user, parsed.data.addressee, parsed.data.purpose);
  if (result.status === "error") return result;
  revalidatePath("/payslips");
  revalidatePath("/admin");
  return { status: "done", message: "Your request is sent. You’ll get an email when it’s ready.", transactionId: result.transactionId };
}

export async function withdrawSalaryCertificate(requestId: string): Promise<CertificateActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(requestId).success) return { status: "error", message: "This request couldn’t be found." };
  const result = await withdrawCertificateRequest(user, requestId);
  if (result.status === "error") return result;
  revalidatePath("/payslips");
  revalidatePath("/admin");
  return { status: "done", message: "Your request is withdrawn.", transactionId: result.transactionId };
}

export async function issueSalaryCertificate(requestId: string, _previous: CertificateActionState, formData: FormData): Promise<CertificateActionState> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(requestId).success) return { status: "error", message: "This request couldn’t be found." };
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();
  if (jobTitle.length > 80) return { status: "error", message: "Keep the job title under 80 characters.", fieldErrors: { jobTitle: "Keep the job title under 80 characters." } };
  const result = await issueCertificate(admin, requestId, jobTitle);
  if (result.status === "error") return { status: "error", message: result.message, ...(result.field ? { fieldErrors: { [result.field]: result.message } } : {}) };
  after(() => emailCertificate(result.certificateId, admin));
  revalidatePath("/admin", "layout");
  revalidatePath("/payslips");
  return { status: "done", message: `${result.personName}’s certificate is issued and on its way to them.`, transactionId: result.transactionId };
}

export async function declineSalaryCertificate(requestId: string, _previous: CertificateActionState, formData: FormData): Promise<CertificateActionState> {
  const admin = await requireRole("admin");
  if (!uuid.safeParse(requestId).success) return { status: "error", message: "This request couldn’t be found." };
  const note = String(formData.get("note") ?? "").trim();
  if (note.length > 500) return { status: "error", message: "Keep the note under 500 characters.", fieldErrors: { note: "Keep the note under 500 characters." } };
  const result = await declineCertificate(admin, requestId, note);
  if (result.status === "error") return result;
  revalidatePath("/admin", "layout");
  revalidatePath("/payslips");
  return { status: "done", message: "Declined. They’ll see your note in DashTeam.", transactionId: result.transactionId };
}

// ── Who signs ───────────────────────────────────────────────────────────────────

const SIGNATURE_TYPES = ["image/png", "image/jpeg"] as const;
const SIGNATURE_MAX_BYTES = 500 * 1024;

const signatorySchema = z.object({
  signatoryName: z.string().trim().min(1, "Add the name of who signs.").max(80, "Keep the name under 80 characters."),
  signatoryTitle: z.string().trim().min(1, "Add their title, like Founder.").max(80, "Keep the title under 80 characters."),
});

/** Sets who signs certificates from this month on, replacing anything set earlier this month. */
export async function saveSignatory(_previous: CertificateActionState, formData: FormData): Promise<CertificateActionState> {
  const admin = await requireRole("admin");
  const parsed = signatorySchema.safeParse({ signatoryName: String(formData.get("signatoryName") ?? ""), signatoryTitle: String(formData.get("signatoryTitle") ?? "") });
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const file = formData.get("signature");
  const upload = file instanceof File && file.size > 0 ? file : null;
  if (upload && !SIGNATURE_TYPES.includes(upload.type as (typeof SIGNATURE_TYPES)[number])) {
    return { status: "error", message: "Upload the signature as a PNG or JPEG.", fieldErrors: { signature: "Upload the signature as a PNG or JPEG." } };
  }
  if (upload && upload.size > SIGNATURE_MAX_BYTES) {
    return { status: "error", message: "That image is over 500 KB. A smaller scan works fine.", fieldErrors: { signature: "That image is over 500 KB. A smaller scan works fine." } };
  }
  const keep = String(formData.get("keepSignature") ?? "");

  try {
    // The image is saved on its own, first, so Undo of the setting never has to remove a file.
    let signatureId: string | null = uuid.safeParse(keep).success ? keep : null;
    if (upload) {
      signatureId = await asUser(claimsFor(admin), async (tx) => {
        await labelNextWrites(tx, "certificate_settings.set");
        const [row] = await tx
          .insert(signatureImages)
          .values({ contentType: upload.type, bytes: Buffer.from(await upload.arrayBuffer()), uploadedBy: admin.id })
          .returning({ id: signatureImages.id });
        return row?.id ?? null;
      });
    }
    const effectiveFrom = firstOfMonth(thisMonth());
    const value = { signatory_name: parsed.data.signatoryName, signatory_title: parsed.data.signatoryTitle, signature_id: signatureId };
    const transactionId = await asUser(claimsFor(admin), async (tx) => {
      await labelNextWrites(tx, "certificate_settings.set");
      await tx.delete(rules).where(and(eq(rules.key, "certificate_settings"), eq(rules.effectiveFrom, effectiveFrom)));
      await tx.insert(rules).values(
        (["full_time", "intern"] as const).map((employmentType) => ({
          key: "certificate_settings" as const,
          employmentType,
          effectiveFrom,
          value,
          note: "Who signs salary certificates, set in DashTeam.",
          createdBy: admin.id,
        })),
      );
      return currentTransactionId(tx);
    });
    revalidatePath("/admin", "layout");
    return { status: "done", message: `Certificates are signed by ${parsed.data.signatoryName} from now on.`, transactionId };
  } catch {
    return { status: "error", message: "We couldn’t save that just now. Try again in a minute." };
  }
}
