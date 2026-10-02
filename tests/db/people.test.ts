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

// People, pay, change requests, audit, access and undo, tested in the database itself.

const created: string[] = [];
afterAll(async () => {
  // Test people are removed as the database owner; their audit entries stay, as audit entries do.
  if (created.length) await sql`delete from public.people where id = any(${created})`;
});

async function addPerson(tx: postgres.TransactionSql, fields: { email?: string; endDate?: string | null; profileId?: string | null } = {}) {
  const [person] = await tx<{ id: string }[]>`
    insert into public.people (full_name, email, start_date, end_date, profile_id)
    values ('Test Person', ${fields.email ?? uniqueEmail("person")}, '2025-01-06', ${fields.endDate ?? null}, ${fields.profileId ?? null})
    returning id`;
  if (!person) throw new Error("no person");
  await tx`insert into public.pay_records (person_id, effective_from, employment_type, stipend_ch)
           values (${person.id}, '2025-01-01', 'intern', 2000000)`;
  return person.id;
}

// Only call outside a transaction: the test connection pool has a single connection.
const thisMonth = () => sql<{ d: string }[]>`select date_trunc('month', public.thimphu_today())::date::text as d`.then((r) => r[0]?.d ?? "");

describe("people: who can see and change records", () => {
  it("shows an employee only their own record, even when asking for someone else by id", async () => {
    const result = await rolledBack(async (tx) => {
      const other = await addPerson(tx);
      await actAs(tx, EMPLOYEE_ID);
      return {
        all: await tx`select id from public.people`,
        other: await tx`select id from public.people where id = ${other}`,
      };
    });
    expect(result.all.map((row) => row.id)).toEqual([SONAM]);
    expect(result.other).toHaveLength(0);
  });

  it("does not let an employee add people", async () => {
    await expect(
      as(EMPLOYEE_ID, (tx) => tx`insert into public.people (full_name, email, start_date) values ('X', ${uniqueEmail("x")}, '2026-01-01')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let an employee edit even their own record", async () => {
    const updated = await as(EMPLOYEE_ID, (tx) => tx`update public.people set full_name = 'Changed' where id = ${SONAM} returning id`);
    expect(updated).toHaveLength(0);
  });

  it("lets an admin read, add and edit people", async () => {
    const result = await as(ADMIN_ID, async (tx) => {
      const id = await addPerson(tx);
      await tx`update public.people set phone = '17000000' where id = ${id}`;
      return tx`select id, phone from public.people where id in (${id}, ${SONAM})`;
    });
    expect(result).toHaveLength(2);
  });

  it("gives signed-out visitors nothing", async () => {
    await expect(as(null, (tx) => tx`select id from public.people`)).rejects.toThrow(/permission denied/);
  });
});

describe("pay records", () => {
  it("show an employee their own pay only", async () => {
    const rows = await rolledBack(async (tx) => {
      await addPerson(tx);
      await actAs(tx, EMPLOYEE_ID);
      return tx`select person_id from public.pay_records`;
    });
    expect(new Set(rows.map((row) => row.person_id))).toEqual(new Set([SONAM]));
  });

  it("cannot be added by an employee", async () => {
    await expect(
      as(EMPLOYEE_ID, (tx) => tx`insert into public.pay_records (person_id, effective_from, employment_type, stipend_ch)
                                 values (${SONAM}, '2099-01-01', 'intern', 1)`),
    ).rejects.toThrow(/row-level security/);
  });

  it("are never updated, even by the database owner", async () => {
    await expect(rolledBack((tx) => tx`update public.pay_records set note = 'changed'`)).rejects.toThrow(/cannot be changed/);
  });

  it("keep past months: a past record cannot be removed", async () => {
    await expect(
      as(ADMIN_ID, (tx) => tx`delete from public.pay_records where person_id = ${SONAM} and effective_from = '2025-03-01'`),
    ).rejects.toThrow(/past month/);
  });

  it("refuse a pay change that starts before this month", async () => {
    await expect(
      as(ADMIN_ID, (tx) => tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
                              values (${SONAM}, '2025-06-01', 'full_time', 1, 0)`),
    ).rejects.toThrow(/this month at the earliest/);
  });

  it("let an admin remove a future change entered by mistake", async () => {
    const deleted = await as(ADMIN_ID, async (tx) => {
      await tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
               values (${SONAM}, '2099-01-01', 'full_time', 5000000, 0)`;
      return tx`delete from public.pay_records where person_id = ${SONAM} and effective_from = '2099-01-01' returning id`;
    });
    expect(deleted).toHaveLength(1);
  });

  it("must start on the 1st and match their type", async () => {
    await expect(
      as(ADMIN_ID, (tx) => tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
                              values (${SONAM}, '2099-01-15', 'full_time', 1, 0)`),
    ).rejects.toThrow(/first_of_month/);
    await expect(
      as(ADMIN_ID, (tx) => tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
                              values (${SONAM}, '2099-01-01', 'intern', 1, 0)`),
    ).rejects.toThrow(/fields_match_type/);
  });
});

describe("profile change requests", () => {
  const ask = (tx: postgres.TransactionSql, personId = SONAM) =>
    tx`insert into public.profile_change_requests (person_id, requested_by, phone)
       values (${personId}, ${EMPLOYEE_ID}, '17445566') returning id, status`;

  it("can be sent by a person for themselves", async () => {
    const [request] = await as(EMPLOYEE_ID, (tx) => ask(tx));
    expect(request?.status).toBe("pending");
  });

  it("cannot be sent for someone else", async () => {
    await expect(
      rolledBack(async (tx) => {
        const other = await addPerson(tx);
        await actAs(tx, EMPLOYEE_ID);
        return ask(tx, other);
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("allow one pending request at a time", async () => {
    await expect(
      as(EMPLOYEE_ID, async (tx) => {
        await ask(tx);
        return ask(tx);
      }),
    ).rejects.toThrow(/one_pending/);
  });

  it("cannot be approved by the person who asked", async () => {
    await expect(
      as(EMPLOYEE_ID, async (tx) => {
        const [request] = await ask(tx);
        return tx`update public.profile_change_requests set status = 'approved' where id = ${request?.id}`;
      }),
    ).rejects.toThrow(/Only an admin/);
  });

  it("can be withdrawn by the person who asked", async () => {
    const [request] = await as(EMPLOYEE_ID, async (tx) => {
      const [sent] = await ask(tx);
      return tx`update public.profile_change_requests set status = 'withdrawn' where id = ${sent?.id} returning status, decided_by`;
    });
    expect(request).toMatchObject({ status: "withdrawn", decided_by: EMPLOYEE_ID });
  });

  it("are decided by an admin, once", async () => {
    const result = await rolledBack(async (tx) => {
      await actAs(tx, EMPLOYEE_ID);
      const [sent] = await ask(tx);
      await actAs(tx, ADMIN_ID);
      const [decided] = await tx`update public.profile_change_requests set status = 'approved' where id = ${sent?.id} returning status, decided_by`;
      const again = await tx`update public.profile_change_requests set status = 'declined' where id = ${sent?.id}`.catch(
        (error: Error) => error.message,
      );
      return { decided, again };
    });
    expect(result.decided).toMatchObject({ status: "approved", decided_by: ADMIN_ID });
    expect(result.again).toMatch(/already been decided/);
  });

  it("cannot be edited after they are sent", async () => {
    await expect(
      rolledBack(async (tx) => {
        await actAs(tx, EMPLOYEE_ID);
        const [sent] = await ask(tx);
        await actAs(tx, ADMIN_ID);
        return tx`update public.profile_change_requests set phone = '17000000' where id = ${sent?.id}`;
      }),
    ).rejects.toThrow(/cannot be edited/);
  });
});

describe("audit log", () => {
  it("records who did what, with before and after", async () => {
    const entries = await rolledBack(async (tx) => {
      await actAs(tx, ADMIN_ID);
      await tx`select set_config('dashteam.action', 'person.exited', true)`;
      await tx`update public.people set end_date = '2026-12-31' where id = ${SONAM}`;
      await actAs(tx, null);
      return tx`select actor_id, action, entity_table, entity_id, before ->> 'end_date' as before_end, after ->> 'end_date' as after_end
                from public.audit_log where entity_id = ${SONAM} order by id desc limit 1`;
    });
    expect(entries[0]).toMatchObject({
      actor_id: ADMIN_ID,
      action: "person.exited",
      entity_table: "people",
      entity_id: SONAM,
      before_end: null,
      after_end: "2026-12-31",
    });
  });

  it("records adding people, pay changes and decisions", async () => {
    const actions = await rolledBack(async (tx) => {
      await actAs(tx, ADMIN_ID);
      const id = await addPerson(tx);
      await tx`insert into public.pay_records (person_id, effective_from, employment_type, stipend_ch) values (${id}, '2099-01-01', 'intern', 2500000)`;
      await actAs(tx, EMPLOYEE_ID);
      const [sent] = await tx`insert into public.profile_change_requests (person_id, requested_by, phone) values (${SONAM}, ${EMPLOYEE_ID}, '17445566') returning id`;
      await actAs(tx, ADMIN_ID);
      await tx`update public.profile_change_requests set status = 'declined' where id = ${sent?.id}`;
      await actAs(tx, null);
      return tx`select action from public.audit_log where transaction_id = txid_current() order by id`;
    });
    expect(actions.map((row) => row.action)).toEqual([
      "people.insert",
      "pay_records.insert",
      "pay_records.insert",
      "profile_change_requests.insert",
      "profile_change_requests.update",
    ]);
  });

  it("cannot be changed or removed, even by the database owner", async () => {
    await expect(rolledBack((tx) => tx`update public.audit_log set action = 'x'`)).rejects.toThrow(/cannot be changed/);
    await expect(rolledBack((tx) => tx`delete from public.audit_log`)).rejects.toThrow(/cannot be changed/);
    await expect(rolledBack((tx) => tx`truncate public.audit_log`)).rejects.toThrow(/cannot be changed/);
  });

  it("is hidden from employees", async () => {
    expect(await as(EMPLOYEE_ID, (tx) => tx`select id from public.audit_log`)).toHaveLength(0);
  });

  it("records when a TPN or account is shown in full", async () => {
    const [entry] = await as(ADMIN_ID, async (tx) => {
      await tx`select public.record_reveal(${SONAM}, 'tpn')`;
      return tx`select action, after ->> 'field' as field from public.audit_log where transaction_id = txid_current()`;
    });
    expect(entry).toMatchObject({ action: "sensitive.revealed", field: "tpn" });
  });
});

describe("access after leaving", () => {
  it("ends the day after the last working day", async () => {
    const result = await rolledBack(async (tx) => {
      await tx`update public.people set end_date = public.thimphu_today() - 1 where id = ${SONAM}`;
      await actAs(tx, EMPLOYEE_ID);
      return {
        access: (await tx`select public.has_access() as value`)[0]?.value,
        people: await tx`select id from public.people`,
        pay: await tx`select id from public.pay_records`,
      };
    });
    expect(result).toEqual({ access: false, people: [], pay: [] });
  });

  it("lasts through the last working day itself", async () => {
    const access = await rolledBack(async (tx) => {
      await tx`update public.people set end_date = public.thimphu_today() where id = ${SONAM}`;
      await actAs(tx, EMPLOYEE_ID);
      return (await tx`select public.has_access() as value`)[0]?.value;
    });
    expect(access).toBe(true);
  });

  it("keeps the record visible to the admin", async () => {
    const rows = await rolledBack(async (tx) => {
      await tx`update public.people set end_date = public.thimphu_today() - 1 where id = ${SONAM}`;
      await actAs(tx, ADMIN_ID);
      return tx`select id from public.people where id = ${SONAM}`;
    });
    expect(rows).toHaveLength(1);
  });

  it("removes admin rights from an admin whose employment has ended", async () => {
    const isAdmin = await rolledBack(async (tx) => {
      const id = await addPerson(tx, { profileId: ADMIN_ID });
      await tx`update public.people set end_date = public.thimphu_today() - 1 where id = ${id}`;
      await actAs(tx, ADMIN_ID);
      return (await tx`select public.is_admin() as value`)[0]?.value;
    });
    expect(isAdmin).toBe(false);
  });
});

describe("undo", () => {
  it("reverts a pay change and records the undo", async () => {
    const effectiveFrom = await thisMonth();
    const { result: record, transactionId } = await committedAs(ADMIN_ID, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
        values (${SONAM}, ${effectiveFrom}, 'full_time', 4400000, 500000) returning id`;
      return row;
    });
    await committedAs(ADMIN_ID, (tx) => tx`select public.undo_transaction(${transactionId})`);
    expect(await sql`select id from public.pay_records where id = ${record?.id ?? ""}`).toHaveLength(0);
    const [entry] = await sql`select action from public.audit_log where entity_id = ${record?.id ?? ""} order by id desc limit 1`;
    expect(entry?.action).toBe("undo");
  });

  it("puts an approved request and the person's details back", async () => {
    const person = await sql.begin(async (tx) => addPerson(tx, { email: uniqueEmail("undo") }));
    created.push(person);
    const { result: requestId } = await committedAs(ADMIN_ID, async (tx) => {
      // The admin records the request on the person's behalf here; the request flow itself is tested above.
      await actAs(tx, null);
      const [request] = await tx<{ id: string }[]>`
        insert into public.profile_change_requests (person_id, requested_by, phone) values (${person}, ${EMPLOYEE_ID}, '17445566') returning id`;
      return request?.id ?? "";
    });
    const { transactionId } = await committedAs(ADMIN_ID, async (tx) => {
      await tx`update public.profile_change_requests set status = 'approved' where id = ${requestId}`;
      await tx`update public.people set phone = '17445566' where id = ${person}`;
    });
    await committedAs(ADMIN_ID, (tx) => tx`select public.undo_transaction(${transactionId})`);
    const [after] = await sql`select p.phone, r.status from public.people p join public.profile_change_requests r on r.person_id = p.id where p.id = ${person}`;
    expect(after).toMatchObject({ phone: null, status: "pending" });
  });

  it("is refused for someone else's change", async () => {
    const effectiveFrom = await thisMonth();
    const { transactionId } = await committedAs(ADMIN_ID, (tx) =>
      tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
         values (${SONAM}, ${effectiveFrom}, 'full_time', 4400000, 500000) on conflict do nothing`,
    );
    await expect(committedAs(EMPLOYEE_ID, (tx) => tx`select public.undo_transaction(${transactionId})`)).rejects.toThrow(
      /no longer available/,
    );
    await committedAs(ADMIN_ID, (tx) => tx`select public.undo_transaction(${transactionId})`);
  });

  it("is refused once the record has changed since", async () => {
    const person = await sql.begin(async (tx) => addPerson(tx, { email: uniqueEmail("later") }));
    created.push(person);
    const { transactionId } = await committedAs(ADMIN_ID, (tx) => tx`update public.people set phone = '17111111' where id = ${person}`);
    await committedAs(ADMIN_ID, (tx) => tx`update public.people set phone = '17222222' where id = ${person}`);
    await expect(committedAs(ADMIN_ID, (tx) => tx`select public.undo_transaction(${transactionId})`)).rejects.toThrow(/changed since/);
  });
});
