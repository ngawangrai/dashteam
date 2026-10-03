import { Palmtree } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { BalanceSummary } from "@/components/leave/balance-summary";
import { LeaveList } from "@/components/leave/leave-list";
import { LeaveNotices } from "@/components/leave/leave-notices";
import { MarkDecisionsSeen } from "@/components/leave/mark-seen";
import { LinkRow } from "@/components/link-row";
import { RequestLeaveSheet } from "@/components/leave/request-sheet";
import { WhosOut } from "@/components/leave/whos-out";
import { Page } from "@/components/page";
import { requireUser } from "@/lib/auth/session";
import { monthBounds, monthFromParam, thimphuToday } from "@/lib/format";
import { requestLeave } from "@/modules/leave/actions";
import { balancesFor, holidaysInYear, loadLeaveContext, sheetContextFor, unseenDecisions, unseenNotices, whoIsOut } from "@/modules/leave/repository";

export const metadata = { title: "Leave" };

type LeavePageProps = { searchParams: Promise<{ month?: string }> };

export default async function LeavePage({ searchParams }: LeavePageProps) {
  const user = await requireUser();
  const today = thimphuToday();
  const month = monthFromParam((await searchParams).month, today);
  const context = user.personId ? await loadLeaveContext(user, user.personId) : null;
  const sheet = context ? sheetContextFor(context) : null;

  const { from, to } = monthBounds(month);
  const [out, monthHolidays, unseen, notices] = await Promise.all([
    whoIsOut(user, from, to),
    holidaysInYear(user, month.year),
    unseenDecisions(user),
    unseenNotices(user),
  ]);

  if (!context || !sheet) {
    return (
      <Page title="Leave">
        <InsetSection>
          <EmptyState icon={Palmtree} title="No leave to show" message="You don’t have a staff record with pay, so there’s no leave to request. Ask your admin." />
        </InsetSection>
      </Page>
    );
  }

  const upcoming = context.requests.filter((r) => r.endDate >= today && (r.status === "pending" || r.status === "approved"));
  const history = context.requests.filter((r) => !upcoming.includes(r)).reverse();

  return (
    <Page title="Leave">
      <MarkDecisionsSeen unseen={unseen} />
      <LeaveNotices notices={notices} />
      <BalanceSummary lines={balancesFor(context, Number(today.slice(0, 4)))} />
      <div className="md:max-w-xs">
        <RequestLeaveSheet context={sheet} action={requestLeave} />
      </div>
      <InsetSection title="Coming up">
        {upcoming.length ? (
          <LeaveList requests={upcoming} today={today} />
        ) : (
          <p className="px-4 py-3 text-body text-label-secondary">Nothing booked. Leave you request will show up here.</p>
        )}
      </InsetSection>
      {history.length ? (
        <InsetSection title="Earlier">
          <LeaveList requests={history} today={today} />
        </InsetSection>
      ) : (
        <InsetSection>
          <EmptyState icon={Palmtree} title="No leave yet" message="When you take time off, it will show up here." />
        </InsetSection>
      )}
      <WhosOut
        month={month}
        entries={out.filter((entry) => entry.personId !== user.personId)}
        today={today}
        workingWeek={context.calendar.workingWeek}
        holidays={monthHolidays}
        path="/leave"
      />
      <InsetSection>
        <LinkRow href="/holidays" title={`Holidays in ${Number(today.slice(0, 4))}`} />
      </InsetSection>
    </Page>
  );
}
