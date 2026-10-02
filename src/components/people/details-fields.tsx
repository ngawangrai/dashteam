"use client";

import { SelectField, TextField } from "@/components/field";
import { InsetSection } from "@/components/inset-section";
import { maskedLast4 } from "@/lib/format";
import { BANKS } from "@/modules/people/banks";

export type DetailsValues = {
  fullName: string;
  email: string;
  phone: string;
  startDate: string;
  bankName: string;
  bankAccount: string;
  tpn: string;
};

type DetailsFieldsProps = {
  values: DetailsValues;
  onChange: (values: DetailsValues) => void;
  errors?: Record<string, string>;
  /** When editing: what's stored now, so a blank field can mean "keep it". */
  stored?: { bankAccountLast4: string | null; tpnLast4: string | null };
};

const bankOptions = BANKS.map((bank) => ({ value: bank, label: bank }));

export function DetailsFields({ values, onChange, errors = {}, stored }: DetailsFieldsProps) {
  const set = (patch: Partial<DetailsValues>) => onChange({ ...values, ...patch });
  const keepHint = (last4: string | null | undefined) => (last4 ? `Leave empty to keep ${maskedLast4(last4)}.` : undefined);

  return (
    <>
      <InsetSection title="Details">
        <div className="flex flex-col gap-4 p-4">
          <TextField name="fullName" label="Full name" autoComplete="off" value={values.fullName} onChange={(e) => set({ fullName: e.target.value })} error={errors.fullName} required />
          <TextField
            name="email"
            label="Email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="off"
            value={values.email}
            onChange={(e) => set({ email: e.target.value })}
            error={errors.email}
            hint="They’ll sign in with this email."
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="phone"
              label="Phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="17 11 22 33"
              value={values.phone}
              onChange={(e) => set({ phone: e.target.value })}
              error={errors.phone}
            />
            <TextField name="startDate" label="Start date" type="date" value={values.startDate} onChange={(e) => set({ startDate: e.target.value })} error={errors.startDate} required />
          </div>
        </div>
      </InsetSection>

      <InsetSection title="Bank and tax" footer={stored ? undefined : "You can add these later. They’re needed before their first payroll."}>
        <div className="flex flex-col gap-4 p-4">
          <SelectField
            name="bankName"
            label="Bank"
            options={bankOptions}
            placeholder="Choose a bank"
            value={values.bankName}
            onChange={(e) => set({ bankName: e.target.value })}
            error={errors.bankName}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="bankAccount"
              label="Account number"
              inputMode="numeric"
              autoComplete="off"
              className="tabular"
              value={values.bankAccount}
              onChange={(e) => set({ bankAccount: e.target.value })}
              error={errors.bankAccount}
              hint={keepHint(stored?.bankAccountLast4)}
            />
            <TextField
              name="tpn"
              label="TPN"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="tabular"
              value={values.tpn}
              onChange={(e) => set({ tpn: e.target.value })}
              error={errors.tpn}
              hint={keepHint(stored?.tpnLast4)}
            />
          </div>
        </div>
      </InsetSection>
    </>
  );
}
