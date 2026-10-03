import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { InsetRow, InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { HoldToLock } from "@/components/run/hold-to-lock";
import { requireRole } from "@/lib/auth/session";
import { formatLongDate, formatMonth } from "@/lib/format";
import { monthFromKey } from "@/modules/run/months";
import { draftRun, isLocked } from "@/modules/run/repository";

type Params = { params: Promise<{ month: string }> };

export const metadata = { title: "Lock payroll" };

/** The calm review before the one thing that can't be undone. */
export default async function LockPayrollPage({ params }: Params) {
  const user = await requireRole("admin");
  const { month: key } = await params;
  const month = monthFromKey(key);
  if (!month) notFound();
  if (await isLocked(user, month)) redirect(`/admin/payroll/${key}`);

  const run = await draftRun(user, month);
  const name = formatMonth(month);
  const open = run.checks.filter((check) => !(check.kind === "acknowledge" && check.acknowledged));

  return (
    <Page title={`Lock ${name} payroll`} back={{ href: `/admin/payroll/${key}`, label: formatMonth(month, { withYear: true }) }}>
      <InsetSection>
        <InsetRow label="People paid">
          <span className="tabular text-label">{run.totals.people}</span>
        </InsetRow>
        <InsetRow label="Total take-home">
          <Money amount={run.totals.takeHome} className="font-semibold text-label" />
        </InsetRow>
        <InsetRow label="To DRC (TDS and HC)">
          <Money amount={run.totals.remit} className="text-label" />
        </InsetRow>
        <InsetRow label="Due by">
          <span className="tabular text-label">{formatLongDate(run.dueDate)}</span>
        </InsetRow>
      </InsetSection>

      <p className="px-4 text-body text-pretty text-label-secondary">
        Locking saves every figure as it is now and freezes {name} for good. Pay, leave, holidays and dates in {name} can’t change after this. If
        something turns out wrong, you correct it with a one-off on a later month.
      </p>

      {run.ready ? (
        <HoldToLock monthKey={key} monthName={name} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface p-4 text-center">
          <p className="text-body text-pretty">
            {open.length === 1 ? "1 thing still needs you" : `${open.length} things still need you`} before {name} can be locked.
          </p>
          <ButtonLink href={`/admin/payroll/${key}`} variant="secondary">
            Back to {name}
          </ButtonLink>
        </div>
      )}
    </Page>
  );
}
