import { notFound, redirect } from "next/navigation";
import { EntryTable } from "@/components/filing/entry-table";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { formatMonth } from "@/lib/format";
import { entryRowsFor, filingFor } from "@/modules/filing/repository";
import { monthFromKey } from "@/modules/run/months";

type Params = { params: Promise<{ month: string }> };

export const metadata = { title: "Enter IT-1(a) by hand" };

/** The IT-1(a) to type into RAMIS by hand: copy each field, tick each person off. */
export default async function EntryPage({ params }: Params) {
  const admin = await requireRole("admin");
  const { month: key } = await params;
  const month = monthFromKey(key);
  if (!month) notFound();
  const filing = await filingFor(admin, month);
  if (!filing.scheduleId || !filing.totals) redirect(`/admin/payroll/${key}/filing`);
  const rows = await entryRowsFor(admin, filing);

  return (
    // Thirteen columns: this screen gets more width than other admin screens, so every field shows.
    <div className="[--page-width:80rem]">
      <Page
      title="Enter by hand"
      subtitle={`${formatMonth(month, { withYear: true })} IT-1(a), in the form’s order. Each field copies with one tap or click.`}
      back={{ href: `/admin/payroll/${key}/filing`, label: `${formatMonth(month, { withYear: true })} TDS` }}
    >
        <EntryTable monthKey={key} rows={rows} totals={filing.totals} entered={filing.entered} />
      </Page>
    </div>
  );
}
