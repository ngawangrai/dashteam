import { z } from "zod";
import { parseNu } from "@/lib/format";
import { LEAVE_TYPES } from "@/modules/rules/types";
import type { NewRequest } from "./balance";

// What the request sheet sends. Messages are shown to people as written.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the dates on the calendar.");
const flag = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());
const optionalDate = z.preprocess((value) => (value === "" || value === undefined ? null : value), date.nullable());

export const leaveRequestSchema = z
  .object({
    leaveType: z.enum(LEAVE_TYPES, { message: "Choose the kind of leave." }),
    startDate: date,
    endDate: date,
    startHalf: flag,
    endHalf: flag,
    childOrder: z.preprocess((value) => (value === "" || value === undefined ? null : value), z.enum(["first_or_second", "later"]).nullable()),
    eventDate: optionalDate,
    note: z.string().trim().max(500, "Keep the note under 500 characters.").default(""),
  })
  .refine((value) => value.endDate >= value.startDate, { message: "The last day can’t be before the first.", path: ["endDate"] })
  .transform((value): NewRequest & { note: string } => value);


export const settlementSchema = z
  .object({ decision: z.enum(["accepted", "changed", "waived"]), amount: z.string().optional() })
  .transform((value, context) => {
    if (value.decision !== "changed") return { decision: value.decision, amount: null };
    const amount = parseNu(value.amount ?? "");
    if (amount === null) {
      context.addIssue({ code: "custom", message: "Enter the amount in ngultrum, like 2,000.", path: ["amount"] });
      return z.NEVER;
    }
    return { decision: value.decision, amount };
  });
