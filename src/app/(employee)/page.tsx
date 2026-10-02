import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { HomePage } from "@/components/home-page";
import { InsetSection } from "@/components/inset-section";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Home" };

export default async function EmployeeHomePage() {
  const user = await requireUser();
  return (
    <HomePage title={`Hello, ${user.firstName}`}>
      <InsetSection>
        <EmptyState
          icon={CalendarDays}
          title="Your leave and payslips will show up here"
          message="Once your admin adds your details, you’ll see your leave left and your latest payslip."
        />
      </InsetSection>
    </HomePage>
  );
}
