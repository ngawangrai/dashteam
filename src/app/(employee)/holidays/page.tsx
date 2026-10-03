import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { HolidayList } from "@/components/leave/holiday-list";
import { YearSwitcher } from "@/components/leave/year-switcher";
import { Page } from "@/components/page";
import { requireUser } from "@/lib/auth/session";
import { thimphuToday } from "@/lib/format";
import { holidaysInYear } from "@/modules/leave/repository";

export const metadata = { title: "Holidays" };

export default async function EmployeeHolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireUser();
  const param = (await searchParams).year;
  const year = param && /^\d{4}$/.test(param) ? Number(param) : Number(thimphuToday().slice(0, 4));
  const holidays = await holidaysInYear(user, year);
  const tentative = holidays.some((holiday) => holiday.status === "tentative");

  return (
    <Page title="Holidays" back={{ href: "/leave", label: "Leave" }} action={<YearSwitcher year={year} path="/holidays" />}>
      {tentative ? (
        <p className="px-4 text-secondary text-pretty text-label-secondary">
          Tentative dates aren’t official yet. They’re counted as holidays now, and if one moves, you’ll see a note on your Leave tab.
        </p>
      ) : null}
      {holidays.length ? (
        <HolidayList holidays={holidays} />
      ) : (
        <InsetSection>
          <EmptyState icon={CalendarDays} title={`No holidays for ${year} yet`} message="They’ll show up here once your admin adds them." />
        </InsetSection>
      )}
    </Page>
  );
}
