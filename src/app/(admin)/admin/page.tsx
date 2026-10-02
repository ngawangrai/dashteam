import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { RequestCard } from "@/components/people/request-card";
import { requireRole } from "@/lib/auth/session";
import { listPendingRequests } from "@/modules/people/repository";

export const metadata = { title: "Admin" };

export default async function AdminHomePage() {
  // Checked here as well as in the layout: layouts do not re-run on every navigation.
  const user = await requireRole("admin");
  const requests = await listPendingRequests(user);

  return (
    <Page title={`Hello, ${user.firstName}`}>
      {requests.length ? (
        <InsetSection title="Needs you">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </InsetSection>
      ) : (
        <InsetSection>
          <EmptyState
            icon={Inbox}
            title="Nothing needs you right now"
            message="When someone asks to change their details, it will show up here for you to approve."
          />
        </InsetSection>
      )}
    </Page>
  );
}
