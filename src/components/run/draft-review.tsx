"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/field";
import { Money } from "@/components/money";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatNu } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import { removeLine } from "@/modules/run/actions";
import type { PersonRun, RunTotals } from "@/modules/run/build";
import { LINE_KIND_NAME, type RunLine } from "@/modules/run/lines";
import { LineForm } from "./line-form";
import { PayBreakdown } from "./pay-breakdown";
import { type ReviewRow, ReviewList } from "./review-list";

function rowFor(person: PersonRun): ReviewRow {
  return {
    personId: person.personId,
    fullName: person.fullName,
    detail: person.employmentType ? EMPLOYMENT_TYPE_LABEL[person.employmentType] : "No pay set",
    gross: person.result?.gross ?? null,
    deductions: person.result ? person.deductions : null,
    takeHome: person.result?.takeHome ?? null,
    exceptions: person.exceptions,
    problem: !person.terms ? "Add their pay" : person.problem ? "Can’t be worked out" : null,
  };
}

/** Removes a one-off from the draft, with Undo in the toast. */
function RemoveLine({ line, onDone }: { line: RunLine; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Button
      variant="plain"
      className="-mr-3 shrink-0 text-danger"
      disabled={pending}
      aria-busy={pending || undefined}
      title={error ?? undefined}
      aria-label={`Remove ${LINE_KIND_NAME[line.kind].toLowerCase()} of ${formatNu(line.amount)}`}
      onClick={() =>
        startTransition(async () => {
          const result = await removeLine(line.id);
          if (result.status === "done") {
            onDone();
            confirmWithUndo(result, router);
            router.refresh();
          } else if (result.status === "error") {
            setError(result.message);
            toast(result.message);
          }
        })
      }
    >
      Remove
    </Button>
  );
}

function PersonDetail({ person, monthKey, monthName, onDone }: { person: PersonRun; monthKey: string; monthName: string; onDone: () => void }) {
  if (!person.terms) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-pretty">
          {person.firstName} has no pay for {monthName}, so their pay can’t be worked out. Add it on their page, then come back.
        </p>
        <Link href={`/admin/people/${person.personId}/pay`} className="inline-flex min-h-11 w-fit items-center text-body text-accent">
          Add {person.firstName}’s pay
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {person.result ? (
        <div className="flex flex-col gap-1">
          <span className="text-secondary text-label-secondary">Take-home</span>
          <Money amount={person.result.takeHome} className="text-large-title" />
        </div>
      ) : (
        <FormMessage message={person.problem} />
      )}
      {person.result && person.employmentType ? (
        <PayBreakdown result={person.result} lines={person.lines} employmentType={person.employmentType} lineAction={(line) => <RemoveLine line={line} onDone={onDone} />} />
      ) : null}
      <section className="flex flex-col gap-3">
        <h3 className="text-body font-semibold">Add a one-off</h3>
        <LineForm monthKey={monthKey} person={person} onDone={onDone} />
      </section>
    </div>
  );
}

/** The draft month: everyone in one list, and their breakdown and one-offs a tap away. */
export function DraftReview({ people, totals, monthKey, monthName }: { people: PersonRun[]; totals: RunTotals; monthKey: string; monthName: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = people.find((person) => person.personId === openId) ?? null;
  return (
    <>
      <ReviewList rows={people.map(rowFor)} totals={totals} onOpen={setOpenId} label={`${monthName} payroll`} />
      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open?.fullName ?? ""}>
        {open ? <PersonDetail key={open.personId} person={open} monthKey={monthKey} monthName={monthName} onDone={() => setOpenId(null)} /> : null}
      </Sheet>
    </>
  );
}
