import { ReceiptText } from "lucide-react";
import { DocumentsSection } from "@/components/documents/documents-section";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { PayslipList } from "@/components/documents/payslip-list";
import { requireUser } from "@/lib/auth/session";
import { certificateStateFor } from "@/modules/documents/certificates";
import { ownPayslips } from "@/modules/documents/repository";
import { statementMonthsFor } from "@/modules/documents/statements";

export const metadata = { title: "Payslips" };

type Props = { searchParams: Promise<{ open?: string }> };

/** Every payslip since joining, and the two documents built from them: a pay statement and a salary certificate. */
export default async function PayslipsPage({ searchParams }: Props) {
  const user = await requireUser();
  const personId = user.personId;
  const [payslips, { open }, months, certificates] = await Promise.all([
    ownPayslips(user),
    searchParams,
    personId ? statementMonthsFor(user, personId) : [],
    personId ? certificateStateFor(user, personId) : null,
  ]);
  return (
    <Page title="Payslips">
      {personId && (months.length || certificates) ? <DocumentsSection personId={personId} months={months} certificates={certificates} /> : null}
      {payslips.length ? (
        <PayslipList payslips={payslips} mode="own" initiallyOpen={open} />
      ) : (
        <InsetSection>
          <EmptyState
            icon={ReceiptText}
            title="No payslips yet"
            message="Your payslip arrives here, and by email, once your first month’s payroll is locked."
          />
        </InsetSection>
      )}
    </Page>
  );
}
