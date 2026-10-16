import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser, type Tx } from "@/lib/db/client";
import { certificateRequests, payRecords, people, rules, salaryCertificates, signatureImages } from "@/lib/db/schema";
import { monthOf, thimphuToday } from "@/lib/format";
import { currentTransactionId, labelNextWrites } from "@/modules/audit/labels";
import { type PayTerms, payInForce } from "@/modules/people/pay";
import { toPayView } from "@/modules/people/repository";
import { resolveCertificateSettings, resolveCompanyDetails } from "@/modules/rules/resolve";
import { toRuleRow } from "@/modules/rules/rows";
import type { CertificateSettings, Chhertum, EmploymentType } from "@/modules/rules/types";
import type { SignatureImage } from "./certificate-document";
import { type CertificateModel, certificateModel, certificateReference } from "./certificate-model";
import { LEAVE_EMAIL_DELAY_SECONDS, sendDeliveries } from "./issue";
import { renderCertificate } from "./render";

// Salary certificates: a person asks, an admin issues, and the letter is made once from the pay record
// in force on the issue date and stored. Everything runs as the signed-in person, so RLS decides who
// sees what; the database guards decide what can change.

const plainTerms = (terms: PayTerms): PayTerms =>
  terms.employmentType === "intern"
    ? { effectiveFrom: terms.effectiveFrom, employmentType: "intern", stipend: terms.stipend }
    : { effectiveFrom: terms.effectiveFrom, employmentType: "full_time", basic: terms.basic, allowances: terms.allowances };

export type CertificatePreview = { jobTitle: string | null; employmentType: EmploymentType; startDate: string; monthlyPay: Chhertum } | null;

export type CertificateRequestView = {
  id: string;
  status: "pending" | "issued" | "declined" | "withdrawn";
  addressee: string;
  purpose: string;
  decisionNote: string;
  createdAt: Date;
  decidedAt: Date | null;
  certificate: { id: string; reference: string; issuedOn: string } | null;
};

export type CertificateState = {
  /** What the letter would say about them today, or null with no pay set up yet. */
  preview: CertificatePreview;
  canRequest: boolean;
  requests: CertificateRequestView[];
};

async function personFacts(tx: Tx, personId: string) {
  const [person] = await tx
    .select({ fullName: people.fullName, jobTitle: people.jobTitle, startDate: people.startDate, endDate: people.endDate })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (!person) return null;
  const pay = (await tx.select().from(payRecords).where(eq(payRecords.personId, personId))).map(toPayView);
  return { person, pay };
}

/** A person's certificate requests and what a new one would say, as they (or an admin) see it. */
export async function certificateStateFor(user: SessionUser, personId: string): Promise<CertificateState> {
  const today = thimphuToday();
  return asUser(claimsFor(user), async (tx) => {
    const facts = await personFacts(tx, personId);
    const rows = await tx
      .select({ request: certificateRequests, certificate: { id: salaryCertificates.id, reference: salaryCertificates.reference, issuedOn: salaryCertificates.issuedOn } })
      .from(certificateRequests)
      .leftJoin(salaryCertificates, eq(salaryCertificates.requestId, certificateRequests.id))
      .where(eq(certificateRequests.personId, personId))
      .orderBy(desc(certificateRequests.createdAt));
    const terms = facts ? payInForce(facts.pay, monthOf(today)) : null;
    const employed = facts !== null && (facts.person.endDate === null || facts.person.endDate >= today);
    const requests: CertificateRequestView[] = rows.map(({ request, certificate }) => ({
      id: request.id,
      status: request.status,
      addressee: request.addressee,
      purpose: request.purpose,
      decisionNote: request.decisionNote,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
      certificate: certificate?.id ? { id: certificate.id, reference: certificate.reference, issuedOn: certificate.issuedOn } : null,
    }));
    return {
      preview: facts && terms ? { jobTitle: facts.person.jobTitle, employmentType: terms.employmentType, startDate: facts.person.startDate, monthlyPay: terms.employmentType === "intern" ? terms.stipend : terms.basic + terms.allowances } : null,
      canRequest: employed && terms !== null && !requests.some((r) => r.status === "pending"),
      requests,
    };
  });
}

export type ActionOutcome = { status: "done"; transactionId: number } | { status: "error"; message: string };

const REQUEST_FAILED = "We couldn’t send that just now. Try again in a minute.";

