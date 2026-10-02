import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const url = process.env.TEST_DATABASE_URL ?? LOCAL_DB;
if (!/@(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error("RLS tests only run against a local database.");
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
afterAll(() => sql.end());

// Matches supabase/seed.sql.
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";

class Rollback extends Error {}

/** Runs `run` as a signed-in person (or anon), the way PostgREST and lib/db/client.ts do, then rolls back. */
async function as<T>(userId: string | null, run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (userId) {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true),
                        set_config('request.jwt.claim.sub', ${userId}, true),
                        set_config('role', 'authenticated', true)`;
      } else {
        await tx`select set_config('role', 'anon', true)`;
      }
      result = await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result as T;
}

describe("row level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const unprotected = await sql`
      select tablename from pg_tables where schemaname = 'public' and not rowsecurity`;
    expect(unprotected.map((row) => row.tablename)).toEqual([]);
  });

  it("lets an employee read only their own profile", async () => {
    const rows = await as(EMPLOYEE_ID, (tx) => tx`select id, role from public.profiles`);
    expect(rows).toEqual([{ id: EMPLOYEE_ID, role: "employee" }]);
  });

  it("hides another person's profile from an employee, even when asked for by id", async () => {
    const rows = await as(EMPLOYEE_ID, (tx) => tx`select id from public.profiles where id = ${ADMIN_ID}`);
    expect(rows).toHaveLength(0);
  });

  it("lets an admin read every profile", async () => {
    const rows = await as(ADMIN_ID, (tx) => tx`select id from public.profiles order by id`);
    expect(rows.map((row) => row.id)).toEqual([ADMIN_ID, EMPLOYEE_ID]);
  });

  it("stops an employee from making themselves an admin", async () => {
    await expect(
      as(EMPLOYEE_ID, (tx) => tx`update public.profiles set role = 'admin' where id = ${EMPLOYEE_ID}`),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops an employee from creating or deleting profiles", async () => {
    await expect(
      as(EMPLOYEE_ID, (tx) => tx`insert into public.profiles (id, role) values (gen_random_uuid(), 'admin')`),
    ).rejects.toThrow(/permission denied/);
    await expect(as(EMPLOYEE_ID, (tx) => tx`delete from public.profiles`)).rejects.toThrow(/permission denied/);
  });

  it("gives signed-out visitors nothing", async () => {
    await expect(as(null, (tx) => tx`select id from public.profiles`)).rejects.toThrow(/permission denied/);
  });
});

describe("is_admin()", () => {
  it("is true only for admins", async () => {
    const [admin] = await as(ADMIN_ID, (tx) => tx`select public.is_admin() as value`);
    const [employee] = await as(EMPLOYEE_ID, (tx) => tx`select public.is_admin() as value`);
    expect(admin?.value).toBe(true);
    expect(employee?.value).toBe(false);
  });

  it("cannot be called by signed-out visitors", async () => {
    await expect(as(null, (tx) => tx`select public.is_admin()`)).rejects.toThrow(/permission denied/);
  });
});

describe("new accounts", () => {
  it("start as employees, never admins", async () => {
    let role: string | undefined;
    try {
      await sql.begin(async (tx) => {
        const [user] = await tx`
          insert into auth.users (instance_id, id, aud, role, email)
          values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'new.person@dashteam.local')
          returning id`;
        const [profile] = await tx`select role from public.profiles where id = ${user?.id}`;
        role = profile?.role;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(role).toBe("employee");
  });
});
