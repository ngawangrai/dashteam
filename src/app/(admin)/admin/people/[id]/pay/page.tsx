import { notFound } from "next/navigation";
import { InsetRow, InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { ChangePayForm } from "@/components/people/change-pay-form";
import { requireRole } from "@/lib/auth/session";
import { addMonths, firstOfMonth, formatMonth, formatNu, monthOf } from "@/lib/format";
import { takeHomeFor } from "@/modules/people/estimate";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import { monthlyPayOf } from "@/modules/people/pay";
import { getPersonDetail, rulesForMonth, thisMonth } from "@/modules/people/repository";
import { latestLockedMonth } from "@/modules/run/repository";

export const metadata = { title: "Change pay" };

const asText = (amount: number) => formatNu(amount).replace("Nu. ", "");

export default async function ChangePayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPersonDetail(user, id);
  if (!detail) notFound();
  const { person, current, upcoming, pay } = detail;

  // This month or any of the next twelve; next month is the usual choice. A locked payroll month
  // can't change, so it isn't offered.
  const month = thisMonth();
  const latest = await latestLockedMonth(user);
  const taken = new Set<string>(pay.map((record) => record.effectiveFrom));
  if (latest) for (let i = 0; i <= 12; i += 1) if (firstOfMonth(addMonths(month, i)) <= firstOfMonth(latest)) taken.add(firstOfMonth(addMonths(month, i)));
  const months = Array.from({ length: 13 }, (_, i) => {
    const m = addMonths(month, i);
    return { value: firstOfMonth(m), label: `${formatMonth(m, { withYear: true })}${i === 0 ? " (this month)" : ""}` };
  }).filter((option) => !taken.has(option.value));
  const defaultMonth = months.find((option) => option.value === firstOfMonth(addMonths(month, 1)))?.value ?? months[0]?.value ?? "";

  const base = upcoming ?? current;
  const rules = await rulesForMonth(user);
  const now = current && rules ? takeHomeFor(current, rules) : null;

  return (
    <Page title="Change pay" back={{ href: `/admin/people/${person.id}`, label: person.fullName }}>
      <ChangePayForm
        personId={person.id}
        months={months}
        defaultMonth={defaultMonth}
        rules={rules}
        now={now}
        initial={{
          employmentType: base?.employmentType ?? "full_time",
          basic: base?.employmentType === "full_time" ? asText(base.basic) : "",
          allowances: base?.employmentType === "full_time" && base.allowances ? asText(base.allowances) : "",
          stipend: base?.employmentType === "intern" ? asText(base.stipend) : "",
        }}
      />
      <InsetSection title="History">
        {pay.map((record) => (
          <InsetRow key={record.id} label={`From ${formatMonth(monthOf(record.effectiveFrom), { withYear: true })}`}>
            {EMPLOYMENT_TYPE_LABEL[record.employmentType]} · <Money amount={monthlyPayOf(record)} className="text-label" />
          </InsetRow>
        ))}
      </InsetSection>
    </Page>
  );
}
