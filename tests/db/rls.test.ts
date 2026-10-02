import { describe, expect, it } from "vitest";
import { ADMIN_ID, EMPLOYEE_ID, as, rolledBack, sql } from "./local-db";

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
    const role = await rolledBack(async (tx) => {
      const [user] = await tx`
        insert into auth.users (instance_id, id, aud, role, email)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'new.person@dashteam.local')
        returning id`;
      const [profile] = await tx`select role from public.profiles where id = ${user?.id}`;
      return profile?.role as string | undefined;
    });
    expect(role).toBe("employee");
  });
});
