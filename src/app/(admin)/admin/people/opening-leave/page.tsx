import { CalendarClock } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { OpeningLeaveForm } from "@/components/leave/opening-leave-form";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { formatLongDate } from "@/lib/format";
import { openingLeaveView } from "@/modules/leave/opening";

export const metadata = { title: "Leave taken before DashTeam" };

export default async function OpeningLeavePage() {
  const user = await requireRole("admin");
  const view = await openingLeaveView(user);
  const back = { href: "/admin/people" as const, label: "People" };

  if (!view.ready) {
    return (
      <Page title="Leave taken before DashTeam" back={back}>
        <InsetSection>
          <EmptyState icon={CalendarClock} title="Choose your first payroll month first" message="Leave taken before DashTeam is counted up to the day it starts paying." />
        </InsetSection>
        <div className="flex justify-center">
          <ButtonLink href="/admin/payroll" variant="plain">
            Go to Payroll
          </ButtonLink>
        </div>
      </Page>
    );
  }

  const since = formatLongDate(`${view.year}-01-01`).replace(/ \d{4}$/, "");
  const until = formatLongDate(view.asOf);
  return (
    <Page
      title="Leave taken before DashTeam"
      subtitle={`From ${since} until ${until}, when DashTeam started. It counts as used in everyone’s ${view.year} balance.`}
      back={back}
    >
      {view.locked ? (
        <p className="px-4 text-secondary text-pretty text-label-secondary">These are fixed now that a month is locked in DashTeam.</p>
      ) : null}
      {view.people.length ? (
        <OpeningLeaveForm year={view.year} asOf={view.asOf} locked={view.locked} people={view.people} />
      ) : (
        <InsetSection>
          <EmptyState icon={CalendarClock} title="No one to fill in" message={`Nobody worked here before ${until}, so there’s no earlier leave to count.`} />
        </InsetSection>
      )}
    </Page>
  );
}
