import { z } from "zod";
import { parseNu } from "@/lib/format";
import type { PlainDate } from "@/modules/rules/types";
import { BANKS } from "./banks";
import type { PayTerms } from "./pay";

// Validation for everything typed into the people screens. Messages are shown to people as written.

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const withoutSpaces = (value: string) => value.replace(/\s+/g, "");

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0));
    return date.getUTCFullYear() === y && date.getUTCMonth() === (m ?? 1) - 1 && date.getUTCDate() === d;
  }, "Choose a date that exists.")
  .transform((value) => value as PlainDate);

const fullName = z.string().trim().min(1, "Enter their name.").max(100, "That name is too long.");
const email = z.string().trim().toLowerCase().pipe(z.email("Enter their email address."));

const phone = z.preprocess(
  blankToNull,
  z
    .string()
    .transform(withoutSpaces)
    .pipe(z.string().regex(/^\d{8}$/, "Enter an 8-digit phone number, like 17 11 22 33."))
    .nullable(),
);

const bankName = z.preprocess(blankToNull, z.enum(BANKS, { message: "Choose a bank from the list." }).nullable());

const bankAccount = z.preprocess(
  blankToNull,
  z
    .string()
    .transform(withoutSpaces)
    .pipe(z.string().regex(/^\d{6,20}$/, "Enter the account number using digits only."))
    .nullable(),
);

const tpn = z.preprocess(
  blankToNull,
  z
    .string()
    .transform((value) => withoutSpaces(value).toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{5,20}$/, "Enter the TPN using letters and digits only."))
    .nullable(),
);

const amount = (label: string) =>
  z
    .string()
    .transform((value, context) => {
      const parsed = parseNu(value);
      if (parsed === null) {
        context.addIssue({ code: "custom", message: `Enter the ${label} in ngultrum, like 40,000.` });
        return z.NEVER;
      }
      return parsed;
    });
const positiveAmount = (label: string) => amount(label).refine((value) => value > 0, `Enter the ${label}.`);

export const personDetailsSchema = z
  .object({ fullName, email, phone, bankName, bankAccount, tpn, startDate: plainDate })
  .refine((value) => value.bankAccount === null || value.bankName !== null, {
    message: "Choose the bank for this account.",
    path: ["bankName"],
  });

export type PersonDetails = z.output<typeof personDetailsSchema>;

const payFieldsSchema = z
  .discriminatedUnion("employmentType", [
    z.object({
      employmentType: z.literal("full_time"),
      basic: positiveAmount("basic pay"),
      allowances: z.preprocess((value) => (value === undefined || blankToNull(value) === null ? "0" : value), amount("allowance")),
    }),
    z.object({ employmentType: z.literal("intern"), stipend: positiveAmount("stipend") }),
  ])
  .transform((value) => value);

export type PayFields = z.output<typeof payFieldsSchema>;

export const newPersonSchema = z
  .intersection(personDetailsSchema, payFieldsSchema)
  .transform(({ employmentType, ...rest }) => {
    const { fullName, email, phone, bankName, bankAccount, tpn, startDate } = rest;
    const pay =
      employmentType === "intern"
        ? { employmentType, stipend: (rest as { stipend: number }).stipend }
        : {
            employmentType,
            basic: (rest as { basic: number }).basic,
            allowances: (rest as { allowances: number }).allowances,
          };
    return { fullName, email, phone, bankName, bankAccount, tpn, startDate, pay };
  });

export type NewPerson = z.output<typeof newPersonSchema>;

export const payChangeSchema = z
  .intersection(
    z.object({ effectiveFrom: plainDate.refine((date) => date.endsWith("-01"), "A pay change starts on the 1st of a month.") }),
    payFieldsSchema,
  )
  .transform(({ effectiveFrom, ...pay }) => ({
    effectiveFrom,
    pay:
      pay.employmentType === "intern"
        ? { employmentType: pay.employmentType, stipend: (pay as { stipend: number }).stipend }
        : {
            employmentType: pay.employmentType,
            basic: (pay as { basic: number }).basic,
            allowances: (pay as { allowances: number }).allowances,
          },
  }));

export function toPayTerms(effectiveFrom: PlainDate, pay: PayFields): PayTerms {
  return pay.employmentType === "intern"
    ? { effectiveFrom, employmentType: "intern", stipend: pay.stipend }
    : { effectiveFrom, employmentType: "full_time", basic: pay.basic, allowances: pay.allowances };
}

export const exitSchema = (startDate: string) =>
  z.object({
    endDate: plainDate.refine((date) => date >= startDate, "The last working day can’t be before they started."),
  });

/** A person asking to change their own details. Only what differs from today is kept. */
export const changeRequestSchema = (current: { phone: string | null; bankName: string | null }) =>
  z
    .object({ phone, bankName, bankAccount })
    .transform((value) => ({
      phone: value.phone !== null && value.phone !== current.phone ? value.phone : null,
      bankName: value.bankName !== null && value.bankName !== current.bankName ? value.bankName : null,
      bankAccount: value.bankAccount,
    }))
    .refine((value) => value.bankName === null || value.bankAccount !== null, {
      message: "Enter the account number for the new bank.",
      path: ["bankAccount"],
    })
    .refine((value) => value.phone !== null || value.bankName !== null || value.bankAccount !== null, {
      message: "Change at least one detail before sending.",
      path: ["phone"],
    });

export type ChangeRequest = z.output<ReturnType<typeof changeRequestSchema>>;
