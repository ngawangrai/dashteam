import { z } from "zod";

// Every setting DashTeam needs, and nothing else. There are no defaults and no fallbacks: a missing
// setting stops the app at build or start, with its name, rather than letting it run half set up or
// point somewhere it shouldn't. This file is pure so the rules can be tested.

type Values = Record<string, string | undefined>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  // Server only. Creates and removes logins when an admin adds or removes a person.
  SUPABASE_SECRET_KEY: z.string().min(1),
  // 32 random bytes in base64. Encrypts TPN and bank account numbers. Losing it loses those fields.
  FIELD_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, "base64").length === 32),
  // Exactly one way to send email: Resend in production, the local Mailpit in development and CI.
  RESEND_API_KEY: z.string().min(1).optional(),
  MAILPIT_URL: z.url().optional(),
  EMAIL_FROM: z.string().min(3),
  // Where links in emails point.
  APP_URL: z.url(),
  // The daily filing reminder job sends this as a bearer token.
  CRON_SECRET: z.string().min(32),
  // Tests only: pretend today is this date (YYYY-MM-DD). server.ts passes it through only when
  // ALLOW_TEST_CLOCK=1, which only the Playwright config sets.
  FILING_TODAY: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

/**
 * There is no staging database, and a preview must never reach production's, so a Vercel preview
 * refuses to build or run even if someone copies production settings into it. Other hosts don't
 * set VERCEL_ENV, so this is a no-op there.
 */
export function refusePreview(vercelEnv: string | undefined): void {
  if (vercelEnv === "preview") {
    throw new EnvError(
      "DashTeam doesn't run on preview deployments. There's no staging database, and a preview must never reach production.",
    );
  }
}

// Empty strings count as missing: an unset Vercel or GitHub value often arrives as "".
const present = (values: Values): Values =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" ? undefined : value]));

// Names only, never values: these messages end up in build and server logs.
function failure(names: string[], extra: string[] = []): EnvError {
  const parts = ["DashTeam can't start."];
  if (names.length) parts.push(`These settings are missing or wrong: ${names.join(", ")}.`);
  parts.push(...extra, "Locally, run `pnpm env:local`.");
  return new EnvError(parts.join(" "));
}

function issuesIn(result: { success: boolean; error?: z.ZodError }): string[] {
  if (result.success || !result.error) return [];
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "settings")))];
}

export function parsePublicEnv(values: Values, vercelEnv: string | undefined): PublicEnv {
  refusePreview(vercelEnv);
  const result = publicEnvSchema.safeParse(present(values));
  if (!result.success) throw failure(issuesIn(result));
  return result.data;
}

export function parseServerEnv(values: Values, vercelEnv: string | undefined): ServerEnv {
  refusePreview(vercelEnv);
  const cleaned = present(values);
  const result = serverEnvSchema.safeParse(cleaned);
  // Checked alongside the schema, so one run of the build names every problem at once.
  const transports = [cleaned.RESEND_API_KEY, cleaned.MAILPIT_URL].filter(Boolean).length;
  const transportProblem =
    transports === 1 ? [] : ["Set exactly one of RESEND_API_KEY (production) or MAILPIT_URL (local and CI)."];
  if (!result.success || transportProblem.length) throw failure(issuesIn(result), transportProblem);
  return result.data;
}
