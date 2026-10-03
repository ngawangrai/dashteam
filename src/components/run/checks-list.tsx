"use client";

import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { confirmWithUndo } from "@/components/undo-toast";
import { acknowledgeCheck } from "@/modules/run/actions";
import type { RunCheck } from "@/modules/run/checks";

const PERSON_PAGE_CHECKS = /^(no_pay|problem|missing_tpn|missing_bank):/;

function CheckRow({ check, monthKey }: { check: RunCheck; monthKey: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = check.kind === "acknowledge" && check.acknowledged;
  const look = check.kind === "must_clear" ? { icon: CircleAlert, className: "text-danger", status: "Needs sorting first" } : done ? { icon: CircleCheck, className: "text-success", status: "Acknowledged" } : { icon: CircleHelp, className: "text-warning", status: "Look at this" };

  return (
    // Phones: the action sits under the words, so they get the full width. Wider: beside them.
    <li className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 border-b border-separator/60 p-4 last:border-b-0 sm:grid-cols-[auto_1fr_auto]" aria-busy={pending || undefined}>
      <Icon icon={look.icon} size={20} className={`mt-0.5 shrink-0 ${look.className}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">{look.status}: </span>
        <p className={`text-body text-pretty ${done ? "text-label-secondary" : ""}`}>{check.title}</p>
        {!done ? <p className="text-secondary text-pretty text-label-secondary">{check.detail}</p> : null}
        {check.personId && PERSON_PAGE_CHECKS.test(check.key) && !done ? (
          <Link href={`/admin/people/${check.personId}`} className="-my-3 w-fit py-3 text-secondary text-accent">
            Open their page
          </Link>
        ) : null}
        {error ? <p className="text-secondary text-danger">{error}</p> : null}
      </div>
      {check.kind === "acknowledge" && !done ? (
        <Button
          variant="secondary"
          className="col-start-2 justify-self-start sm:col-start-3 sm:self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await acknowledgeCheck(monthKey, check.key);
              if (result.status === "done") {
                confirmWithUndo(result, router);
                router.refresh();
              } else if (result.status === "error") setError(result.message);
            })
          }
        >
          Acknowledge
        </Button>
      ) : done ? (
        <span className="col-start-2 text-secondary text-label-secondary sm:col-start-3 sm:self-start">Acknowledged</span>
      ) : null}
    </li>
  );
}

/** What to look at before locking: things to sort out first, then things to acknowledge. */
export function ChecksList({ checks, monthKey }: { checks: RunCheck[]; monthKey: string }) {
  if (!checks.length) return null;
  const open = checks.filter((check) => !(check.kind === "acknowledge" && check.acknowledged)).length;
  return (
    <InsetSection
      title="Before you lock"
      footer={open ? (open === 1 ? "1 thing to look at." : `${open} things to look at.`) : "All looked at. You can lock this month."}
    >
      <ul>
        {checks.map((check) => (
          <CheckRow key={check.key} check={check} monthKey={monthKey} />
        ))}
      </ul>
    </InsetSection>
  );
}
