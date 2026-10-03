import { InsetSection } from "@/components/inset-section";
import { WhosOut } from "@/components/leave/whos-out";
import { LinkRow } from "@/components/link-row";
import { Page } from "@/components/page";
import { monthBounds, monthFromParam, thimphuToday } from "@/lib/format";
import { holidaysInYear, whoIsOut } from "@/modules/leave/repository";
import { loadRuleRows } from "@/modules/rules/repository";
import { resolveLeaveRules } from "@/modules/rules/resolve";
import { claimsFor, requireRole } from "@/lib/auth/session";

export const metadata = { title: "Calendar" };

export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireRole("admin");
  const today = thimphuToday();
  const month = monthFromParam((await searchParams).month, today);
  const { from, to } = monthBounds(month);
  const [out, holidays, ruleRows] = await Promise.all([whoIsOut(user, from, to), holidaysInYear(user, month.year), loadRuleRows(claimsFor(user))]);
  let workingWeek = [1, 2, 3, 4, 5];
  try {
    workingWeek = resolveLeaveRules(ruleRows, "full_time", month).workingWeek;
  } catch {
    // Before any leave rules: Monday to Friday.
  }

  return (
    <Page title="Calendar">
      <WhosOut month={month} entries={out} today={today} workingWeek={workingWeek} holidays={holidays} path="/admin/calendar" />
      <InsetSection>
        <LinkRow href="/admin/calendar/holidays" title="Holidays" detail={holidays.length ? `${holidays.length} in ${month.year}` : `None added for ${month.year}`} />
      </InsetSection>
    </Page>
  );
}

