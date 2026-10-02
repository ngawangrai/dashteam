"use client";

import { MoneyField } from "@/components/field";
import { Money } from "@/components/money";
import { SegmentedControl } from "@/components/segmented-control";
import { type RulesByType, takeHomeFor, termsFromFields } from "@/modules/people/estimate";
import { EMPLOYMENT_TYPE_OPTIONS } from "@/modules/people/labels";
import type { Chhertum, EmploymentType } from "@/modules/rules/types";

export type PayValues = { employmentType: EmploymentType; basic: string; allowances: string; stipend: string };

type PayFieldsProps = {
  values: PayValues;
  onChange: (values: PayValues) => void;
  errors?: Record<string, string>;
  rules: RulesByType | null;
  /** Today's take-home, to show the difference a pay change makes. */
  now?: Chhertum | null;
  estimateLabel?: string;
};

/** Pay for the chosen type, with the take-home it gives worked out as it's typed. */
export function PayFields({ values, onChange, errors = {}, rules, now = null, estimateLabel = "Take-home" }: PayFieldsProps) {
  const set = (patch: Partial<PayValues>) => onChange({ ...values, ...patch });
  const terms = termsFromFields(values.employmentType, values);
  const takeHome = terms && rules ? takeHomeFor(terms, rules) : null;

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        name="employmentType"
        label="Type"
        options={EMPLOYMENT_TYPE_OPTIONS}
        value={values.employmentType}
        onChange={(employmentType) => set({ employmentType })}
      />
      {values.employmentType === "full_time" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField name="basic" label="Basic pay (Nu.)" value={values.basic} onChange={(e) => set({ basic: e.target.value })} error={errors.basic} required />
          <MoneyField
            name="allowances"
            label="Allowance (Nu.)"
            value={values.allowances}
            onChange={(e) => set({ allowances: e.target.value })}
            error={errors.allowances}
            hint="Leave empty if none."
          />
        </div>
      ) : (
        <MoneyField name="stipend" label="Stipend (Nu.)" value={values.stipend} onChange={(e) => set({ stipend: e.target.value })} error={errors.stipend} required />
      )}
      <p aria-live="polite" className="min-h-6 text-body text-label-secondary">
        {takeHome !== null ? (
          <>
            {estimateLabel} about <Money amount={takeHome} className="font-semibold text-label" /> a month
            {now !== null && now !== takeHome ? (
              <>
                {" "}
                (now <Money amount={now} />)
              </>
            ) : null}
          </>
        ) : null}
      </p>
    </div>
  );
}
