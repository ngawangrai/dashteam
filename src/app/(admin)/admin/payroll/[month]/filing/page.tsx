import { Download, FileCheck2, Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { MakeScheduleButton } from "@/components/filing/make-schedule-button";
import { MarkFiledSheet } from "@/components/filing/mark-filed-sheet";
import { Icon } from "@/components/icon";
import { InsetRow, InsetSection } from "@/components/inset-section";
import { LinkRow } from "@/components/link-row";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatLongDate, formatMonth } from "@/lib/format";
import { dueStatus } from "@/modules/filing/due";
import { dueWords } from "@/modules/filing/emails";
import { filingFor, filingToday } from "@/modules/filing/repository";
import { monthFromKey } from "@/modules/run/months";

type Params = { params: Promise<{ month: string }> };

export const metadata = { title: "TDS filing" };

/** One month's TDS filing: what to pay DRC and by when, the IT-1(a) to upload, and the record of filing it. */
export default async function FilingPage({ params }: Params) {
  const admin = await requireRole("admin");
  const { month: key } = await params;
  const month = monthFromKey(key);
  if (!month) notFound();
  const filing = await filingFor(admin, month);
  const today = filingToday();
  const name = formatMonth(month);
  const title = `${formatMonth(month, { withYear: true })} TDS`;
  const due = formatLongDate(filing.dueDate).replace(/ \d{4}$/, "");
  const back = { href: `/admin/payroll/${key}` as const, label: formatMonth(month, { withYear: true }) };

  if (filing.state === "draft") {
    return (
      <Page title={title} subtitle={`Due ${due}`} back={back}>
        <InsetSection>
          <EmptyState icon={Lock} title={`${name} isn’t locked yet`} message={`Lock ${name} payroll, and its IT-1(a) is made from the locked figures.`} />
        </InsetSection>
        <div className="flex justify-center">
          <ButtonLink href={`/admin/payroll/${key}`} variant="secondary">
            Open {name} payroll
          </ButtonLink>
        </div>
      </Page>
    );
  }

  const status = dueStatus(today, filing.dueDate);
  const download = (
    <a
      href={`/admin/payroll/${key}/filing/it1a`}
      download
      className="pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-accent-fill px-4 text-body font-semibold text-on-accent"
    >
      <Icon icon={Download} size={20} />
      Download IT-1(a) file
    </a>
  );
  const subtitle =
    filing.state === "filed" && filing.filedOn
      ? `Filed ${formatDate(filing.filedOn)}`
      : filing.state === "not_made"
        ? `Locked. The IT-1(a) isn’t made yet.`
        : `Ready to file. ${dueWords(status).charAt(0).toUpperCase()}${dueWords(status).slice(1)}.`;

  return (
    <Page title={title} subtitle={subtitle} back={back} action={filing.state === "ready" ? download : undefined}>
      <InsetSection title="To pay DRC" footer={filing.pf ? "PF goes to NPPF separately, not to DRC." : undefined}>
        <InsetRow label="TDS">
          <Money amount={filing.tds ?? 0} className="text-label" />
        </InsetRow>
        <InsetRow label="Health contribution">
          <Money amount={filing.hc ?? 0} className="text-label" />
        </InsetRow>
        <InsetRow label="Total to pay">
          <Money amount={filing.remit ?? 0} className="font-semibold text-label" />
        </InsetRow>
        <InsetRow label="Due by">
          <span className={`tabular ${status.kind === "overdue" && filing.state !== "filed" ? "text-danger" : "text-label"}`}>{formatLongDate(filing.dueDate)}</span>
        </InsetRow>
        {filing.pf ? (
          <InsetRow label="PF (separate)">
            <Money amount={filing.pf} className="text-label" />
          </InsetRow>
        ) : null}
      </InsetSection>

      {filing.state === "not_made" ? (
        <InsetSection>
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <p className="text-body text-pretty">The IT-1(a) is made just after locking. It isn’t here yet, so make it now.</p>
            <MakeScheduleButton monthKey={key} monthName={name} />
          </div>
        </InsetSection>
      ) : null}

      {filing.state !== "not_made" && filing.totals ? (
        <InsetSection title="IT-1(a)" footer={`${filing.totals.people === 1 ? "1 person" : `${filing.totals.people} people`}. The file fills DRC’s own template, ready to upload to RAMIS.`}>
          <InsetRow label="Gross salary">
            <Money amount={filing.totals.gross} className="text-label" />
          </InsetRow>
          <InsetRow label="Net salary">
            <Money amount={filing.totals.net} className="text-label" />
          </InsetRow>
          <LinkRow href={`/admin/payroll/${key}/filing/entry`} title="Enter it by hand instead" detail="Copy each field into RAMIS, one person at a time" />
          {filing.state === "filed" ? (
            <a href={`/admin/payroll/${key}/filing/it1a`} download className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-body text-accent hover:bg-fill/60">
              <Icon icon={Download} size={20} />
              Download IT-1(a) file again
            </a>
          ) : null}
        </InsetSection>
      ) : null}

      {filing.state === "filed" ? (
        <InsetSection title="Filed">
          <InsetRow label="Filed on">
            <span className="tabular text-label">{formatDate(filing.filedOn ?? "")}</span>
          </InsetRow>
          <InsetRow label="Payment reference">
            <span className="break-all text-label">{filing.paymentReference}</span>
          </InsetRow>
          {filing.acknowledgementNumber ? (
            <InsetRow label="Acknowledgement">
              <span className="break-all text-label">{filing.acknowledgementNumber}</span>
            </InsetRow>
          ) : null}
          {filing.receipt ? (
            <a href={`/admin/payroll/${key}/filing/receipt`} target="_blank" rel="noopener" className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-body text-accent hover:bg-fill/60">
              <Icon icon={FileCheck2} size={20} />
              View receipt
            </a>
          ) : null}
        </InsetSection>
      ) : null}

      {filing.state !== "not_made" ? (
        <div className="flex justify-center">
          <MarkFiledSheet
            monthKey={key}
            monthName={name}
            today={today}
            current={
              filing.state === "filed"
                ? {
                    filedOn: filing.filedOn ?? today,
                    paymentReference: filing.paymentReference ?? "",
                    acknowledgementNumber: filing.acknowledgementNumber ?? "",
                    receiptName: filing.receipt?.filename ?? null,
                  }
                : undefined
            }
          />
        </div>
      ) : null}
    </Page>
  );
}