export async function requestCertificate(user: SessionUser, addressee: string, purpose: string): Promise<ActionOutcome> {
  if (!user.personId) return { status: "error", message: "Certificates are for people on the team." };
  const personId = user.personId;
  try {
    return await asUser(claimsFor(user), async (tx) => {
      await labelNextWrites(tx, "certificate.requested");
      await tx.insert(certificateRequests).values({ personId, addressee, purpose, requestedBy: user.id });
      return { status: "done", transactionId: await currentTransactionId(tx) };
    });
  } catch (error) {
    if (String(error).includes("certificate_requests_one_pending")) return { status: "error", message: "You already have a request waiting." };
    if (String(error).includes("work at Xceed now")) return { status: "error", message: "Certificates are for people who work at Xceed now." };
    return { status: "error", message: REQUEST_FAILED };
  }
}

export async function withdrawCertificateRequest(user: SessionUser, requestId: string): Promise<ActionOutcome> {
  try {
    return await asUser(claimsFor(user), async (tx) => {
      await labelNextWrites(tx, "certificate.withdrawn");
      const updated = await tx
        .update(certificateRequests)
        .set({ status: "withdrawn" })
        .where(and(eq(certificateRequests.id, requestId), eq(certificateRequests.status, "pending")))
        .returning({ id: certificateRequests.id });
      if (!updated.length) return { status: "error", message: "This request has already been answered." } as const;
      return { status: "done", transactionId: await currentTransactionId(tx) } as const;
    });
  } catch {
    return { status: "error", message: REQUEST_FAILED };
  }
}

// ── Admin: the waiting requests, reviewed as the letter will read ─────────────────

export type PendingCertificate = {
  id: string;
  personId: string;
  personName: string;
  addressee: string;
  purpose: string;
  createdAt: Date;
  jobTitle: string | null;
  /** The letter as it would be issued today. Null when something it needs is missing. */
  letter: CertificateModel | null;
  missing: "pay" | "signatory" | null;
};

const PREVIEW_REFERENCE = "XS-SC-…";
/** Where the job title goes in a preview when it isn't on file yet; the review sheet fills it in as it's typed. */
export const JOB_TITLE_SLOT = "{{job title}}";

async function signatoryAndCompany(tx: Tx, today: string) {
  const ruleRows = (await tx.select().from(rules)).map(toRuleRow);
  const month = monthOf(today);
  return { settings: resolveCertificateSettings(ruleRows, month), company: resolveCompanyDetails(ruleRows, month) };
}

export async function pendingCertificates(admin: SessionUser): Promise<PendingCertificate[]> {
  const today = thimphuToday();
  return asUser(claimsFor(admin), async (tx) => {
    const waiting = await tx
      .select({ request: certificateRequests, personName: people.fullName })
      .from(certificateRequests)
      .innerJoin(people, eq(people.id, certificateRequests.personId))
      .where(eq(certificateRequests.status, "pending"))
      .orderBy(certificateRequests.createdAt);
    if (!waiting.length) return [];
    const { settings, company } = await signatoryAndCompany(tx, today);
    const out: PendingCertificate[] = [];
    for (const { request, personName } of waiting) {
      const facts = await personFacts(tx, request.personId);
      const terms = facts ? payInForce(facts.pay, monthOf(today)) : null;
      const missing = !terms ? "pay" : !settings ? "signatory" : null;
      const letter =
        facts && terms && settings
          ? certificateModel({
              person: { name: facts.person.fullName, jobTitle: facts.person.jobTitle || JOB_TITLE_SLOT, startDate: facts.person.startDate },
              terms: plainTerms(terms),
              addressee: request.addressee,
              purpose: request.purpose,
              signatory: { name: settings.signatoryName, title: settings.signatoryTitle },
              company,
              reference: PREVIEW_REFERENCE,
              issuedOn: today,
            })
          : null;
      out.push({ id: request.id, personId: request.personId, personName, addressee: request.addressee, purpose: request.purpose, createdAt: request.createdAt, jobTitle: facts?.person.jobTitle ?? null, letter, missing });
    }
    return out;
  });
}

export type IssueOutcome = { status: "issued"; transactionId: number; certificateId: string; personName: string } | { status: "error"; message: string; field?: "jobTitle" };

async function signatureOf(tx: Tx, settings: CertificateSettings): Promise<SignatureImage | null> {
  if (!settings.signatureId) return null;
  const [image] = await tx.select({ bytes: signatureImages.bytes, contentType: signatureImages.contentType }).from(signatureImages).where(eq(signatureImages.id, settings.signatureId)).limit(1);
  return image ? { data: image.bytes, format: image.contentType === "image/png" ? "png" : "jpg" } : null;
}

