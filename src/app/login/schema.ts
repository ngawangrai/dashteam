import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "That doesn’t look like an email address. Check it and try again." }));

export const codeSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, { message: "Enter the 6 digits from the email." }));

export type SendCodeState =
  | { status: "idle" }
  | { status: "error"; email: string; message: string }
  | { status: "sent"; email: string; sentAt: number };

export type VerifyCodeState = { status: "idle" } | { status: "error"; message: string };
