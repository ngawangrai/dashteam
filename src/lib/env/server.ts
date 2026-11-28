import "server-only";
import { parseServerEnv } from "./schema";

export { serverEnvSchema } from "./schema";

// Refuses to load without every setting (see schema.ts); src/instrumentation.ts loads it when the
// server starts, so a misconfigured deployment stops there rather than on someone's first request.
export const serverEnv = parseServerEnv(
  {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    MAILPIT_URL: process.env.MAILPIT_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    FILING_TODAY: process.env.ALLOW_TEST_CLOCK === "1" ? process.env.FILING_TODAY : undefined,
  },
  process.env.VERCEL_ENV,
);
