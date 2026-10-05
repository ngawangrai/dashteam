import { ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { PayslipList } from "@/components/documents/payslip-list";
import { requireUser } from "@/lib/auth/session";
import { ownPayslips } from "@/modules/documents/repository";

export const metadata = { title: "Payslips" };

type Props = { searchParams: Promise<{ open?: string }> };

/** Every payslip since joining. Tap a month, then Download PDF: two taps. */
export default async function PayslipsPage({ searchParams }: Props) {
  const user = await requireUser();
  const [payslips, { open }] = await Promise.all([ownPayslips(user), searchParams]);
  return (
    <Page title="Payslips">
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
