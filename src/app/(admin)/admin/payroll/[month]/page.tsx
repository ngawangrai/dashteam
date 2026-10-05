import { Download, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { DeliveryList } from "@/components/documents/delivery-list";
import { ChecksList } from "@/components/run/checks-list";
import { DraftReview } from "@/components/run/draft-review";
import { LockedReview } from "@/components/run/locked-review";
import { RunTotals } from "@/components/run/run-totals";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatMonth, thimphuToday } from "@/lib/format";
import { deliveryStatus } from "@/modules/documents/repository";
import { monthIndex } from "@/modules/run/build";
import { monthFromKey } from "@/modules/run/months";
import { draftRun, lockedRun, payrollOverview } from "@/modules/run/repository";

type Params = { params: Promise<{ month: string }> };

export const metadata = { title: "Payroll" };

export default async function PayrollMonthPage({ params }: Params) {
  const user = await requireRole("admin");
  const { month: key } = await params;
  const month = monthFromKey(key);
  if (!month) notFound();
  const name = formatMonth(month);
  const title = formatMonth(month, { withYear: true });
  const back = { href: "/admin/payroll" as const, label: "Payroll" };

  // A locked month is read from its snapshot, never worked out again.
  const locked = await lockedRun(user, month);
  if (locked) {
    const { run, people } = locked;
    const deliveries = await deliveryStatus(user, run.id);
    return (
      <Page
        title={title}
        subtitle={`Locked on ${formatDate(thimphuToday(run.lockedAt ?? new Date()))}`}
        back={back}
        action={
          <a
            href={`/admin/payroll/${key}/bank-list`}
            download
            className="pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-accent-fill px-4 text-body font-semibold text-on-accent"
          >
            <Icon icon={Download} size={20} />
            Download bank list
          </a>
        }
      >
        <RunTotals
          locked
          dueDate={run.dueDate ?? ""}
          totals={{
            people: run.peopleCount ?? 0,
            gross: run.grossCh ?? 0,
            tds: run.tdsCh ?? 0,
            healthContribution: run.healthContributionCh ?? 0,
            providentFund: run.providentFundCh ?? 0,
            takeHome: run.takeHomeCh ?? 0,
            remit: run.remitCh ?? 0,
          }}
        />
        {people.length ? <DeliveryList runId={run.id} rows={deliveries} /> : null}
        {people.length ? (
          <LockedReview
            people={people}
            totals={{ gross: run.grossCh ?? 0, takeHome: run.takeHomeCh ?? 0 }}
            monthName={name}
            payslips={Object.fromEntries(deliveries.flatMap((row) => (row.payslip ? [[row.personId, row.payslip]] : [])))}
          />
        ) : (
          <InsetSection>
            <EmptyState icon={Users} title={`No one was paid in ${name}`} message="It was locked with no one employed that month." />
          </InsetSection>
        )}
        <p className="px-4 text-caption text-pretty text-label-secondary">
          {name} is locked, so nothing in it can change. A correction goes on a later month as a one-off. The bank list shows account numbers in full,
          so each download is recorded.
        </p>
      </Page>
    );
  }

  const overview = await payrollOverview(user);
  if (!overview.firstMonth) redirect("/admin/payroll");
  if (monthIndex(month) < monthIndex(overview.firstMonth)) {
    return (
      <Page title={title} back={back}>
        <InsetSection>
          <EmptyState
            icon={Users}
            title={`DashTeam pays from ${formatMonth(overview.firstMonth, { withYear: true })}`}
            message={`${name} was paid another way, so there’s nothing for it here.`}
          />
        </InsetSection>
      </Page>
    );
  }

  const run = await draftRun(user, month);
  return (
    <Page
      title={title}
      subtitle="Draft. It updates as pay, leave and one-offs change."
      back={back}
      action={<ButtonLink href={`/admin/payroll/${key}/lock`}>Lock {name} payroll</ButtonLink>}
    >
      <RunTotals totals={run.totals} dueDate={run.dueDate} />
      <ChecksList checks={run.checks} monthKey={key} />
      {run.people.length ? (
        <DraftReview people={run.people} totals={run.totals} monthKey={key} monthName={name} />
      ) : (
        <InsetSection>
          <EmptyState icon={Users} title={`No one is employed in ${name}`} message={`When someone’s start date is in or before ${name}, they’ll show up here.`} />
        </InsetSection>
      )}
    </Page>
  );
}
