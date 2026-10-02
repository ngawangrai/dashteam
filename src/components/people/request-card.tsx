"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatDate, formatPhone, maskedLast4, thimphuToday } from "@/lib/format";
import { decideRequest } from "@/modules/people/actions";
import type { PendingRequestView } from "@/modules/people/repository";

const bankText = (bank: { name: string | null; last4: string | null }) =>
  [bank.name ?? "No bank", bank.last4 ? maskedLast4(bank.last4) : null].filter(Boolean).join(" ");

/** One request to change contact or bank details, with what changes, and Approve as the one primary action. */
export function RequestCard({ request, showName = true }: { request: PendingRequestView; showName?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"approved" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  function decide(decision: "approved" | "declined") {
    setChoice(decision);
    startTransition(async () => {
      const result = await decideRequest(request.id, decision);
      if (result.status === "done") {
        setError(null);
        // Fade out before the list refreshes, so the card doesn't vanish in a single frame.
        setLeaving(true);
        confirmWithUndo(result, router);
        router.refresh();
      } else if (result.status === "error") {
        setError(result.message);
      }
      setChoice(null);
    });
  }

  return (
    <article
      className={`flex flex-col gap-3 border-b border-separator/60 p-4 transition-opacity duration-200 ease-(--ease-out) last:border-b-0 ${leaving ? "opacity-0" : ""}`}
      aria-busy={pending || undefined}
    >
      <header className="flex items-baseline justify-between gap-3">
        {showName ? (
          <Link href={`/admin/people/${request.personId}`} className="truncate text-body font-semibold">
            {request.personName}
          </Link>
        ) : (
          <span className="text-body font-semibold">Change requested</span>
        )}
        <span className="shrink-0 text-secondary text-label-secondary tabular">{formatDate(thimphuToday(request.createdAt))}</span>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
        {request.phone ? (
          <>
            <dt className="text-label-secondary">Phone</dt>
            <dd className="tabular">
              {request.phone.from ? formatPhone(request.phone.from) : "None"} → <span className="font-semibold">{formatPhone(request.phone.to)}</span>
            </dd>
          </>
        ) : null}
        {request.bank ? (
          <>
            <dt className="text-label-secondary">Bank</dt>
            <dd className="tabular">
              {bankText(request.bank.from)} → <span className="font-semibold">{bankText(request.bank.to)}</span>
            </dd>
          </>
        ) : null}
      </dl>
      {error ? (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={pending} aria-busy={choice === "declined" || undefined} onClick={() => decide("declined")}>
          Decline
        </Button>
        <Button disabled={pending} aria-busy={choice === "approved" || undefined} onClick={() => decide("approved")}>
          Approve
        </Button>
      </div>
    </article>
  );
}
