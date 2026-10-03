import type { ReactNode } from "react";
import { formatNu } from "@/lib/format";
import type { PayResult } from "@/modules/payroll";
import type { EmploymentType } from "@/modules/rules/types";
import { LINE_GROUP, LINE_KIND_NAME, type RunLine } from "@/modules/run/lines";

type Row = { label: string; detail?: string; amount: number; sign: "" | "+" | "−"; strong?: boolean; line?: RunLine };

type PayBreakdownProps = {
  result: PayResult;
  lines: RunLine[];
  employmentType: EmploymentType;
  /** Shown beside each one-off line, for example to remove it from a draft. */
  lineAction?: (line: RunLine) => ReactNode;
};

/** How gross becomes take-home, in the calculation's own order, with one-off lines where they apply. */
export function PayBreakdown({ result, lines, employmentType, lineAction }: PayBreakdownProps) {
  const partMonth = result.daysPaid < result.daysInMonth;
  const lineRow = (line: RunLine, sign: Row["sign"]): Row => ({ label: LINE_KIND_NAME[line.kind], detail: line.note || undefined, amount: line.amount, sign, line });
  const rows: Row[] = [
    {
      label: employmentType === "intern" ? "Stipend" : "Basic and allowances",
      detail: partMonth ? `${result.daysPaid} of ${result.daysInMonth} days` : undefined,
      amount: result.regularPayDue,
      sign: "",
    },
    ...lines.filter((line) => LINE_GROUP[line.kind] === "earning").map((line) => lineRow(line, "+")),
    ...lines.filter((line) => LINE_GROUP[line.kind] === "before_tax").map((line) => lineRow(line, "−")),
    { label: "Gross pay", amount: result.gross, sign: "", strong: true },
    { label: "Health contribution", amount: result.healthContribution, sign: "−" },
    ...(result.providentFund ? [{ label: "Provident fund", amount: result.providentFund, sign: "−" as const }] : []),
    ...(result.gis ? [{ label: "GIS", amount: result.gis, sign: "−" as const }] : []),
    { label: "TDS", amount: result.tds, sign: "−" },
    ...lines.filter((line) => LINE_GROUP[line.kind] === "after_tax").map((line) => lineRow(line, "−")),
  ];

  return (
    <dl className="flex flex-col">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="flex items-center justify-between gap-4 border-b border-separator/60 py-2 last:border-b-0">
          <dt className={`flex min-w-0 flex-1 flex-col ${row.strong ? "font-semibold" : ""}`}>
            <span>{row.label}</span>
            {row.detail ? <span className="text-secondary text-label-secondary">{row.detail}</span> : null}
          </dt>
          <dd className="flex shrink-0 items-center gap-1">
            <span className={`tabular whitespace-nowrap ${row.strong ? "font-semibold" : "text-label-secondary"}`}>
              {row.sign ? `${row.sign} ` : ""}
              {formatNu(row.amount)}
            </span>
            {row.line && lineAction ? lineAction(row.line) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
