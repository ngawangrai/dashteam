"use client";

import { CircleAlert, FileUp, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/field";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";
import { Money } from "@/components/money";
import { formatMonth } from "@/lib/format";
import { type ImportCheckState, checkPayrollFile, importPayrollFile, removePayrollImport } from "@/modules/import/actions";
import type { ImportProblem } from "@/modules/import/payroll-csv";

// Bringing in past months: choose the file and it's checked straight away. The preview lists every
// problem by row; nothing comes in until there are none. Then one button brings in the whole file.

const where = (problem: ImportProblem) => (problem.line ? `Row ${problem.line}: ` : "");

function Problems({ title, problems, tone }: { title: string; problems: ImportProblem[]; tone: "danger" | "warning" }) {
  return (
    <InsetSection title={title}>
      <ul aria-label={title}>
        {problems.map((problem, i) => (
          <li key={`${problem.line}-${i}`} className="flex items-start gap-2 border-b border-separator/60 px-4 py-2.5 last:border-b-0">
            <Icon icon={tone === "danger" ? CircleAlert : TriangleAlert} size={18} className={`mt-0.5 shrink-0 ${tone === "danger" ? "text-danger" : "text-warning"}`} />
            <span className="text-secondary text-pretty">
              <span className="font-semibold">{where(problem)}</span>
              {problem.message}
            </span>
          </li>
        ))}
      </ul>
    </InsetSection>
  );
}

export function ImportPanel() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, checkAction, checking] = useActionState<ImportCheckState, FormData>(checkPayrollFile, { status: "idle" });
  const [importing, startImport] = useTransition();
  const [importError, setImportError] = useState<string | null>(null);
  const [override, setOverride] = useState<ImportCheckState | null>(null);
  const shown = override ?? state;

  function reset() {
    setFile(null);
    setOverride({ status: "idle" });
    setImportError(null);
    if (input.current) input.current.value = "";
  }

  function bringIn() {
    if (!file) return;
    setImportError(null);
    startImport(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await importPayrollFile(formData);
      if (result.status === "done") {
        reset();
        toast(result.message, {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: async () => {
              const undone = await removePayrollImport(result.importId);
              toast(undone.status === "done" ? "Undone." : undone.message);
              router.refresh();
            },
          },
        });
        router.refresh();
      } else {
        setImportError(result.message);
        if (result.check) setOverride(result.check);
      }
    });
  }

  const checked = shown.status === "checked" ? shown : null;
  const ready = checked !== null && checked.errors.length === 0 && checked.rows > 0;
  const months = checked?.months ?? [];

  return (
    <div className="flex flex-col gap-6">
      <form ref={form} action={checkAction} className="sr-only" aria-hidden="true">
        <input
          ref={input}
          type="file"
          name="file"
          accept=".csv,text/csv"
          tabIndex={-1}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            setOverride(null);
            setImportError(null);
            if (chosen) form.current?.requestSubmit();
          }}
        />
      </form>

      {!checked ? (
        <InsetSection footer="Each person’s payslips for these months appear in DashTeam, marked as imported. Nobody is emailed.">
          <ol className="flex list-decimal flex-col gap-2 py-4 pr-4 pl-9 text-body">
            <li>
              Download the{" "}
              <a href="/admin/payroll/import/template" download className="text-accent">
                template
              </a>
              .
            </li>
            <li>Fill in one row per person for each month, with the figures as they were paid.</li>
            <li>Choose the file. It’s checked before anything is saved.</li>
          </ol>
        </InsetSection>
      ) : null}

      {checked ? (
        <>
          <p className="px-4 text-body">
            <span className="font-semibold">{checked.filename}</span>
            <span className="text-label-secondary">
              {" "}
              · {checked.rows === 1 ? "1 row" : `${checked.rows} rows`}
            </span>
          </p>
          {checked.errors.length ? <Problems title={checked.errors.length === 1 ? "1 thing to fix first" : `${checked.errors.length} things to fix first`} problems={checked.errors} tone="danger" /> : null}
          {months.length ? (
            <InsetSection title="What comes in" footer="Figures are kept exactly as they are in the file.">
              <ul aria-label="Months in the file">
                {months.map((month) => (
                  <li key={month.monthKey} className="flex min-h-11 items-center gap-3 border-b border-separator/60 px-4 py-2 last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body">{formatMonth(month.month, { withYear: true })}</span>
                      <span className="text-secondary text-label-secondary">
                        {month.people === 1 ? "1 person" : `${month.people} people`} · TDS <Money amount={month.tds} />
                      </span>
                    </span>
                    <Money amount={month.takeHome} className="text-body" />
                  </li>
                ))}
              </ul>
            </InsetSection>
          ) : null}
          {checked.warnings.length ? <Problems title="Worth a look" problems={checked.warnings} tone="warning" /> : null}
        </>
      ) : null}

      {shown.status === "error" ? <FormMessage message={shown.message} /> : null}
      <FormMessage message={importError} />

      <div className="flex flex-col gap-2">
        {ready ? (
          <Button fullWidth disabled={importing} aria-busy={importing || undefined} onClick={bringIn}>
            {importing ? "Bringing them in…" : months.length === 1 ? "Bring in 1 month" : `Bring in ${months.length} months`}
          </Button>
        ) : (
          <Button
            fullWidth
            disabled={checking}
            aria-busy={checking || undefined}
            onClick={() => {
              // Cleared first, so choosing the same file again (once fixed) still checks it.
              if (input.current) input.current.value = "";
              input.current?.click();
            }}
          >
            <Icon icon={FileUp} size={20} />
            {checking ? "Checking…" : checked ? "Choose the fixed file" : "Choose CSV file"}
          </Button>
        )}
        {checked ? (
          <Button variant="plain" fullWidth disabled={importing} onClick={reset}>
            {ready ? "Choose another file" : "Start again"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
