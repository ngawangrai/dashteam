import { CalendarClock } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { ImportList } from "@/components/import/import-list";
import { ImportPanel } from "@/components/import/import-panel";
import { InsetSection } from "@/components/inset-section";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { formatMonth } from "@/lib/format";
import { importsOverview } from "@/modules/import/repository";

export const metadata = { title: "Bring in past months" };

export default async function ImportPage() {
  const user = await requireRole("admin");
  const overview = await importsOverview(user);
  const back = { href: "/admin/payroll" as const, label: "Payroll" };

  if (!overview.firstMonth) {
    return (
      <Page title="Bring in past months" back={back}>
        <InsetSection>
          <EmptyState icon={CalendarClock} title="Choose your first payroll month first" message="Months before it can be brought in from your old records. Months from it on are paid in DashTeam." />
        </InsetSection>
        <div className="flex justify-center">
          <ButtonLink href="/admin/payroll" variant="plain">
            Go to Payroll
          </ButtonLink>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Bring in past months" subtitle={`Months before ${formatMonth(overview.firstMonth, { withYear: true })}, from your old records`} back={back}>
      <ImportPanel />
      <ImportList imports={overview.imports} canRemove={overview.canRemove} />
    </Page>
  );
}
