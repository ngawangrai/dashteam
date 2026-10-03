import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  ADMIN_ID,
  EMPLOYEE_ID,
  SEEDED_EMPLOYEE_PERSON_ID as SONAM,
  actAs,
  as,
  committedAs,
  rolledBack,
  sql,
  uniqueEmail,
} from "./local-db";

// Leave in the database: who sees what, overlaps, transitions, audit, undo and the team calendar.

const created: string[] = [];
afterAll(async () => {
  if (created.length) await sql`delete from public.people where id = any(${created})`;
});

type Span = { start: string; end: string; type?: string; status?: string };

const ask = (tx: postgres.TransactionSql, span: Span, personId = SONAM, requestedBy = EMPLOYEE_ID) =>
  tx<{ id: string; status: string }[]>`
    insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
    values (${personId}, ${span.type ?? "annual"}, ${span.start}, ${span.end}, ${span.status ?? "pending"}, ${requestedBy})
    returning id, status`;

async function colleague(tx: postgres.TransactionSql) {
  const [person] = await tx<{ id: string }[]>`
    insert into public.people (full_name, email, start_date) values ('Pema Choden', ${uniqueEmail("pema")}, '2025-01-06') returning id`;
  return person?.id ?? "";
}

// Far enough ahead that "not started yet" stays true whenever the tests run.
const FUTURE = { start: "2030-03-04", end: "2030-03-06" };

describe("who sees leave", () => {
  it("shows a person only their own requests", async () => {
    const rows = await rolledBack(async (tx) => {
      const pema = await colleague(tx);
      await ask(tx, { start: "2030-04-01", end: "2030-04-02", status: "approved" }, pema, ADMIN_ID);
      await ask(tx, FUTURE);
      await actAs(tx, EMPLOYEE_ID);
      return tx`select person_id from public.leave_requests`;
    });
    expect(rows.map((row) => row.person_id)).toEqual([SONAM]);
  });

  it("shows everyone who's out by name and dates only: no type, nothing pending", async () => {
    const out = await rolledBack(async (tx) => {
      const pema = await colleague(tx);
      await ask(tx, { start: "2030-04-01", end: "2030-04-02", type: "sick", status: "approved" }, pema, ADMIN_ID);
      await ask(tx, { start: "2030-04-06", end: "2030-04-07", status: "pending" }, pema, ADMIN_ID);
      await actAs(tx, EMPLOYEE_ID);
      return tx`select * from public.team_out('2030-04-01', '2030-04-30')`;
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ full_name: "Pema Choden", start_half: false });
    expect(Object.keys(out[0] ?? {})).not.toContain("leave_type");
  });

  it("gives signed-out visitors nothing", async () => {
    await expect(as(null, (tx) => tx`select id from public.leave_requests`)).rejects.toThrow(/permission denied/);
  });
});

