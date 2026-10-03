"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/button";
import { FormMessage, TextField } from "@/components/field";
import { SegmentedControl } from "@/components/segmented-control";
import { Sheet } from "@/components/sheet";
import { confirmWithUndo } from "@/components/undo-toast";
import { formatSpan } from "@/lib/format";
import { type HolidayChange, type HolidayPreview, previewHolidayChange, saveHolidayChange } from "@/modules/leave/holiday-actions";
import type { Holiday } from "@/modules/leave/holidays";
import { ImpactList } from "./impact-list";

type Ready = Extract<HolidayPreview, { status: "ready" }>;

/**
 * Preview, then save: every holiday change first works out whose leave it affects. If no one's does,
 * it saves straight away; otherwise the admin sees the list and confirms.
 */
function useHolidayChange(onDone: () => void) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [impact, setImpact] = useState<{ change: HolidayChange; preview: Ready } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function save(change: HolidayChange, preview: Ready) {
    startTransition(async () => {
      const result = await saveHolidayChange(change, preview.fingerprint);
      if (result.status === "done") {
        setImpact(null);
        onDone();
        confirmWithUndo(result, router);
        router.refresh();
      } else if (result.status === "changed" && result.preview.status === "ready") {
        setImpact({ change, preview: result.preview });
        setError("Someone’s leave changed while you were looking. Check the list again.");
      } else if (result.status === "error") {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        setImpact(null);
      }
    });
  }

  function run(change: HolidayChange, options: { alwaysReview?: boolean } = {}) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const preview = await previewHolidayChange(change);
      if (preview.status === "error") {
        setError(preview.message);
        setFieldErrors(preview.fieldErrors ?? {});
        return;
      }
      if (preview.changes.length || options.alwaysReview) setImpact({ change, preview });
      else save(change, preview);
    });
  }

  return { run, save, pending, impact, setImpact, error, fieldErrors };
}

