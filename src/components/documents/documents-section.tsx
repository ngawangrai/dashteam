"use client";

import { useState } from "react";
import { ButtonRow } from "@/components/button-row";
import { InsetSection } from "@/components/inset-section";
import type { CertificateState } from "@/modules/documents/certificates";
import type { PaidMonth } from "@/modules/documents/statements";
import { CertificateSheet, certificateRowDetail } from "./certificate-sheet";
import { StatementSheet } from "./statement-sheet";

/** The two documents people ask for besides payslips, each one tap away. */
export function DocumentsSection({ personId, months, certificates }: { personId: string; months: PaidMonth[]; certificates: CertificateState | null }) {
  const [open, setOpen] = useState<"statement" | "certificate" | null>(null);
  return (
    <InsetSection>
      {months.length ? <ButtonRow title="Pay statement" detail="Your pay across 3, 6 or 12 months, in one PDF" onClick={() => setOpen("statement")} /> : null}
      {certificates ? <ButtonRow title="Salary certificate" detail={certificateRowDetail(certificates)} onClick={() => setOpen("certificate")} /> : null}
      {months.length ? <StatementSheet open={open === "statement"} onClose={() => setOpen(null)} personId={personId} months={months} /> : null}
      {certificates ? <CertificateSheet open={open === "certificate"} onClose={() => setOpen(null)} state={certificates} /> : null}
    </InsetSection>
  );
}
