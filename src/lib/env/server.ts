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
});

export const serverEnv = serverEnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
});