type HolidaySheetProps = {
  open: boolean;
  onClose: () => void;
  year: number;
  holiday?: Holiday & { id: string };
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu" }).format(new Date());

export function HolidaySheet({ open, onClose, year, holiday }: HolidaySheetProps) {
  const editing = Boolean(holiday);
  const initialDate = today().startsWith(String(year)) ? today() : `${year}-01-01`;
  const [values, setValues] = useState({
    name: holiday?.name ?? "",
    startDate: holiday?.startDate ?? initialDate,
    endDate: holiday?.endDate ?? initialDate,
    kind: holiday?.kind ?? ("one_off" as Holiday["kind"]),
    scope: holiday?.scope ?? ("national" as Holiday["scope"]),
    status: holiday?.status ?? ("confirmed" as Holiday["status"]),
    source: holiday?.source ?? "",
    note: holiday?.note ?? "",
  });
  const flow = useHolidayChange(onClose);
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));

  const change: HolidayChange = holiday ? { mode: "edit", id: holiday.id, values } : { mode: "add", values };
  const reviewing = flow.impact;

  return (
    <Sheet open={open} onClose={onClose} title={reviewing ? "Check the leave this changes" : editing ? "Edit holiday" : "Add a holiday"}>
      {reviewing ? (
        <div key="impact" className="reveal flex flex-col gap-4">
          <p className="text-body text-pretty text-label-secondary">
            {reviewing.preview.changes.length === 1 ? "1 leave request" : `${reviewing.preview.changes.length} leave requests`} will be counted differently.
            Each person gets a note on their Leave tab.
          </p>
          <ImpactList changes={reviewing.preview.changes} />
          <FormMessage message={flow.error} />
          <div className="flex flex-col gap-2">
            <Button fullWidth disabled={flow.pending} aria-busy={flow.pending || undefined} onClick={() => flow.save(reviewing.change, reviewing.preview)}>
              {reviewing.change.mode === "remove"
                ? `Remove and update ${reviewing.preview.changes.length === 1 ? "1 request" : `${reviewing.preview.changes.length} requests`}`
                : `Save and update ${reviewing.preview.changes.length === 1 ? "1 request" : `${reviewing.preview.changes.length} requests`}`}
            </Button>
            <Button variant="plain" fullWidth onClick={() => flow.setImpact(null)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <form
          key="form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            flow.run(change);
          }}
        >
          {holiday?.status === "tentative" ? (
            // The most common edit once the official list is out: one tap, at the top.
            <div className="flex flex-col gap-2 rounded-control bg-fill p-3">
              <p className="text-secondary text-pretty">This date is tentative. If the official list has it, confirm it.</p>
              <Button variant="secondary" disabled={flow.pending} onClick={() => flow.run({ mode: "confirm", id: holiday.id })}>
                Mark as confirmed
              </Button>
            </div>
          ) : null}
          <TextField name="name" label="Name" autoComplete="off" value={values.name} onChange={(e) => set({ name: e.target.value })} error={flow.fieldErrors.name} required />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              name="startDate"
              label="First day"
              type="date"
              value={values.startDate}
              onChange={(e) => set({ startDate: e.target.value, endDate: values.endDate < e.target.value || values.endDate === values.startDate ? e.target.value : values.endDate })}
              error={flow.fieldErrors.startDate}
              required
            />
            <TextField name="endDate" label="Last day" type="date" min={values.startDate} value={values.endDate} onChange={(e) => set({ endDate: e.target.value })} error={flow.fieldErrors.endDate} required />
          </div>
          {values.startDate && values.endDate >= values.startDate ? (
            <p className="-mt-2 text-secondary text-label-secondary tabular">{formatSpan(values.startDate, values.endDate)}</p>
          ) : null}
          <SegmentedControl
            name="kind"
            label="Type"
            options={[
              { value: "fixed", label: "Fixed date" },
              { value: "lunar", label: "Lunar" },
              { value: "one_off", label: "One-off" },
            ]}
            value={values.kind}
            onChange={(kind) => set({ kind })}
          />
          <SegmentedControl
            name="scope"
            label="Where"
            options={[
              { value: "national", label: "National" },
              { value: "thimphu", label: "Thimphu" },
            ]}
            value={values.scope}
            onChange={(scope) => set({ scope })}
          />
          <SegmentedControl
            name="status"
            label="Status"
            options={[
              { value: "confirmed", label: "Confirmed" },
              { value: "tentative", label: "Tentative" },
            ]}
            value={values.status}
            onChange={(status) => set({ status })}
          />
          <TextField
            name="source"
            label="Source"
            placeholder="Link to the official list, or who declared it"
            autoComplete="off"
            value={values.source}
            onChange={(e) => set({ source: e.target.value })}
            error={flow.fieldErrors.source}
            required
          />
          <TextField name="note" label="Note (optional)" autoComplete="off" value={values.note} onChange={(e) => set({ note: e.target.value })} />
          <FormMessage message={Object.keys(flow.fieldErrors).length ? null : flow.error} />
          <Button type="submit" fullWidth disabled={flow.pending} aria-busy={flow.pending || undefined}>
            {flow.pending ? "Checking leave…" : editing ? "Save changes" : "Add holiday"}
          </Button>
          {holiday ? (
            <div className="flex flex-col gap-1">
              <Button variant="plain" fullWidth className="text-danger" disabled={flow.pending} onClick={() => flow.run({ mode: "remove", id: holiday.id })}>
                Remove holiday
              </Button>
            </div>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}

/** Copies the year's fixed-date holidays to the next year, as tentative, after showing what it will do. */
export function CopyForward({ fromYear }: { fromYear: number }) {
  const toYear = fromYear + 1;
  const [open, setOpen] = useState(false);
  const flow = useHolidayChange(() => setOpen(false));
  const preview = flow.impact?.preview;
  const copies = preview?.copies ?? [];

  return (
    <>
      <Button
        variant="plain"
        onClick={() => {
          setOpen(true);
          flow.run({ mode: "copy", fromYear, toYear }, { alwaysReview: true });
        }}
      >
        Copy fixed dates to {toYear}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Copy fixed dates to ${toYear}`}>
        {!preview ? (
          <p className="text-body text-label-secondary">{flow.error ?? "Checking what to copy…"}</p>
        ) : (
          <div className="reveal flex flex-col gap-4">
            {copies.length ? (
              <>
                <p className="text-body text-pretty text-label-secondary">
                  These are copied as tentative. Confirm them when the Ministry publishes the {toYear} list. Lunar and one-off holidays are never copied.
                </p>
                <ul className="-mx-4 flex flex-col">
                  {copies.map((copy) => (
                    <li key={copy.name} className="flex items-center justify-between gap-3 border-b border-separator/60 px-4 py-2.5 last:border-b-0">
                      <span className="min-w-0 text-body">{copy.name}</span>
                      <span className="shrink-0 text-secondary text-label-secondary tabular">{formatSpan(copy.startDate, copy.endDate)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-body text-label-secondary">Nothing to copy: every fixed-date holiday is already in {toYear}.</p>
            )}
            {preview.changes.length ? (
              <>
                <h3 className="text-body font-semibold">Leave this changes</h3>
                <ImpactList changes={preview.changes} />
              </>
            ) : null}
            <FormMessage message={flow.error} />
            {copies.length && flow.impact ? (
              <Button
                fullWidth
                disabled={flow.pending}
                aria-busy={flow.pending || undefined}
                onClick={() => flow.impact && flow.save(flow.impact.change, flow.impact.preview)}
              >
                {copies.length === 1 ? `Copy 1 fixed holiday to ${toYear}` : `Copy ${copies.length} fixed holidays to ${toYear}`}
              </Button>
            ) : null}
          </div>
        )}
      </Sheet>
    </>
  );
}
