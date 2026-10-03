import { CalendarCheck } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { LinkRow } from "@/components/link-row";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { FirstMonthForm } from "@/components/run/first-month-form";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatMonth, monthOf, thimphuToday } from "@/lib/format";
import { thisMonth } from "@/modules/people/repository";
import { firstMonthChoices, monthKey } from "@/modules/run/months";
import { draftRun, payrollOverview } from "@/modules/run/repository";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const user = await requireRole("admin");
  const overview = await payrollOverview(user);

  if (!overview.firstMonth || !overview.openMonth) {
    const now = thisMonth();
    const choices = firstMonthChoices(now).map((month) => ({ value: monthKey(month), label: formatMonth(month, { withYear: true }) }));
    return (
      <Page title="Payroll">
        <FirstMonthForm choices={choices} defaultValue={monthKey(now)} />
      </Page>
    );
  }

  const open = overview.openMonth;
  const run = await draftRun(user, open);
  const name = formatMonth(open);
  const toLookAt = run.checks.filter((check) => !(check.kind === "acknowledge" && check.acknowledged)).length;
  const started = thimphuToday() >= `${monthKey(open)}-01`;

  return (
    <Page title="Payroll">
      <section className="flex flex-col gap-4 rounded-card bg-surface p-4" aria-labelledby="open-month">
        <div className="flex flex-col gap-1">
          <h2 id="open-month" className="text-title">
            {formatMonth(open, { withYear: true })}
          </h2>
          <p className="text-secondary text-label-secondary">
            {!started ? `Starts 1 ${name}` : toLookAt ? (toLookAt === 1 ? "1 thing to look at before locking" : `${toLookAt} things to look at before locking`) : "Ready to lock"}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-secondary text-label-secondary">
            Take-home for {run.totals.people === 1 ? "1 person" : `${run.totals.people} people`}
          </span>
          <Money amount={run.totals.takeHome} className="text-large-title" />
        </div>
        <ButtonLink href={`/admin/payroll/${monthKey(open)}`} className="w-full">
          Open {name} payroll
        </ButtonLink>
      </section>

      <InsetSection title="Locked" footer={`DashTeam pays from ${formatMonth(overview.firstMonth, { withYear: true })}.`}>
        {overview.locked.length ? (
          overview.locked.map((run) => {
            const month = monthOf(run.month);
            return (
              <LinkRow
                key={run.id}
                href={`/admin/payroll/${monthKey(month)}`}
                title={formatMonth(month, { withYear: true })}
                detail={`${run.peopleCount === 1 ? "1 person" : `${run.peopleCount} people`} · locked ${formatDate(thimphuToday(run.lockedAt ?? new Date()))}`}
                trailing={<Money amount={run.takeHomeCh ?? 0} />}
              />
            );
          })
        ) : (
          <EmptyState icon={CalendarCheck} title="No months locked yet" message={`When you lock ${name}, it shows up here with its bank list.`} />
        )}
      </InsetSection>
    </Page>
  );
}
