"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { formatMonth } from "@/lib/format";
import type { PayslipListItem } from "@/modules/documents/repository";
import { PayslipSheet } from "./payslip-sheet";

type PayslipListProps = {
  payslips: PayslipListItem[];
  mode: "own" | "admin";
  personName?: string;
  initiallyOpen?: string;
  /** One section per year (a person's own payslips), or one titled section (an admin's lookup). */
  title?: string;
};

/** Payslips newest first, take-home on the right. Tap one for the breakdown and the PDF. */
export function PayslipList({ payslips, mode, personName, initiallyOpen, title }: PayslipListProps) {
  const [openId, setOpenId] = useState<string | null>(initiallyOpen && payslips.some((p) => p.id === initiallyOpen) ? initiallyOpen : null);
  const groups = title
    ? [{ title, items: payslips, withYear: true }]
    : [...new Set(payslips.map((payslip) => payslip.month.year))].map((year) => ({
        title: String(year),
        items: payslips.filter((payslip) => payslip.month.year === year),
        withYear: false,
      }));
  const open = payslips.find((payslip) => payslip.id === openId) ?? null;

  return (
    <>
      {groups.map((group) => (
        <InsetSection key={group.title} title={group.title}>
          <ul>
            {group.items.map((payslip) => (
              <li key={payslip.id} className="border-b border-separator/60 last:border-b-0">
                <button type="button" onClick={() => setOpenId(payslip.id)} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left active:bg-fill">
                  <span className="flex-1 text-body">{formatMonth(payslip.month, { withYear: group.withYear })}</span>
                  <Money amount={payslip.takeHome} className="text-body" />
                  <Icon icon={ChevronRight} size={18} className="shrink-0 text-label-secondary" />
                </button>
              </li>
            ))}
          </ul>
        </InsetSection>
      ))}
      <PayslipSheet payslip={open} onClose={() => setOpenId(null)} mode={mode} personName={personName} />
    </>
  );
}
