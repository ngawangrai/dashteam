import { parsePublicEnv } from "./schema";

// Each variable is referenced by its full name so Next.js can inline it into client bundles.
export const publicEnv = parsePublicEnv(
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  process.env.VERCEL_ENV,
);
