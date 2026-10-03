import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { V1_HOLIDAYS } from "@/modules/leave/holidays-v1";
import { ADMIN_ID, EMPLOYEE_ID, SEEDED_EMPLOYEE_PERSON_ID as SONAM, actAs, as, committedAs, rolledBack, sql } from "./local-db";

// Holidays and leave notes in the database: the seed, who can change them, checks, audit and undo.

const cleanup: string[] = [];
afterAll(async () => {
  if (cleanup.length) await sql`delete from public.holidays where id = any(${cleanup})`;
});

type DbHoliday = { name: string; start_date: string; end_date: string; year: number; kind: string; scope: string; status: string; source: string; note: string };

const add = (tx: postgres.TransactionSql, fields: Partial<DbHoliday> = {}) => {
  const h = { name: "Test holiday", start_date: "2030-03-04", end_date: "2030-03-04", year: 2030, kind: "one_off", scope: "national", status: "confirmed", source: "test", ...fields };
  return tx<{ id: string }[]>`
    insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
    values (${h.name}, ${h.start_date}, ${h.end_date}, ${h.year}, ${h.kind}, ${h.scope}, ${h.status}, ${h.source}) returning id`;
};

describe("the seeded holidays", () => {
  it("match src/modules/leave/holidays-v1.ts exactly", async () => {
    const rows = await sql<DbHoliday[]>`
      select name, start_date::text, end_date::text, year, kind::text, scope::text, status::text, source, note
      from public.holidays where year in (2026, 2027) order by year, start_date, name`;
    const expected = [...V1_HOLIDAYS]
      .sort((a, b) => a.year - b.year || a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))
      .map((h) => ({ name: h.name, start_date: h.startDate, end_date: h.endDate, year: h.year, kind: h.kind, scope: h.scope, status: h.status, source: h.source, note: h.note }));
    expect(rows).toEqual(expected);
  });

  it("are confirmed for 2026 and tentative for 2027, each with a source", async () => {
    const [counts] = await sql`
      select count(*) filter (where year = 2026 and status = 'confirmed')::int as confirmed_2026,
             count(*) filter (where year = 2027 and status = 'tentative')::int as tentative_2027,
             count(*) filter (where year in (2026, 2027) and length(source) = 0)::int as without_source
      from public.holidays`;
    expect(counts).toEqual({ confirmed_2026: 17, tentative_2027: 17, without_source: 0 });
  });
});

describe("who can change holidays", () => {
  it("lets employees read them but not add, change or remove them", async () => {
    const result = await rolledBack(async (tx) => {
      await actAs(tx, EMPLOYEE_ID);
      const read = await tx`select id from public.holidays where year = 2026`;
      const updated = await tx`update public.holidays set name = 'x' where year = 2026 returning id`;
      const removed = await tx`delete from public.holidays where year = 2026 returning id`;
      return { read: read.length, updated: updated.length, removed: removed.length };
    });
    expect(result).toEqual({ read: 17, updated: 0, removed: 0 });
    await expect(as(EMPLOYEE_ID, (tx) => add(tx))).rejects.toThrow(/row-level security/);
  });

  it("lets admins add, move and remove them", async () => {
    const moved = await as(ADMIN_ID, async (tx) => {
      const [row] = await add(tx);
      await tx`update public.holidays set start_date = '2030-03-05', end_date = '2030-03-06' where id = ${row?.id ?? ""}`;
      const [after] = await tx`select start_date::text, end_date::text from public.holidays where id = ${row?.id ?? ""}`;
      await tx`delete from public.holidays where id = ${row?.id ?? ""}`;
      return after;
    });
    expect(moved).toEqual({ start_date: "2030-03-05", end_date: "2030-03-06" });
  });
});

describe("holiday checks", () => {
  it.each([
    ["an end before the start", { start_date: "2030-03-05", end_date: "2030-03-04" }, /holidays_end_after_start/],
    ["a range across two years", { start_date: "2030-12-31", end_date: "2031-01-01" }, /holidays_within_year/],
    ["a year that doesn't match the dates", { year: 2031 }, /holidays_within_year/],
    ["no source", { source: " " }, /holidays_source_given/],
  ])("refuses %s", async (_label, fields, error) => {
    await expect(as(ADMIN_ID, (tx) => add(tx, fields as Partial<DbHoliday>))).rejects.toThrow(error);
  });

  it("refuses the same holiday twice in a year", async () => {
    await expect(
      as(ADMIN_ID, async (tx) => {
        await add(tx);
        return add(tx, { start_date: "2030-04-01", end_date: "2030-04-01" });
      }),
    ).rejects.toThrow(/holidays_name_year/);
  });
});

describe("audit, notes and undo", () => {
  it("records adding, changing and removing a holiday", async () => {
    const actions = await rolledBack(async (tx) => {
      await actAs(tx, ADMIN_ID);
      const [row] = await add(tx);
      await tx`update public.holidays set status = 'tentative' where id = ${row?.id ?? ""}`;
      await tx`delete from public.holidays where id = ${row?.id ?? ""}`;
      await actAs(tx, null);
      return tx`select action from public.audit_log where entity_table = 'holidays' and transaction_id = txid_current() order by id`;
    });
    expect(actions.map((row) => row.action)).toEqual(["holidays.insert", "holidays.update", "holidays.delete"]);
  });

  it("shows a person only their own notes, and lets them mark them seen", async () => {
    const result = await rolledBack(async (tx) => {
      await actAs(tx, ADMIN_ID);
      await tx`insert into public.leave_notices (person_id, message) values (${SONAM}, 'A holiday moved')`;
      await actAs(tx, EMPLOYEE_ID);
      const seen = await tx`update public.leave_notices set seen_at = now() where person_id = ${SONAM} returning id`;
      const own = await tx`select message from public.leave_notices`;
      return { seen: seen.length, own };
    });
    expect(result).toEqual({ seen: 1, own: [{ message: "A holiday moved" }] });
    await expect(
      as(EMPLOYEE_ID, (tx) => tx`insert into public.leave_notices (person_id, message) values (${SONAM}, 'x')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("undoes a move, putting the holiday back and removing the notes it wrote", async () => {
    const { result: id } = await committedAs(ADMIN_ID, async (tx) => (await add(tx, { name: `Undo test ${Date.now()}` }))[0]?.id ?? "");
    cleanup.push(id);
    const { transactionId } = await committedAs(ADMIN_ID, async (tx) => {
      await tx`update public.holidays set start_date = '2030-03-10', end_date = '2030-03-10' where id = ${id}`;
      await tx`insert into public.leave_notices (person_id, message) values (${SONAM}, ${`moved ${id}`})`;
    });
    await committedAs(ADMIN_ID, (tx) => tx`select public.undo_transaction(${transactionId})`);
    const [holiday] = await sql`select start_date::text from public.holidays where id = ${id}`;
    const notes = await sql`select id from public.leave_notices where message = ${`moved ${id}`}`;
    expect(holiday?.start_date).toBe("2030-03-04");
    expect(notes).toHaveLength(0);
  });
});
