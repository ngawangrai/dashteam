import postgres from "postgres";
import { afterAll } from "vitest";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const url = process.env.TEST_DATABASE_URL ?? LOCAL_DB;
if (!/@(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error("Database tests only run against a local database.");
}

export const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
afterAll(() => sql.end());

// Matches supabase/seed.sql.
export const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
export const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";

class Rollback extends Error {}

/** Runs `run` in a transaction that is always rolled back, so tests never leave anything behind. */
export async function rolledBack<T>(run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      result = await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result as T;
}

/** Runs `run` as a signed-in person (or anon), the way PostgREST and lib/db/client.ts do, then rolls back. */
export function as<T>(userId: string | null, run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return rolledBack(async (tx) => {
    if (userId) {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true),
                      set_config('request.jwt.claim.sub', ${userId}, true),
                      set_config('role', 'authenticated', true)`;
    } else {
      await tx`select set_config('role', 'anon', true)`;
    }
    return run(tx);
  });
}

export const SEEDED_EMPLOYEE_PERSON_ID = "33333333-3333-4333-8333-333333333333";

/** Switches an open transaction to a signed-in person (or back to the database owner with null). */
export async function actAs(tx: postgres.TransactionSql, userId: string | null): Promise<void> {
  if (userId === null) {
    await tx`select set_config('role', 'postgres', true)`;
    return;
  }
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true),
                  set_config('request.jwt.claim.sub', ${userId}, true),
                  set_config('role', 'authenticated', true)`;
}

/** Runs and commits as a signed-in person, returning the transaction id (for undo tests). */
export async function committedAs<T>(
  userId: string,
  run: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<{ result: T; transactionId: number }> {
  let transactionId = 0;
  const result = await sql.begin(async (tx) => {
    await actAs(tx, userId);
    const value = await run(tx);
    const [row] = await tx<{ id: string }[]>`select txid_current()::text as id`;
    transactionId = Number(row?.id);
    return value;
  });
  return { result: result as T, transactionId };
}

export function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@dashteam.local`;
}