/** Issues the certificate: one transaction, so Undo takes back the letter, the job title and the decision together. */
export async function issueCertificate(admin: SessionUser, requestId: string, jobTitleGiven: string): Promise<IssueOutcome> {
  const today = thimphuToday();
  try {
    return await asUser(claimsFor(admin), async (tx): Promise<IssueOutcome> => {
      const [request] = await tx.select().from(certificateRequests).where(eq(certificateRequests.id, requestId)).limit(1);
      if (!request || request.status !== "pending") return { status: "error", message: "This request has already been answered." };
      const facts = await personFacts(tx, request.personId);
      const terms = facts ? payInForce(facts.pay, monthOf(today)) : null;
      if (!facts || !terms) return { status: "error", message: "Their pay isn’t set up yet, so there’s nothing to certify." };
      const { settings, company } = await signatoryAndCompany(tx, today);
      if (!settings) return { status: "error", message: "Add who signs certificates first." };

      await labelNextWrites(tx, "certificate.issued");
      const jobTitle = facts.person.jobTitle?.trim() || jobTitleGiven.trim();
      if (!jobTitle) return { status: "error", message: `Add ${facts.person.fullName}’s job title. It goes on the letter.`, field: "jobTitle" };
      if (!facts.person.jobTitle?.trim()) await tx.update(people).set({ jobTitle, updatedAt: new Date() }).where(eq(people.id, request.personId));

      const [numbered] = await tx.execute<{ position: number }>(sql`select public.next_document_number('certificate') as position`);
      const reference = certificateReference(Number(today.slice(0, 4)), Number(numbered?.position ?? 1));
      const model = certificateModel({
        person: { name: facts.person.fullName, jobTitle, startDate: facts.person.startDate },
        terms: plainTerms(terms),
        addressee: request.addressee,
        purpose: request.purpose,
        signatory: { name: settings.signatoryName, title: settings.signatoryTitle },
        company,
        reference,
        issuedOn: today,
      });
      const { pdf, sha256 } = await renderCertificate(model, await signatureOf(tx, settings));
      const [certificate] = await tx
        .insert(salaryCertificates)
        .values({ requestId, personId: request.personId, reference, issuedOn: today, content: model, pdf, pdfSha256: sha256, ruleIds: [...company.ruleIds, ...settings.ruleIds], issuedBy: admin.id })
        .returning({ id: salaryCertificates.id });
      await tx.update(certificateRequests).set({ status: "issued" }).where(eq(certificateRequests.id, requestId));
      return { status: "issued", transactionId: await currentTransactionId(tx), certificateId: certificate?.id ?? "", personName: facts.person.fullName };
    });
  } catch {
    return { status: "error", message: "We couldn’t issue it just now. Nothing was saved. Try again in a minute." };
  }
}

export async function declineCertificate(admin: SessionUser, requestId: string, note: string): Promise<ActionOutcome> {
  try {
    return await asUser(claimsFor(admin), async (tx) => {
      await labelNextWrites(tx, "certificate.declined");
      const updated = await tx
        .update(certificateRequests)
        .set({ status: "declined", decisionNote: note })
        .where(and(eq(certificateRequests.id, requestId), eq(certificateRequests.status, "pending")))
        .returning({ id: certificateRequests.id });
      if (!updated.length) return { status: "error", message: "This request has already been answered." } as const;
      return { status: "done", transactionId: await currentTransactionId(tx) } as const;
    });
  } catch {
    return { status: "error", message: REQUEST_FAILED };
  }
}

/** After an issue commits: the email, held back long enough for Undo to stop it. Never throws. */
export async function emailCertificate(certificateId: string, actor: SessionUser, delaySeconds = LEAVE_EMAIL_DELAY_SECONDS): Promise<void> {
  try {
    const rows = await asUser(claimsFor(actor), (tx) => tx.execute<{ id: string | null }>(sql`select public.queue_certificate_email(${certificateId}, ${delaySeconds}) as id`));
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000 + 500));
    const id = rows[0]?.id;
    if (id) await sendDeliveries([id], actor);
  } catch {
    // The certificate is issued and in the app either way; the email is a courtesy.
  }
}

/** For the file route: the stored PDF, if the signed-in person may see it. */
export async function certificateFile(user: SessionUser, id: string): Promise<{ pdf: Buffer; filename: string } | null> {
  return asUser(claimsFor(user), async (tx) => {
    const [row] = await tx.select({ pdf: salaryCertificates.pdf, content: salaryCertificates.content }).from(salaryCertificates).where(eq(salaryCertificates.id, id)).limit(1);
    if (!row) return null;
    await tx.execute(sql`select public.record_document_download('certificate', ${id})`);
    const model = row.content as CertificateModel;
    const who = user.role === "admin" ? `, ${model.person.name}` : "";
    return { pdf: row.pdf, filename: `Salary certificate ${model.reference}${who}.pdf` };
  });
}
