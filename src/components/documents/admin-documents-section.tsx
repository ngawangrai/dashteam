"use client";

import { Download } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { ButtonRow } from "@/components/button-row";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { formatDate } from "@/lib/format";
import { certificateLink } from "@/modules/documents/actions";
import type { CertificateRequestView } from "@/modules/documents/certificates";
import type { PaidMonth } from "@/modules/documents/statements";
import { StatementSheet } from "./statement-sheet";

/** On a person's page: their pay statement (people who have left too) and the certificates issued to them. */
export function AdminDocumentsSection({ personId, personName, months, certificates }: { personId: string; personName: string; months: PaidMonth[]; certificates: CertificateRequestView[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const issued = certificates.filter((request) => request.certificate);
  if (!months.length && !issued.length) return null;

  function download(id: string) {
    start(async () => {
      const result = await certificateLink(id);
      if (result.status === "ready") window.location.assign(result.url);
      else toast(result.message);
    });
  }

  return (
    <InsetSection title="Documents">
      {months.length ? <ButtonRow title="Pay statement" detail="Their pay across a range of months, in one PDF" onClick={() => setOpen(true)} /> : null}
      {issued.map((request) =>
        request.certificate ? (
          <div key={request.id} className="flex min-h-11 items-center gap-3 border-b border-separator/60 px-4 py-1.5 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body">Salary certificate</span>
              <span className="truncate text-secondary text-label-secondary">
                Issued {formatDate(request.certificate.issuedOn)} · {request.addressee || "To whom it may concern"}
              </span>
            </span>
            <Button variant="plain" className="px-2" disabled={pending} aria-busy={pending || undefined} aria-label={`Download the certificate issued ${formatDate(request.certificate.issuedOn)}`} onClick={() => download(request.certificate?.id ?? "")}>
              <Icon icon={Download} size={18} />
              Download
            </Button>
          </div>
        ) : null,
      )}
      {months.length ? <StatementSheet open={open} onClose={() => setOpen(false)} personId={personId} months={months} title={`Pay statement, ${personName}`} /> : null}
    </InsetSection>
  );
}
