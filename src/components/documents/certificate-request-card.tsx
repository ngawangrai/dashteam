"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { FormMessage, TextField, controlClass } from "@/components/field";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { type CertificateActionState, declineSalaryCertificate, issueSalaryCertificate } from "@/modules/documents/certificate-actions";
import type { CertificateModel } from "@/modules/documents/certificate-model";
import type { PendingCertificate } from "@/modules/documents/certificates";

// A certificate request waiting for the admin. Review shows the letter exactly as it will be issued;
// Issue certificate is the one primary action there. Decline takes an optional note, as with leave.

const SLOT = "{{job title}}";

/** The letter as it will read, on a sheet of paper. */
export function LetterPreview({ letter, jobTitle }: { letter: CertificateModel; jobTitle: string }) {
  const fill = (text: string) => text.replace(SLOT, jobTitle.trim() || "…");
  return (
    <article aria-label="The certificate as it will read" className="flex flex-col gap-3 rounded-card border border-separator/60 bg-white p-4 text-[15px] leading-relaxed text-[#1c1c1e] dark:border-transparent">
      <header className="flex flex-col">
        <span className="font-bold">{letter.company.name}</span>
        {letter.company.addressLines.map((line) => (
          <span key={line} className="text-caption text-[#6c6c70]">
            {line}
          </span>
        ))}
      </header>
      <div className="flex justify-between text-caption text-[#6c6c70]">
        <span>Ref: {letter.reference}</span>
        <span>{letter.issuedOn}</span>
      </div>
      <div className="flex flex-col">
        {letter.addressee[0] === "To whom it may concern" ? null : <span>To</span>}
        {letter.addressee.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      <p className="font-semibold">{letter.subject}</p>
      {letter.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-pretty">
          {fill(paragraph)}
        </p>
      ))}
      <div className="flex flex-col pt-2">
        <span>{letter.signOff}</span>
        <span className="mt-6 font-semibold">{letter.signatory.name}</span>
        <span>{letter.signatory.title}</span>
      </div>
    </article>
  );
}

export function CertificateRequestCard({ request }: { request: PendingCertificate }) {
  const router = useRouter();
  const first = request.personName.split(" ")[0] ?? request.personName;
  const [reviewing, setReviewing] = useState(false);
  const [jobTitle, setJobTitle] = useState(request.jobTitle ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [declining, startDecline] = useTransition();
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const [state, issueAction, issuing] = useActionState<CertificateActionState, FormData>(async (previous, formData) => {
    const result = await issueSalaryCertificate(request.id, previous, formData);
    if (result.status === "done") {
      setReviewing(false);
      setLeaving(true);
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });

  function decline() {
    setDeclineError(null);
    startDecline(async () => {
      const formData = new FormData();
      formData.set("note", note);
      const result = await declineSalaryCertificate(request.id, { status: "idle" }, formData);
      if (result.status === "done") {
        setLeaving(true);
        confirmWithUndo(result, router);
        router.refresh();
      } else if (result.status === "error") setDeclineError(result.message);
    });
  }

  const forWhom = [request.addressee ? `For ${request.addressee}` : "To whom it may concern", request.purpose].filter(Boolean).join(" · ");
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <article
      aria-busy={declining || issuing || undefined}
      className={`flex flex-col gap-3 border-b border-separator/60 p-4 transition-opacity duration-200 ease-(--ease-out) last:border-b-0 ${leaving ? "opacity-0" : ""}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <Link href={`/admin/people/${request.personId}`} className="truncate text-body font-semibold">
          {request.personName}
        </Link>
        <span className="shrink-0 text-secondary text-label-secondary">Salary certificate</span>
      </header>
      <p className="text-body text-pretty">{forWhom}</p>
      {request.missing === "signatory" ? (
        <p className="text-secondary text-pretty text-label-secondary">
          Add who signs certificates before issuing.{" "}
          <Link href="/admin/settings/certificates" className="text-accent">
            Set the signatory
          </Link>
        </p>
      ) : request.missing === "pay" ? (
        <p className="text-secondary text-pretty text-label-secondary">{first}’s pay isn’t set up yet, so there’s nothing to certify.</p>
      ) : null}
      {noteOpen ? (
        <label className="flex flex-col gap-2">
          <span className="text-secondary font-medium">Note for {first} (optional)</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className={controlClass} autoFocus />
        </label>
      ) : null}
      <FormMessage message={declineError} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!noteOpen ? (
          <Button variant="plain" className="mr-auto -ml-4" onClick={() => setNoteOpen(true)}>
            Add a note
          </Button>
        ) : null}
        <Button variant="secondary" disabled={declining || issuing} aria-busy={declining || undefined} onClick={decline}>
          Decline
        </Button>
        <Button disabled={!request.letter || declining} onClick={() => setReviewing(true)}>
          Review
        </Button>
      </div>

      {request.letter ? (
        <Sheet open={reviewing} onClose={() => setReviewing(false)} title={`${first}’s certificate`}>
          <form action={issueAction} className="flex flex-col gap-4" noValidate>
            {!request.jobTitle ? (
              <TextField
                name="jobTitle"
                label={`${first}’s job title`}
                placeholder="For example, Product Designer"
                autoComplete="off"
                maxLength={80}
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                error={errors?.jobTitle}
                hint="Saved to their details too, so you won’t be asked again."
              />
            ) : null}
            <LetterPreview letter={request.letter} jobTitle={jobTitle} />
            <p className="text-secondary text-pretty text-label-secondary">It gets the next reference number and is emailed to {first} with the PDF attached.</p>
            <Button type="submit" fullWidth disabled={issuing} aria-busy={issuing || undefined}>
              {issuing ? "Issuing…" : "Issue certificate"}
            </Button>
            <FormMessage message={state.status === "error" && !errors ? state.message : null} />
          </form>
        </Sheet>
      ) : null}
    </article>
  );
}
