"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/field";
import { Icon } from "@/components/icon";
import { Money } from "@/components/money";
import { Sheet } from "@/components/sheet";
import { formatNu } from "@/lib/format";
import { emailMyPayslip, payslipLink, resendPayslip } from "@/modules/documents/actions";
import type { PayslipModel } from "@/modules/documents/model";
import type { PayslipListItem } from "@/modules/documents/repository";

// One payslip: take-home first, the breakdown below, then the PDF. The PDF opens through a link that
// works for a minute; it's fetched as the sheet opens, so Download is a real link the phone opens at once.

const LINK_FRESH_MS = 45_000;

function Rows({ title, rows, total, totalLabel }: { title: string; rows: PayslipModel["earnings"]; total: number; totalLabel: string }) {
  return (
    <section className="flex flex-col">
      <h3 className="text-secondary font-semibold text-label-secondary">{title}</h3>
      <dl>
        {rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-separator/60 py-2">
            <dt className="flex min-w-0 flex-col">
              <span>{row.label}</span>
              {row.detail ? <span className="text-secondary text-label-secondary">{row.detail}</span> : null}
            </dt>
            <dd className="tabular whitespace-nowrap text-label-secondary">{formatNu(row.amount)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 py-2 font-semibold">
          <dt>{totalLabel}</dt>
          <dd className="tabular whitespace-nowrap">{formatNu(total)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** What the payslip says, the same model the PDF was printed from. */
export function PayslipBreakdown({ model }: { model: PayslipModel }) {
  return (
    <div className="flex flex-col gap-4">
      <Rows title="Earnings" rows={model.earnings} total={model.gross} totalLabel="Gross pay" />
      <Rows title="Deductions" rows={model.deductions} total={model.totalDeductions} totalLabel="Total deductions" />
    </div>
  );
}

function usePayslipLink(payslipId: string | null) {
  const [link, setLink] = useState<{ url: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  const fetchLink = useCallback(async (id: string) => {
    const result = await payslipLink(id);
    if (result.status === "ready") {
      setLink({ url: result.url, at: Date.now() });
      setError(null);
      return result.url;
    }
    setError(result.message);
    return null;
  }, []);

  useEffect(() => {
    if (!payslipId || requested.current === payslipId) return;
    requested.current = payslipId;
    setLink(null);
    void fetchLink(payslipId);
  }, [payslipId, fetchLink]);

  return { link, error, fetchLink };
}

type PayslipSheetProps = {
  payslip: PayslipListItem | null;
  onClose: () => void;
  /** Whose payslip it is: the signed-in person's own, or someone an admin is looking up. */
  mode: "own" | "admin";
  personName?: string;
};

export function PayslipSheet({ payslip, onClose, mode, personName }: PayslipSheetProps) {
  const { link, error, fetchLink } = usePayslipLink(payslip?.id ?? null);
  const [sending, startSending] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const model = payslip?.content;

  function send() {
    if (!payslip) return;
    setSendError(null);
    const tap = crypto.randomUUID();
    startSending(async () => {
      const result = mode === "own" ? await emailMyPayslip(payslip.id, tap) : await resendPayslip(payslip.id, tap);
      if (result.status === "done") {
        // Close first: the sheet is modal, and the toast should be readable.
        onClose();
        toast(result.message);
      } else setSendError(result.message);
    });
  }

  return (
    <Sheet open={payslip !== null} onClose={onClose} title={model ? (personName ? `${model.monthName}, ${personName}` : model.monthName) : ""}>
      {model && payslip ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-secondary text-label-secondary">Take-home</span>
            <Money amount={model.takeHome} className="text-large-title" />
          </div>
          <PayslipBreakdown model={model} />
          <p className="text-caption text-label-secondary">
            {model.reference} · Issued {model.issuedOn}
          </p>
          <div className="flex flex-col gap-2">
            <a
              href={link?.url ?? "#"}
              target="_blank"
              rel="noopener"
              aria-disabled={!link || undefined}
              onClick={async (event) => {
                // A link older than ~45 seconds may have expired: get a fresh one first.
                if (link && Date.now() - link.at < LINK_FRESH_MS) return;
                event.preventDefault();
                const url = await fetchLink(payslip.id);
                if (url) window.location.assign(url);
              }}
              className="pressable inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent-fill px-4 text-body font-semibold text-on-accent aria-disabled:opacity-70"
            >
              <Icon icon={Download} size={20} />
              Download PDF
            </a>
            <Button variant="plain" fullWidth disabled={sending} aria-busy={sending || undefined} onClick={send}>
              {sending ? "Sending…" : mode === "own" ? "Email it to me" : "Send it again"}
            </Button>
          </div>
          <FormMessage message={error ?? sendError} />
        </div>
      ) : null}
    </Sheet>
  );
}
