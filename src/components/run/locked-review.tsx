"use client";

import { useState } from "react";
import { Money } from "@/components/money";
import { Sheet } from "@/components/sheet";
import { maskedLast4 } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import type { LockedPersonView } from "@/modules/run/repository";
import { PayBreakdown } from "./pay-breakdown";
import { ReviewList } from "./review-list";

/** A locked month, read from its snapshot: the same list, and each breakdown exactly as it was locked. */
export function LockedReview({ people, totals, monthName }: { people: LockedPersonView[]; totals: { gross: number; takeHome: number }; monthName: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = people.find((person) => person.personId === openId) ?? null;
  return (
    <>
      <ReviewList
        rows={people.map((person) => ({
          personId: person.personId,
          fullName: person.fullName,
          detail: EMPLOYMENT_TYPE_LABEL[person.employmentType],
          gross: person.result.gross,
          deductions: person.deductions,
          takeHome: person.result.takeHome,
          exceptions: [],
          problem: null,
        }))}
        totals={totals}
        onOpen={setOpenId}
        label={`${monthName} payroll, locked`}
      />
      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.fullName ?? ""}>
        {open ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-secondary text-label-secondary">Take-home</span>
              <Money amount={open.result.takeHome} className="text-large-title" />
            </div>
            <PayBreakdown result={open.result} lines={open.lines} employmentType={open.employmentType} />
            <p className="text-secondary text-pretty text-label-secondary">
              Paid to {open.bankName ?? "no bank on file"}
              {open.bankAccountLast4 ? ` ${maskedLast4(open.bankAccountLast4)}` : ""}. {monthName} is locked, so this can’t change.
            </p>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
