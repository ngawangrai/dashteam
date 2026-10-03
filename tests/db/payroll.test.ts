import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ADMIN_ID, EMPLOYEE_ID, SEEDED_EMPLOYEE_PERSON_ID as SONAM, actAs, as, rolledBack, uniqueEmail } from "./local-db";

// Locked payroll months in the database. A committed lock is permanent, so every test here runs
// in a transaction that is rolled back, and uses months in 2030 that nothing else touches.

const JANUARY = "2030-01-01";
const FEBRUARY = "2030-02-01";

/** Sets the first payroll month the way the Payroll screen does: settings for both types, from this month. */
async function setFirstMonth(tx: postgres.TransactionSql, firstMonth: string | null) {
  await tx`delete from public.rules where key = 'payroll_settings' and effective_from = date_trunc('month', public.thimphu_today())::date`;
  const value = { first_month: firstMonth, large_change_bp: 1000, due_day: 10 };
  for (const type of ["full_time", "intern"]) {
    await tx`insert into public.rules (key, employment_type, effective_from, value, note)
             values ('payroll_settings', ${type}, date_trunc('month', public.thimphu_today())::date, ${tx.json(value)}, 'test')`;
  }
}

/** Opens a draft run for the month and returns its id. */
async function openRun(tx: postgres.TransactionSql, month: string): Promise<string> {
  await tx`insert into public.payroll_runs (month) values (${month}) on conflict (month) do nothing`;
  const [run] = await tx<{ id: string }[]>`select id from public.payroll_runs where month = ${month}`;
  return run?.id ?? "";
}

/** Writes a snapshot for everyone employed in the month (figures don't matter here). */
async function snapshotEveryone(tx: postgres.TransactionSql, runId: string, month: string) {
  await tx`
    insert into public.payroll_snapshots (run_id, person_id, full_name, email, employment_type, person, inputs, result, rule_ids,
      gross_ch, health_contribution_ch, provident_fund_ch, gis_ch, tds_ch, recoveries_ch, take_home_ch)
    select ${runId}, p.id, p.full_name, p.email, 'full_time', '{}', '{}', '{"takeHome": 100}', '{}', 100, 1, 0, 0, 0, 0, 99
    from public.people p
    where p.start_date <= (${month}::date + interval '1 month - 1 day')::date
      and (p.end_date is null or p.end_date >= ${month}::date)`;
}

const lockUpdate = (tx: postgres.TransactionSql, runId: string) =>
  tx`update public.payroll_runs
     set status = 'locked', people_count = 0, gross_ch = 0, health_contribution_ch = 0, provident_fund_ch = 0, gis_ch = 0,
         tds_ch = 0, recoveries_ch = 0, take_home_ch = 0, remit_ch = 0, due_date = '2030-02-10', rule_ids = '{}'
     where id = ${runId} and status = 'draft'
     returning id`;

/** The whole lock: draft, snapshots, then locked. Returns the run id. */
async function lockMonth(tx: postgres.TransactionSql, month: string): Promise<string> {
  const runId = await openRun(tx, month);
  await snapshotEveryone(tx, runId, month);
  await lockUpdate(tx, runId);
  return runId;
}

async function frozen(tx: postgres.TransactionSql, runId: string) {
  const [run] = await tx`select * from public.payroll_runs where id = ${runId}`;
  const snapshots = await tx`select * from public.payroll_snapshots where run_id = ${runId} order by person_id`;
  return { run, snapshots };
}

