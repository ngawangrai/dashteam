import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Home" };

export default async function EmployeeHomePage() {
  const user = await requireUser();
  return (
    <Page title={`Hello, ${user.firstName}`}>
      <InsetSection>
        <EmptyState
          icon={CalendarDays}
          title="Your leave and payslips will show up here"
          message="Once payroll starts in DashTeam, you’ll see your leave left and your latest payslip."
        />
      </InsetSection>
    </Page>
  );
}
