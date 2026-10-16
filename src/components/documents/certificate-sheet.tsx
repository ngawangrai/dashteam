"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { FormMessage, TextField } from "@/components/field";
import { Icon } from "@/components/icon";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDate, formatNu } from "@/lib/format";
import { certificateLink } from "@/modules/documents/actions";
import { type CertificateActionState, requestSalaryCertificate, withdrawSalaryCertificate } from "@/modules/documents/certificate-actions";
import type { CertificateState } from "@/modules/documents/certificates";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";

// Asking for a salary certificate: see what it will say, say who it's for if you like, send. While
// it waits, it can be withdrawn; once issued, it's here to download whenever it's needed again.

/** "Waiting for approval", "Issued 7 Oct 2026", or what it is. For the row that opens the sheet. */
export function certificateRowDetail(state: CertificateState): string {
  const latest = state.requests[0];
  if (latest?.status === "pending") return "Waiting for approval";
  const issued = state.requests.find((r) => r.certificate);
  if (latest?.status === "declined" && latest.decidedAt) return `Declined ${formatDate(latest.decidedAt.toISOString().slice(0, 10))}`;
  if (issued?.certificate) return `Issued ${formatDate(issued.certificate.issuedOn)}`;
  return "A letter confirming your job and pay";
}

function DownloadCertificate({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="plain"
      className="px-2"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={`Download ${label}`}
      onClick={() =>
        start(async () => {
          const result = await certificateLink(id);
          if (result.status === "ready") window.location.assign(result.url);
          else toast(result.message);
        })
      }
    >
      <Icon icon={Download} size={18} />
      Download
    </Button>
  );
}

export function CertificateSheet({ open, onClose, state }: { open: boolean; onClose: () => void; state: CertificateState }) {
  const router = useRouter();
  const [withdrawing, startWithdraw] = useTransition();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [formState, formAction, sending] = useActionState<CertificateActionState, FormData>(async (previous, formData) => {
    const result = await requestSalaryCertificate(previous, formData);
    if (result.status === "done") {
      onClose();
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });

  const pending = state.requests.find((r) => r.status === "pending");
  const issued = state.requests.filter((r) => r.certificate);
  const declined = state.requests[0]?.status === "declined" ? state.requests[0] : null;
  const errors = formState.status === "error" ? formState.fieldErrors : undefined;
  const preview = state.preview;

  function withdraw(requestId: string) {
    setWithdrawError(null);
    startWithdraw(async () => {
      const result = await withdrawSalaryCertificate(requestId);
      if (result.status === "done") {
        onClose();
        confirmWithUndo(result, router);
        router.refresh();
      } else if (result.status === "error") setWithdrawError(result.message);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Salary certificate">
      {pending ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-pretty">
            Your request is waiting for approval. You’ll get the certificate by email, and it’ll be here too.
          </p>
          {pending.addressee || pending.purpose ? (
            <p className="text-secondary text-label-secondary">{[pending.addressee && `For ${pending.addressee}`, pending.purpose].filter(Boolean).join(" · ")}</p>
          ) : null}
          <Button variant="secondary" fullWidth disabled={withdrawing} aria-busy={withdrawing || undefined} onClick={() => withdraw(pending.id)}>
            {withdrawing ? "Withdrawing…" : "Withdraw request"}
          </Button>
          <FormMessage message={withdrawError} />
        </div>
      ) : !preview ? (
        <p className="text-body text-pretty">Your pay isn’t set up in DashTeam yet, so there’s nothing to certify. Ask your admin.</p>
      ) : !state.canRequest ? (
        <p className="text-body text-pretty">Certificates are for people who work at Xceed now.</p>
      ) : (
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1 rounded-card bg-fill/60 p-3">
            <span className="text-secondary text-label-secondary">It will confirm</span>
            <span className="text-body text-pretty">
              {[preview.jobTitle, EMPLOYMENT_TYPE_LABEL[preview.employmentType], `since ${formatDate(preview.startDate)}`, `${formatNu(preview.monthlyPay)} a month`].filter(Boolean).join(" · ")}
            </span>
          </div>
          {declined ? (
            <p className="text-secondary text-label-secondary text-pretty">
              Your last request was declined{declined.decisionNote ? `: “${declined.decisionNote}”` : "."} You can ask again.
            </p>
          ) : null}
          <TextField name="addressee" label="Addressed to (optional)" placeholder="For example, Bank of Bhutan, Thimphu" maxLength={200} autoComplete="off" error={errors?.addressee} />
          <TextField name="purpose" label="Purpose (optional)" placeholder="For example, a home loan" maxLength={120} autoComplete="off" error={errors?.purpose} />
          <Button type="submit" fullWidth disabled={sending} aria-busy={sending || undefined}>
            {sending ? "Sending…" : "Request certificate"}
          </Button>
          <FormMessage message={formState.status === "error" && !errors ? formState.message : null} />
        </form>
      )}

      {issued.length ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-secondary font-semibold text-label-secondary">Your certificates</h3>
          <ul>
            {issued.map((request) =>
              request.certificate ? (
                <li key={request.id} className="flex items-center justify-between gap-3 border-b border-separator/60 py-1.5 last:border-b-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body">Issued {formatDate(request.certificate.issuedOn)}</span>
                    <span className="truncate text-secondary text-label-secondary">{request.addressee || "To whom it may concern"}</span>
                  </span>
                  <DownloadCertificate id={request.certificate.id} label={`the certificate issued ${formatDate(request.certificate.issuedOn)}`} />
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}
    </Sheet>
  );
}