/** Runs `change` in a savepoint, expects the database to refuse it, and returns the refusal. */
async function refused(tx: postgres.TransactionSql, change: (sp: postgres.TransactionSql) => Promise<unknown>): Promise<string> {
  try {
    await tx.savepoint((sp) => change(sp));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the database to refuse this change");
}

describe("locking a month", () => {
  it("locks, with a snapshot for everyone employed that month", async () => {
    const result = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      const runId = await lockMonth(tx, JANUARY);
      const { run, snapshots } = await frozen(tx, runId);
      const [employed] = await tx`select count(*)::int as n from public.people where start_date <= '2030-01-31' and (end_date is null or end_date >= '2030-01-01')`;
      return { status: run?.status, lockedAt: run?.locked_at, snapshots: snapshots.length, employed: employed?.n };
    });
    expect(result.status).toBe("locked");
    expect(result.lockedAt).toBeInstanceOf(Date);
    expect(result.snapshots).toBe(result.employed);
    expect(result.snapshots).toBeGreaterThan(0);
  });

  it("refuses to lock without a snapshot for everyone", async () => {
    await expect(
      rolledBack(async (tx) => {
        await setFirstMonth(tx, JANUARY);
        return lockUpdate(tx, await openRun(tx, JANUARY));
      }),
    ).rejects.toThrow(/needs a snapshot/);
  });

  it("refuses before the first month is set, and before the first month", async () => {
    await expect(rolledBack(async (tx) => lockMonth(tx, JANUARY))).rejects.toThrow(/Choose the first month/);
    await expect(
      rolledBack(async (tx) => {
        await setFirstMonth(tx, FEBRUARY);
        return lockMonth(tx, JANUARY);
      }),
    ).rejects.toThrow(/DashTeam pays from February 2030/);
  });

  it("locks months in order only", async () => {
    await expect(
      rolledBack(async (tx) => {
        await setFirstMonth(tx, JANUARY);
        return lockMonth(tx, FEBRUARY);
      }),
    ).rejects.toThrow(/Months lock in order. Lock January 2030 first/);

    const locked = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      await lockMonth(tx, JANUARY);
      await lockMonth(tx, FEBRUARY);
      return tx`select month::text from public.payroll_runs where status = 'locked' and month >= ${JANUARY} order by month`;
    });
    expect(locked.map((row) => row.month)).toEqual([JANUARY, FEBRUARY]);
  });

  it("has no effect when locking twice", async () => {
    const result = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      const runId = await lockMonth(tx, JANUARY);
      const before = await frozen(tx, runId);
      const again = await lockUpdate(tx, runId);
      return { again: again.length, same: JSON.stringify(await frozen(tx, runId)) === JSON.stringify(before) };
    });
    expect(result).toEqual({ again: 0, same: true });
  });
});

describe("a locked run can't change", () => {
  it("refuses any update, delete or emptying, even by the database owner, and even as Undo", async () => {
    const result = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      const runId = await lockMonth(tx, JANUARY);
      const before = await frozen(tx, runId);
      const refusals = [
        await refused(tx, (sp) => sp`update public.payroll_runs set status = 'draft' where id = ${runId}`),
        await refused(tx, (sp) => sp`update public.payroll_runs set gross_ch = 1 where id = ${runId}`),
        await refused(tx, (sp) => sp`delete from public.payroll_runs where id = ${runId}`),
        await refused(tx, (sp) => sp`truncate public.payroll_runs cascade`),
        await refused(tx, (sp) => sp`update public.payroll_snapshots set take_home_ch = 1 where run_id = ${runId}`),
        await refused(tx, (sp) => sp`delete from public.payroll_snapshots where run_id = ${runId}`),
        await refused(tx, (sp) => sp`truncate public.payroll_snapshots`),
        await refused(tx, async (sp) => {
          await sp`select set_config('dashteam.undoing', 'on', true)`;
          return sp`update public.payroll_runs set status = 'draft' where id = ${runId}`;
        }),
      ];
      return { refusals, same: JSON.stringify(await frozen(tx, runId)) === JSON.stringify(before) };
    });
    expect(result.refusals[0]).toMatch(/January 2030 payroll is locked. \[payroll_locked:2030-01:2030-02\]/);
    expect(result.refusals[2]).toMatch(/never removed/);
    expect(result.refusals[3]).toMatch(/can’t be emptied/);
    expect(result.refusals[4]).toMatch(/never change/);
    expect(result.refusals[7]).toMatch(/payroll is locked/);
    expect(result.same).toBe(true);
  });

  it("refuses a snapshot added to it later", async () => {
    await expect(
      rolledBack(async (tx) => {
        await setFirstMonth(tx, JANUARY);
        const runId = await lockMonth(tx, JANUARY);
        const [person] = await tx<{ id: string }[]>`insert into public.people (full_name, email, start_date) values ('Late', ${uniqueEmail("late")}, '2031-01-06') returning id`;
        return tx`insert into public.payroll_snapshots (run_id, person_id, full_name, email, employment_type, person, inputs, result, rule_ids,
                    gross_ch, health_contribution_ch, provident_fund_ch, gis_ch, tds_ch, recoveries_ch, take_home_ch)
                  values (${runId}, ${person?.id ?? ""}, 'Late', 'late@x', 'full_time', '{}', '{}', '{}', '{}', 0, 0, 0, 0, 0, 0, 0)`;
      }),
    ).rejects.toThrow(/payroll is locked/);
  });

  it("refuses adding or removing one-off lines and acknowledgements in a locked month", async () => {
    const refusals = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      const [lineRow] = await tx<{ id: string }[]>`insert into public.payroll_lines (month, person_id, kind, amount_ch) values (${JANUARY}, ${SONAM}, 'bonus', 100) returning id`;
      const [ack] = await tx<{ id: string }[]>`insert into public.payroll_acknowledgements (month, check_key) values (${JANUARY}, 'missing_tpn:x') returning id`;
      await lockMonth(tx, JANUARY);
      return [
        await refused(tx, (sp) => sp`insert into public.payroll_lines (month, person_id, kind, amount_ch) values (${JANUARY}, ${SONAM}, 'bonus', 100)`),
        await refused(tx, (sp) => sp`delete from public.payroll_lines where id = ${lineRow?.id ?? ""}`),
        await refused(tx, (sp) => sp`insert into public.payroll_acknowledgements (month, check_key) values (${JANUARY}, 'another')`),
        await refused(tx, (sp) => sp`delete from public.payroll_acknowledgements where id = ${ack?.id ?? ""}`),
      ];
    });
    for (const refusal of refusals) expect(refusal).toMatch(/January 2030 payroll is locked/);
  });
});

