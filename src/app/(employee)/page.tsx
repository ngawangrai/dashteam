import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { BalanceSummary } from "@/components/leave/balance-summary";
import { RequestLeaveSheet } from "@/components/leave/request-sheet";
import { Page } from "@/components/page";
import { requireUser } from "@/lib/auth/session";
import { formatDays, formatSpan, thimphuToday } from "@/lib/format";
import { requestLeave } from "@/modules/leave/actions";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";
import { balancesFor, loadLeaveContext, sheetContextFor } from "@/modules/leave/repository";

export const metadata = { title: "Home" };

export default async function EmployeeHomePage() {
  const user = await requireUser();
  const context = user.personId ? await loadLeaveContext(user, user.personId) : null;
  const today = thimphuToday();
  const sheet = context ? sheetContextFor(context) : null;

  if (!context || !sheet) {
    return (
      <Page title={`Hello, ${user.firstName}`}>
        <InsetSection>
          <EmptyState icon={CalendarDays} title="Your leave and payslips will show up here" message="Once your admin sets up your pay, you’ll see your leave left here." />
        </InsetSection>
      </Page>
    );
  }

  const balances = balancesFor(context, Number(today.slice(0, 4)));
  const next = context.requests.find((request) => request.endDate >= today && (request.status === "approved" || request.status === "pending"));

  return (
    <Page title={`Hello, ${user.firstName}`}>
      <BalanceSummary lines={balances} compact />
      <InsetSection title="Coming up">
        {next ? (
          <Link href="/leave" className="flex min-h-11 flex-col px-4 py-2.5">
            <span className="text-body">
              {LEAVE_TYPE_NAME[next.leaveType]} · <span className="tabular">{formatSpan(next.startDate, next.endDate)}</span>
            </span>
            <span className="text-secondary text-label-secondary">
              {formatDays(next.days)} · {next.status === "pending" ? "waiting for approval" : "approved"}
            </span>
          </Link>
        ) : (
          <p className="px-4 py-3 text-body text-label-secondary">No leave booked. When you need time off, request it here.</p>
        )}
      </InsetSection>
      <div className="md:max-w-xs">
        <RequestLeaveSheet context={sheet} action={requestLeave} />
      </div>
    </Page>
  );
}
