import { FileLock2 } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Payslip link" };

/** Where every refused payslip link lands: expired, someone else's, or not a link at all. */
export default async function PayslipUnavailablePage() {
  const user = await requireUser();
  return (
    <Page title="Payslip">
      <InsetSection>
        <EmptyState icon={FileLock2} title="This link has expired or isn’t yours" message="Payslip links work for a minute, for the person who opened them. Open your payslips to get a new one." />
      </InsetSection>
      <div className="flex justify-center">
        <ButtonLink href={user.role === "admin" ? "/admin/payroll" : "/payslips"} variant="secondary">
          {user.role === "admin" ? "Go to Payroll" : "Open your payslips"}
        </ButtonLink>
      </div>
    </Page>
  );
}
