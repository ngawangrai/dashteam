import { HolidayReminder } from "@/components/leave/holiday-reminder";
import { HolidaysManager } from "@/components/leave/holidays-manager";
import { YearSwitcher } from "@/components/leave/year-switcher";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { thimphuToday } from "@/lib/format";
import { needsHolidayReminder } from "@/modules/leave/holidays";
import { holidaysInYear } from "@/modules/leave/repository";

export const metadata = { title: "Holidays" };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireRole("admin");
  const today = thimphuToday();
  const thisYear = Number(today.slice(0, 4));
  const param = (await searchParams).year;
  const year = param && /^\d{4}$/.test(param) ? Number(param) : thisYear;
  const [holidays, nextYear] = await Promise.all([holidaysInYear(user, year), holidaysInYear(user, thisYear + 1)]);
  const remind = needsHolidayReminder(today, nextYear.filter((h) => h.status === "confirmed").length);

  return (
    <Page title="Holidays" back={{ href: "/admin/calendar", label: "Calendar" }} action={<YearSwitcher year={year} path="/admin/calendar/holidays" />}>
      {remind && year !== thisYear + 1 ? <HolidayReminder year={thisYear + 1} /> : null}
      <HolidaysManager year={year} holidays={holidays} />
    </Page>
  );
}
