import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { HomePage } from "@/components/home-page";
import { InsetSection } from "@/components/inset-section";
import { requireRole } from "@/lib/auth/session";

export const metadata = { title: "Admin" };

export default async function AdminHomePage() {
  // Checked here as well as in the layout: layouts do not re-run on every navigation.
  const user = await requireRole("admin");
  return (
    <HomePage title={`Hello, ${user.firstName}`}>
      <InsetSection>
        <EmptyState
          icon={Inbox}
          title="Nothing needs you right now"
          message="Leave requests and payroll will show up here when they’re ready for you."
        />
      </InsetSection>
    </HomePage>
  );
}
