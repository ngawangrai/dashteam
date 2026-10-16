import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { CertificateRequestCard } from "@/components/documents/certificate-request-card";
import { LeaveRequestCard } from "@/components/leave/leave-request-card";
import { Page } from "@/components/page";
import { RequestCard } from "@/components/people/request-card";
import { DueCard } from "@/components/filing/due-card";
import { HolidayReminder } from "@/components/leave/holiday-reminder";
import { thimphuToday } from "@/lib/format";
import { needsHolidayReminder } from "@/modules/leave/holidays";
import { requireRole } from "@/lib/auth/session";
import { pendingCertificates } from "@/modules/documents/certificates";
import { dueCard } from "@/modules/filing/repository";
import { holidaysInYear, pendingLeaveRequests } from "@/modules/leave/repository";
import { listPendingRequests } from "@/modules/people/repository";

export const metadata = { title: "Admin" };

export default async function AdminHomePage() {
  // Checked here as well as in the layout: layouts do not re-run on every navigation.
  const user = await requireRole("admin");
  const today = thimphuToday();
  const nextYear = Number(today.slice(0, 4)) + 1;
  const [leave, profileChanges, certificates, nextYearHolidays, due] = await Promise.all([
    pendingLeaveRequests(user),
    listPendingRequests(user),
    pendingCertificates(user),
    holidaysInYear(user, nextYear),
    dueCard(user),
  ]);
  const remind = needsHolidayReminder(today, nextYearHolidays.filter((holiday) => holiday.status === "confirmed").length);

  return (
    <Page title={`Hello, ${user.firstName}`}>
      {due ? <DueCard due={due} /> : null}
      {remind ? <HolidayReminder year={nextYear} /> : null}
      {leave.length || profileChanges.length || certificates.length ? (
        <>
          {leave.length ? (
            <InsetSection title="Leave to approve">
              {leave.map((request) => (
                <LeaveRequestCard key={request.id} request={request} />
              ))}
            </InsetSection>
          ) : null}
          {certificates.length ? (
            <InsetSection title="Certificates to issue">
              {certificates.map((request) => (
                <CertificateRequestCard key={request.id} request={request} />
              ))}
            </InsetSection>
          ) : null}
          {profileChanges.length ? (
            <InsetSection title="Changes to details">
              {profileChanges.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
            </InsetSection>
          ) : null}
        </>
      ) : (
        <InsetSection>
          <EmptyState
            icon={Inbox}
            title="Nothing needs you right now"
            message="When someone asks for leave, a salary certificate or a change to their details, it will show up here."
          />
        </InsetSection>
      )}
    </Page>
  );
}
