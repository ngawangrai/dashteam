import "server-only";
import { z } from "zod";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// connection string"),
  // Server only. Creates and removes logins when an admin adds or removes a person.
  SUPABASE_SECRET_KEY: z.string().min(1, "SUPABASE_SECRET_KEY is missing"),
  // 32 random bytes in base64. Encrypts TPN and bank account numbers. Losing it loses those fields.
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "FIELD_ENCRYPTION_KEY must be 32 bytes in base64"),
  // Email (milestone 5). Without a Resend key, mail goes to the local Mailpit when there is one, and
  // otherwise each send fails visibly ("Email isn't set up yet") so it can be retried once it is.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default("Xceed Studio <payroll@dashteam.local>"),
  MAILPIT_URL: z.url().optional(),
  // Where links in emails point.
  APP_URL: z.url().default("http://localhost:3000"),
  // The daily filing reminder job sends this as a bearer token. Without it, the job's route refuses everything.
  CRON_SECRET: z.string().min(32).optional(),
  // Tests only: pretend today is this date (YYYY-MM-DD) for due dates and reminders. Honoured only
  // when ALLOW_TEST_CLOCK=1, which only the Playwright config sets; never set it on a real deployment.
  FILING_TODAY: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const serverEnv = serverEnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  EMAIL_FROM: process.env.EMAIL_FROM || undefined,
  // Local development falls back to the Mailpit the Supabase stack runs; production never does.
  MAILPIT_URL: process.env.MAILPIT_URL || (process.env.NODE_ENV === "production" ? undefined : "http://127.0.0.1:54324"),
  APP_URL: process.env.APP_URL || undefined,
  CRON_SECRET: process.env.CRON_SECRET || undefined,
  FILING_TODAY: process.env.ALLOW_TEST_CLOCK === "1" ? process.env.FILING_TODAY || undefined : undefined,
});
