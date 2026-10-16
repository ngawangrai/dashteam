"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { formatDate, formatMonth, thimphuToday } from "@/lib/format";
import { removePayrollImport, restorePayrollImport } from "@/modules/import/actions";
import type { ImportView } from "@/modules/import/repository";

const span = (months: ImportView["months"]) => {
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return "";
  return months.length === 1 ? formatMonth(first, { withYear: true }) : `${formatMonth(first, { withYear: true })} to ${formatMonth(last, { withYear: true })}`;
};

function ImportRow({ item, canRemove }: { item: ImportView; canRemove: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function remove() {
    start(async () => {
      const result = await removePayrollImport(item.id);
      if (result.status === "error") {
        toast(result.message);
        return;
      }
      toast(result.message, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            const restored = await restorePayrollImport(item.id);
            toast(restored.status === "done" ? "Undone." : restored.message);
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  }

  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-separator/60 px-4 py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body">{span(item.months)}</span>
        <span className="truncate text-secondary text-label-secondary">
          {item.months.length === 1 ? "1 month" : `${item.months.length} months`} · {item.filename} · brought in {formatDate(thimphuToday(item.importedAt))}
        </span>
      </span>
      <Money amount={item.takeHome} className="text-body text-label-secondary" />
      {canRemove ? (
        <Button variant="plain" className="px-2 text-danger" disabled={pending} aria-busy={pending || undefined} onClick={remove} aria-label={`Take out ${span(item.months)}`}>
          Take out
        </Button>
      ) : null}
    </li>
  );
}

/** Imports already brought in. They can be taken out until a month is locked in DashTeam. */
export function ImportList({ imports, canRemove }: { imports: ImportView[]; canRemove: boolean }) {
  if (!imports.length) return null;
  return (
    <InsetSection
      title="Brought in"
      footer={canRemove ? "You can take these out and bring in a corrected file until you lock your first month in DashTeam." : "These months are permanent now that a month is locked in DashTeam."}
    >
      <ul aria-label="Imports">
        {imports.map((item) => (
          <ImportRow key={item.id} item={item} canRemove={canRemove} />
        ))}
      </ul>
    </InsetSection>
  );
}