describe("nothing a locked month used can change", () => {
  it("refuses leave, holidays, pay, dates and rules dated into it, and leaves the snapshot as it was", async () => {
    const result = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      const [pending] = await tx<{ id: string }[]>`
        insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
        values (${SONAM}, 'annual', '2030-01-14', '2030-01-15', 'pending', ${EMPLOYEE_ID}) returning id`;
      const [approved] = await tx<{ id: string }[]>`
        insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
        values (${SONAM}, 'unpaid', '2030-01-21', '2030-01-21', 'approved', ${ADMIN_ID}) returning id`;
      const [holiday] = await tx<{ id: string }[]>`
        insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
        values ('Test lock holiday', '2030-01-24', '2030-01-24', 2030, 'one_off', 'national', 'tentative', 'test') returning id`;
      const runId = await lockMonth(tx, JANUARY);
      const before = await frozen(tx, runId);

      const refusals = {
        newLeave: await refused(tx, (sp) => sp`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
                                                values (${SONAM}, 'annual', '2030-01-28', '2030-01-28', 'pending', ${EMPLOYEE_ID})`),
        leaveIntoNextMonth: await refused(tx, (sp) => sp`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
                                                values (${SONAM}, 'annual', '2030-01-31', '2030-02-01', 'pending', ${EMPLOYEE_ID})`),
        approve: await refused(tx, (sp) => sp`update public.leave_requests set status = 'approved' where id = ${pending?.id ?? ""}`),
        cancelApproved: await refused(tx, (sp) => sp`update public.leave_requests set status = 'cancelled' where id = ${approved?.id ?? ""}`),
        undoApproval: await refused(tx, async (sp) => {
          await sp`select set_config('dashteam.undoing', 'on', true)`;
          return sp`update public.leave_requests set status = 'pending' where id = ${approved?.id ?? ""}`;
        }),
        addHoliday: await refused(tx, (sp) => sp`insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
                                                 values ('Another', '2030-01-29', '2030-01-29', 2030, 'one_off', 'national', 'confirmed', 'test')`),
        moveHoliday: await refused(tx, (sp) => sp`update public.holidays set start_date = '2030-02-04', end_date = '2030-02-04' where id = ${holiday?.id ?? ""}`),
        removeHoliday: await refused(tx, (sp) => sp`delete from public.holidays where id = ${holiday?.id ?? ""}`),
        payIntoMonth: await refused(tx, (sp) => sp`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
                                                   values (${SONAM}, ${JANUARY}, 'full_time', 1, 0)`),
        exitInMonth: await refused(tx, (sp) => sp`update public.people set end_date = '2030-01-20' where id = ${SONAM}`),
        startBefore: await refused(tx, (sp) => sp`insert into public.people (full_name, email, start_date) values ('Back-dated', ${uniqueEmail("back")}, '2029-06-03')`),
        ruleIntoMonth: await refused(tx, (sp) => sp`insert into public.rules (key, employment_type, effective_from, value, note)
                                                    values ('gis', 'full_time', ${JANUARY}, '{"amount_ch": 0}', 'test')`),
        firstMonthChange: await refused(tx, (sp) => sp`insert into public.rules (key, employment_type, effective_from, value, note)
                                                       values ('payroll_settings', 'full_time', ${FEBRUARY}, '{"first_month": "2029-12-01", "large_change_bp": 1000, "due_day": 10}', 'test')`),
      };
      return { refusals, same: JSON.stringify(await frozen(tx, runId)) === JSON.stringify(before) };
    });

    for (const [change, refusal] of Object.entries(result.refusals)) {
      if (change === "firstMonthChange") expect(refusal).toMatch(/first payroll month can’t change/);
      else expect(refusal, change).toMatch(/January 2030 payroll is locked/);
    }
    expect(result.same).toBe(true);
  });

  it("still allows what the locked month didn't use", async () => {
    const allowed = await rolledBack(async (tx) => {
      await setFirstMonth(tx, JANUARY);
      const [pending] = await tx<{ id: string }[]>`
        insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
        values (${SONAM}, 'annual', '2030-01-14', '2030-01-15', 'pending', ${EMPLOYEE_ID}) returning id`;
      const [tentative] = await tx<{ id: string }[]>`
        insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
        values ('Test lock holiday', '2030-01-24', '2030-01-24', 2030, 'one_off', 'national', 'tentative', 'test') returning id`;
      await lockMonth(tx, JANUARY);
      await actAs(tx, ADMIN_ID);
      // A pending request was never paid as taken, so declining it changes nothing January used.
      await tx`update public.leave_requests set status = 'declined' where id = ${pending?.id ?? ""}`;
      // Confirming a tentative date changes its label, not a count.
      await tx`update public.holidays set status = 'confirmed' where id = ${tentative?.id ?? ""}`;
      // February is still open.
      await tx`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
               values (${SONAM}, 'annual', '2030-02-04', '2030-02-04', 'pending', ${EMPLOYEE_ID})`;
      await tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
               values (${SONAM}, ${FEBRUARY}, 'full_time', 4_500_000, 500_000)`;
      await tx`update public.people set end_date = '2030-02-20' where id = ${SONAM}`;
      await tx`insert into public.people (full_name, email, start_date) values ('Joins later', ${uniqueEmail("later")}, '2030-02-03')`;
      await tx`insert into public.payroll_lines (month, person_id, kind, amount_ch) values (${FEBRUARY}, ${SONAM}, 'arrear', 100)`;
      await tx`insert into public.rules (key, employment_type, effective_from, value, note)
               values ('payroll_settings', 'full_time', ${FEBRUARY}, '{"first_month": "2030-01-01", "large_change_bp": 2000, "due_day": 10}', 'test')`;
      return true;
    });
    expect(allowed).toBe(true);
  });
});

describe("who can see and write payroll", () => {
  it("is admins only", async () => {
    const employee = await as(EMPLOYEE_ID, async (tx) => ({
      runs: (await tx`select id from public.payroll_runs`).length,
      lines: (await tx`select id from public.payroll_lines`).length,
      snapshots: (await tx`select id from public.payroll_snapshots`).length,
      acknowledgements: (await tx`select id from public.payroll_acknowledgements`).length,
    }));
    expect(employee).toEqual({ runs: 0, lines: 0, snapshots: 0, acknowledgements: 0 });
    await expect(
      as(EMPLOYEE_ID, (tx) => tx`insert into public.payroll_lines (month, person_id, kind, amount_ch) values (${FEBRUARY}, ${SONAM}, 'bonus', 100)`),
    ).rejects.toThrow(/row-level security/);
    await expect(as(EMPLOYEE_ID, (tx) => tx`insert into public.payroll_runs (month) values (${FEBRUARY})`)).rejects.toThrow(/row-level security/);
    await expect(as(null, (tx) => tx`select id from public.payroll_runs`)).rejects.toThrow(/permission denied/);
  });

  it("lets an admin add and remove lines in a draft month", async () => {
    const removed = await as(ADMIN_ID, async (tx) => {
      const [row] = await tx<{ id: string }[]>`insert into public.payroll_lines (month, person_id, kind, amount_ch, note) values (${FEBRUARY}, ${SONAM}, 'bonus', 100, 'Festival') returning id`;
      return tx`delete from public.payroll_lines where id = ${row?.id ?? ""} returning id`;
    });
    expect(removed).toHaveLength(1);
  });

  it("refuses an employee's leave in a locked month even though they can't see payroll", async () => {
    await expect(
      rolledBack(async (tx) => {
        await setFirstMonth(tx, JANUARY);
        await lockMonth(tx, JANUARY);
        await actAs(tx, EMPLOYEE_ID);
        return tx`insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
                  values (${SONAM}, 'annual', '2030-01-28', '2030-01-28', 'pending', ${EMPLOYEE_ID})`;
      }),
    ).rejects.toThrow(/January 2030 payroll is locked/);
  });
});

describe("audit", () => {
  it("records every line, acknowledgement, lock and bank list download", async () => {
    const actions = await rolledBack(async (tx) => {
      await actAs(tx, ADMIN_ID);
      await setFirstMonth(tx, JANUARY);
      await tx`select set_config('dashteam.action', 'payroll.line_added', true)`;
      await tx`insert into public.payroll_lines (month, person_id, kind, amount_ch) values (${JANUARY}, ${SONAM}, 'arrear', 100)`;
      await tx`select set_config('dashteam.action', 'payroll.acknowledged', true)`;
      await tx`insert into public.payroll_acknowledgements (month, check_key) values (${JANUARY}, 'missing_tpn:x')`;
      await tx`select set_config('dashteam.action', 'payroll.locked', true)`;
      const runId = await lockMonth(tx, JANUARY);
      await tx`select public.record_bank_list_download(${runId})`;
      await actAs(tx, null);
      return tx`select action, entity_table, actor_id from public.audit_log where transaction_id = txid_current() and entity_table <> 'rules' order by id`;
    });
    const labelled = actions.map((row) => `${row.action}:${row.entity_table}`);
    expect(labelled).toContain("payroll.line_added:payroll_lines");
    expect(labelled).toContain("payroll.acknowledged:payroll_acknowledgements");
    expect(labelled).toContain("payroll.locked:payroll_runs");
    expect(labelled).toContain("payroll.locked:payroll_snapshots");
    expect(labelled.at(-1)).toBe("payroll.bank_list_downloaded:payroll_runs");
    expect(actions.every((row) => row.actor_id === ADMIN_ID)).toBe(true);
  });

  it("records the payroll settings an admin sets", async () => {
    const rows = await rolledBack(async (tx) => {
      await actAs(tx, ADMIN_ID);
      await setFirstMonth(tx, JANUARY);
      await actAs(tx, null);
      return tx`select action from public.audit_log where transaction_id = txid_current() and entity_table = 'rules' and action = 'rules.insert'`;
    });
    expect(rows).toHaveLength(2);
  });

  it("only gives the bank list for a locked month, and only to an admin", async () => {
    await expect(
      rolledBack(async (tx) => {
        await actAs(tx, ADMIN_ID);
        return tx`select public.record_bank_list_download(${await openRun(tx, FEBRUARY)})`;
      }),
    ).rejects.toThrow(/Only a locked month/);
    await expect(as(EMPLOYEE_ID, (tx) => tx`select public.record_bank_list_download(gen_random_uuid())`)).rejects.toThrow(/Not allowed/);
  });
});