describe("sending requests", () => {
  it("lets a person send their own request as pending", async () => {
    const [request] = await as(EMPLOYEE_ID, (tx) => ask(tx, FUTURE));
    expect(request?.status).toBe("pending");
  });

  it("doesn't let a person approve their own leave on entry", async () => {
    await expect(as(EMPLOYEE_ID, (tx) => ask(tx, { ...FUTURE, status: "approved" }))).rejects.toThrow(/row-level security/);
  });

  it("doesn't let a person send leave for someone else", async () => {
    await expect(
      rolledBack(async (tx) => {
        const pema = await colleague(tx);
        await actAs(tx, EMPLOYEE_ID);
        return ask(tx, FUTURE, pema);
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets an admin enter leave for someone, approved on entry", async () => {
    const [request] = await as(ADMIN_ID, (tx) => ask(tx, { ...FUTURE, status: "approved" }, SONAM, ADMIN_ID));
    expect(request?.status).toBe("approved");
  });

  it("refuses leave that overlaps the person's own pending or approved leave", async () => {
    await expect(
      as(EMPLOYEE_ID, async (tx) => {
        await ask(tx, FUTURE);
        return ask(tx, { start: "2030-03-06", end: "2030-03-09" });
      }),
    ).rejects.toThrow(/no_overlap/);
  });

  it("allows the same days again once the earlier request is cancelled", async () => {
    const [second] = await as(EMPLOYEE_ID, async (tx) => {
      const [first] = await ask(tx, FUTURE);
      await tx`update public.leave_requests set status = 'cancelled' where id = ${first?.id ?? ""}`;
      return ask(tx, FUTURE);
    });
    expect(second?.status).toBe("pending");
  });
});

describe("deciding and cancelling", () => {
  it("only lets an admin approve or decline", async () => {
    await expect(
      as(EMPLOYEE_ID, async (tx) => {
        const [request] = await ask(tx, FUTURE);
        return tx`update public.leave_requests set status = 'approved' where id = ${request?.id ?? ""}`;
      }),
    ).rejects.toThrow(/Only an admin/);
  });

  it("records who decided, and the note", async () => {
    const [decided] = await rolledBack(async (tx) => {
      await actAs(tx, EMPLOYEE_ID);
      const [request] = await ask(tx, FUTURE);
      await actAs(tx, ADMIN_ID);
      return tx`update public.leave_requests set status = 'declined', decision_note = 'Busy week'
                where id = ${request?.id ?? ""} returning status, decided_by, decision_note`;
    });
    expect(decided).toMatchObject({ status: "declined", decided_by: ADMIN_ID, decision_note: "Busy week" });
  });

  it("lets a person cancel approved leave that hasn't started", async () => {
    const [cancelled] = await rolledBack(async (tx) => {
      const [request] = await ask(tx, { ...FUTURE, status: "approved" }, SONAM, ADMIN_ID);
      await actAs(tx, EMPLOYEE_ID);
      return tx`update public.leave_requests set status = 'cancelled' where id = ${request?.id ?? ""} returning status`;
    });
    expect(cancelled?.status).toBe("cancelled");
  });

  it("leaves cancelling started leave to the admin", async () => {
    const started = { start: "2026-01-05", end: "2026-01-06", status: "approved" };
    await expect(
      rolledBack(async (tx) => {
        const [request] = await ask(tx, started, SONAM, ADMIN_ID);
        await actAs(tx, EMPLOYEE_ID);
        return tx`update public.leave_requests set status = 'cancelled' where id = ${request?.id ?? ""}`;
      }),
    ).rejects.toThrow(/only be cancelled by an admin/);
    const [byAdmin] = await rolledBack(async (tx) => {
      const [request] = await ask(tx, started, SONAM, ADMIN_ID);
      await actAs(tx, ADMIN_ID);
      return tx`update public.leave_requests set status = 'cancelled' where id = ${request?.id ?? ""} returning status`;
    });
    expect(byAdmin?.status).toBe("cancelled");
  });

  it("never changes the dates or type after sending", async () => {
    await expect(
      rolledBack(async (tx) => {
        const [request] = await ask(tx, FUTURE);
        await actAs(tx, ADMIN_ID);
        return tx`update public.leave_requests set end_date = '2030-03-20' where id = ${request?.id ?? ""}`;
      }),
    ).rejects.toThrow(/can’t be edited/);
  });
});

describe("holidays", () => {
  const insertHoliday = (tx: postgres.TransactionSql) =>
    tx`insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
       values ('Test holiday', '2030-12-18', '2030-12-18', 2030, 'one_off', 'national', 'confirmed', 'test')`;

  it("are read by everyone and written only by admins", async () => {
    await expect(as(EMPLOYEE_ID, insertHoliday)).rejects.toThrow(/row-level security/);
    const rows = await as(ADMIN_ID, async (tx) => {
      await insertHoliday(tx);
      await actAs(tx, EMPLOYEE_ID);
      return tx`select name from public.holidays where start_date = '2030-12-18'`;
    });
    expect(rows).toEqual([{ name: "Test holiday" }]);
  });
});

describe("audit and undo", () => {
  it("records sending, approving, declining and cancelling", async () => {
    const actions = await rolledBack(async (tx) => {
      await actAs(tx, EMPLOYEE_ID);
      const [one] = await ask(tx, FUTURE);
      const [two] = await ask(tx, { start: "2030-05-04", end: "2030-05-04" });
      const [three] = await ask(tx, { start: "2030-06-03", end: "2030-06-03" });
      await actAs(tx, ADMIN_ID);
      await tx`update public.leave_requests set status = 'approved' where id = ${one?.id ?? ""}`;
      await tx`update public.leave_requests set status = 'declined' where id = ${two?.id ?? ""}`;
      await actAs(tx, EMPLOYEE_ID);
      await tx`update public.leave_requests set status = 'cancelled' where id = ${three?.id ?? ""}`;
      await actAs(tx, null);
      return tx`select action, after ->> 'status' as status from public.audit_log
                where entity_table = 'leave_requests' and transaction_id = txid_current() order by id`;
    });
    expect(actions.map((row) => `${row.action}:${row.status}`)).toEqual([
      "leave_requests.insert:pending",
      "leave_requests.insert:pending",
      "leave_requests.insert:pending",
      "leave_requests.update:approved",
      "leave_requests.update:declined",
      "leave_requests.update:cancelled",
    ]);
  });

  it("undoes an approval, putting the request back to pending", async () => {
    const pema = await sql.begin((tx) => colleague(tx));
    created.push(pema);
    const { result: id } = await committedAs(ADMIN_ID, async (tx) => (await ask(tx, { start: "2030-07-01", end: "2030-07-02" }, pema, ADMIN_ID))[0]?.id ?? "");
    const { transactionId } = await committedAs(ADMIN_ID, (tx) => tx`update public.leave_requests set status = 'approved' where id = ${id}`);
    await committedAs(ADMIN_ID, (tx) => tx`select public.undo_transaction(${transactionId})`);
    const [after] = await sql`select status, decided_by from public.leave_requests where id = ${id}`;
    expect(after).toMatchObject({ status: "pending", decided_by: null });
  });
});

describe("after leaving", () => {
  it("hides a person's own leave from them once their access has ended", async () => {
    const rows = await rolledBack(async (tx) => {
      await ask(tx, FUTURE);
      await tx`update public.people set end_date = public.thimphu_today() - 1 where id = ${SONAM}`;
      await actAs(tx, EMPLOYEE_ID);
      return tx`select id from public.leave_requests`;
    });
    expect(rows).toHaveLength(0);
  });
});
