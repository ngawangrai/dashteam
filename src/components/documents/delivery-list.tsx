"use client";

import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { retryPayslipEmails } from "@/modules/documents/actions";
import type { DeliveryRow } from "@/modules/documents/repository";

const inProgress = (row: DeliveryRow) => (row.state === "not_made" || row.state === "queued" || row.state === "sending") && !row.stuck;
const needsYou = (row: DeliveryRow) => row.state === "failed" || row.stuck;

function headline(rows: DeliveryRow[]) {
  const sent = rows.filter((row) => row.state === "sent").length;
  const failed = rows.filter(needsYou).length;
  if (sent === rows.length) {
    return { icon: CircleCheck, className: "text-success", words: rows.length === 1 ? "Emailed to 1 person." : `Emailed to all ${rows.length} people.` };
  }
  if (failed) return { icon: CircleAlert, className: "text-danger", words: `${sent} of ${rows.length} emailed. ${failed === 1 ? "1 needs you." : `${failed} need you.`}` };
  return { icon: Clock, className: "text-label-secondary", words: `Making and sending payslips. ${sent} of ${rows.length} emailed.` };
}

function reason(row: DeliveryRow): string {
  if (row.state === "failed") return row.error ?? "It didn’t send.";
  return row.state === "not_made" ? "The payslip wasn’t made." : "The email is still waiting.";
}

/**
 * Whether everyone has their payslip: one line when they do, and only the people who need attention
 * when they don't, with Try again. Choosing anyone in the table below opens their payslip (see it or send it again).
 */
export function DeliveryList({ runId, rows }: { runId: string; rows: DeliveryRow[] }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const problems = rows.filter(needsYou);
  const onTheWay = rows.some(inProgress);
  const top = headline(rows);

  // Payslips are made and sent in the background just after locking: keep this current until
  // everything has landed (or stalled, which offers Try again). Stops after two minutes regardless.
  useEffect(() => {
    if (!onTheWay) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) clearInterval(timer);
      else router.refresh();
    }, 2_000);
    return () => clearInterval(timer);
  }, [onTheWay, router]);

  return (
    <InsetSection title="Payslips" footer="Choose anyone below to see their payslip or send it again.">
      <p className={`flex items-center gap-2 px-4 py-3 text-body ${problems.length ? "border-b border-separator/60" : ""}`} aria-live="polite">
        <Icon icon={top.icon} size={20} className={`shrink-0 ${top.className}`} />
        <span>{top.words}</span>
      </p>
      {problems.length ? (
        <>
          <ul aria-label="Payslips that need you">
            {problems.map((row) => (
              <li key={row.personId} className="flex flex-col border-b border-separator/60 px-4 py-2.5">
                <span className="text-body">{row.fullName}</span>
                <span className="text-secondary text-pretty text-label-secondary">{reason(row)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 text-secondary text-pretty text-label-secondary">Fix anything above, then try again. Nobody gets an email twice.</p>
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={retrying}
              aria-busy={retrying || undefined}
              onClick={() =>
                startRetry(async () => {
                  const result = await retryPayslipEmails(runId);
                  toast(result.message);
                  router.refresh();
                })
              }
            >
              {retrying ? "Sending…" : "Try again"}
            </Button>
          </div>
        </>
      ) : null}
    </InsetSection>
  );
}
