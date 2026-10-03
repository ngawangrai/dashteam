"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/button";
import { FormMessage, MoneyField } from "@/components/field";
import { InsetRow, InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDays, formatNu } from "@/lib/format";
import { type LeaveActionState, settleExitLeave } from "@/modules/leave/actions";
import type { ExitSettlement } from "@/modules/leave/exit";
import { LEAVE_TYPE_NAME } from "@/modules/leave/labels";

type ExitSettlementProps = {
  personId: string;
  firstName: string;
  settlement: ExitSettlement;
  decided: { status: "accepted" | "changed" | "waived"; finalCh: number | null } | null;
};

/** Leave at exit: days taken beyond the entitlement, the suggested recovery with its working, and unused days. */
export function ExitLeaveSettlement({ personId, firstName, settlement, decided }: ExitSettlementProps) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [amount, setAmount] = useState("");
  const [state, action, pending] = useActionState<LeaveActionState, FormData>(async (previous, formData) => {
    const result = await settleExitLeave(personId, previous, formData);
    if (result.status === "done") {
      confirmWithUndo(result, router);
      router.refresh();
    }
    return result;
  }, { status: "idle" });

  const over = settlement.types.filter((type) => type.over > 0);
  const footer =
    settlement.payout === null
      ? `${formatDays(settlement.unusedAnnualDays)} of annual leave unused. Unused leave isn’t paid out.`
      : `${formatDays(settlement.unusedAnnualDays)} of annual leave unused, paid out as ${formatNu(settlement.payout)}.`;

  return (
    <InsetSection title="Leave at exit" footer={footer}>
      {settlement.types.map((type) => (
        <InsetRow key={type.leaveType} label={LEAVE_TYPE_NAME[type.leaveType]}>
          <span className="tabular">
            {formatDays(type.used)} taken of {type.entitlement}
            {type.over ? <span className="font-semibold text-label"> · {formatDays(type.over)} over</span> : null}
          </span>
        </InsetRow>
      ))}

      {settlement.daysOver > 0 ? (
        <div className="flex flex-col gap-3 border-t border-separator/60 p-4">
          <p className="text-body tabular">
            Suggested recovery: {formatDays(settlement.daysOver)} × {formatNu(settlement.dailyRate)} ={" "}
            <Money amount={settlement.suggested} className="font-semibold" />
          </p>
          <p className="text-secondary text-pretty text-label-secondary">
            {overSentence(over.map((type) => LEAVE_TYPE_NAME[type.leaveType]), firstName)} The daily rate is their monthly pay divided by the days in
            their last month.
          </p>

          {decided ? (
            <p className="text-body font-semibold">
              {decided.status === "waived" ? "Recovery waived." : <>Recovery of <Money amount={decided.finalCh ?? 0} /> goes into the final payroll.</>}
            </p>
          ) : (
            <form action={action} className="flex flex-col gap-3" noValidate>
              {changing ? (
                <>
                  <input type="hidden" name="decision" value="changed" />
                  <MoneyField name="amount" label="Amount to recover (Nu.)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </>
              ) : null}
              <FormMessage message={state.status === "error" ? state.message : null} />
              <div className="flex flex-wrap justify-end gap-2">
                {changing ? (
                  <>
                    <Button variant="plain" onClick={() => setChanging(false)}>
                      Back
                    </Button>
                    <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
                      Save this amount
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="submit" name="decision" value="waived" variant="plain" disabled={pending}>
                      Waive
                    </Button>
                    <Button variant="secondary" disabled={pending} onClick={() => setChanging(true)}>
                      Change amount
                    </Button>
                    <Button type="submit" name="decision" value="accepted" disabled={pending} aria-busy={pending || undefined}>
                      Accept suggestion
                    </Button>
                  </>
                )}
              </div>
            </form>
          )}
        </div>
      ) : null}
    </InsetSection>
  );
}

function overSentence(names: string[], firstName: string): string {
  const list = names.map((name, i) => (i === 0 ? name : name.toLowerCase())).join(" and ");
  return `${list} taken beyond what ${firstName} earned for the months worked.`;
}
