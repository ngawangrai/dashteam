import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ADMIN_ID, EMPLOYEE_ID, SEEDED_EMPLOYEE_PERSON_ID as SONAM, actAs, as, rolledBack } from "./local-db";
import { JANUARY, lockJanuary } from "./locking";

// The IT-1(a) schedule, filing records, receipts and reminders in the database. Every test rolls back.

async function schedule(tx: postgres.TransactionSql, runId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.it1a_schedules (run_id, month, rows, totals, xls, xls_sha256)
    values (${runId}, ${JANUARY}, '[{"name":"Sonam"}]', '{"total":99}', '\\xd0cf11e0'::bytea, 'abc') returning id`;
  return row?.id ?? "";
}

async function receipt(tx: postgres.TransactionSql, runId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.filing_receipts (run_id, filename, content_type, bytes) values (${runId}, 'receipt.pdf', 'application/pdf', '\\x25504446'::bytea) returning id`;
  return row?.id ?? "";
}

async function filing(tx: postgres.TransactionSql, runId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`insert into public.filings (run_id, month) values (${runId}, ${JANUARY}) returning id`;
  return row?.id ?? "";
}

async function refused(tx: postgres.TransactionSql, change: (sp: postgres.TransactionSql) => Promise<unknown>): Promise<string> {
  try {
    await tx.savepoint((sp) => change(sp));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the database to refuse this");
}

describe("the schedule and receipts never change", () => {
  it("refuses updating, removing or emptying them, even as the owner or through Undo", async () => {
    const refusals = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const scheduleId = await schedule(tx, runId);
      const receiptId = await receipt(tx, runId);
      return [
        await refused(tx, (sp) => sp`update public.it1a_schedules set totals = '{}' where id = ${scheduleId}`),
        await refused(tx, (sp) => sp`delete from public.it1a_schedules where id = ${scheduleId}`),
        await refused(tx, (sp) => sp`truncate public.it1a_schedules`),
        await refused(tx, async (sp) => {
          await sp`select set_config('dashteam.undoing', 'on', true)`;
          return sp`delete from public.it1a_schedules where id = ${scheduleId}`;
        }),
        await refused(tx, (sp) => sp`update public.filing_receipts set filename = 'x' where id = ${receiptId}`),
        await refused(tx, (sp) => sp`delete from public.filing_receipts where id = ${receiptId}`),
      ];
    });
    for (const refusal of refusals.slice(0, 4)) expect(refusal).toMatch(/never changes|can’t be emptied/);
    for (const refusal of refusals.slice(4)) expect(refusal).toMatch(/kept as it was saved/);
  });

  it("is made only for a locked month", async () => {
    await expect(
      rolledBack(async (tx) => {
        const [run] = await tx<{ id: string }[]>`insert into public.payroll_runs (month) values ('2030-03-01') returning id`;
        await tx`insert into public.it1a_schedules (run_id, month, rows, totals, xls, xls_sha256) values (${run?.id ?? ""}, '2030-03-01', '[]', '{}', '\\x00'::bytea, 'abc')`;
      }),
    ).rejects.toThrow(/only for a locked month/);
  });

  it("stays exactly as made when the person, their pay or the rules change", async () => {
    const same = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await schedule(tx, runId);
      const [before] = await tx`select rows, totals, xls, xls_sha256 from public.it1a_schedules where id = ${id}`;
      await tx`update public.people set full_name = 'Sonam Renamed' where id = ${SONAM}`;
      await tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch) values (${SONAM}, '2030-02-01', 'full_time', 9000000, 0)`;
      await tx`insert into public.rules (key, employment_type, effective_from, value, note) values ('it1a_inclusion', 'intern', '2030-02-01', '{"include": false}', 'test')`;
      const [after] = await tx`select rows, totals, xls, xls_sha256 from public.it1a_schedules where id = ${id}`;
      return JSON.stringify(before) === JSON.stringify(after);
    });
    expect(same).toBe(true);
  });
});

describe("the filing record", () => {
  it("can be marked filed with a reference and a number or a receipt, and edited", async () => {
    const result = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await filing(tx, runId);
      await actAs(tx, ADMIN_ID);
      const missing = await refused(tx, (sp) => sp`update public.filings set filed_on = '2030-02-08', payment_reference = 'PAY-1' where id = ${id}`);
      await tx`update public.filings set filed_on = '2030-02-08', payment_reference = 'PAY-1', acknowledgement_number = 'ACK-1' where id = ${id}`;
      const receiptId = await receipt(tx, runId);
      await tx`update public.filings set receipt_id = ${receiptId}, acknowledgement_number = null where id = ${id}`;
      const [row] = await tx`select filed_on::text, payment_reference, acknowledgement_number, receipt_id, updated_by from public.filings where id = ${id}`;
      return { missing, row, receiptId };
    });
    expect(result.missing).toMatch(/filings_filed_complete/);
    expect(result.row).toEqual({ filed_on: "2030-02-08", payment_reference: "PAY-1", acknowledgement_number: null, receipt_id: result.receiptId, updated_by: ADMIN_ID });
  });

  it("is never removed, and stays with its month", async () => {
    const refusals = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await filing(tx, runId);
      return [
        await refused(tx, (sp) => sp`delete from public.filings where id = ${id}`),
        await refused(tx, (sp) => sp`update public.filings set month = '2030-02-01' where id = ${id}`),
      ];
    });
    expect(refusals[0]).toMatch(/kept/);
    expect(refusals[1]).toMatch(/stays with its month/);
  });

  it("only takes a receipt from its own month", async () => {
    await expect(
      rolledBack(async (tx) => {
        const runId = await lockJanuary(tx);
        const id = await filing(tx, runId);
        const [other] = await tx<{ id: string }[]>`insert into public.payroll_runs (month) values ('2030-03-01') returning id`;
        const elsewhere = await receipt(tx, other?.id ?? "");
        return tx`update public.filings set receipt_id = ${elsewhere} where id = ${id}`;
      }),
    ).rejects.toThrow(/another month/);
  });
});

describe("reminders", () => {
  it("are recorded at most once a day", async () => {
    const result = await rolledBack(async (tx) => {
      await tx`insert into public.filing_reminders (sent_on, months, recipients) values ('2030-02-05', '["2030-01"]', '{admin@dashteam.local}')`;
      const second = await tx`insert into public.filing_reminders (sent_on, months, recipients) values ('2030-02-05', '["2030-01"]', '{admin@dashteam.local}') on conflict (sent_on) do nothing returning id`;
      const [count] = await tx`select count(*)::int as n from public.filing_reminders where sent_on = '2030-02-05'`;
      return { second: second.length, count: count?.n };
    });
    expect(result).toEqual({ second: 0, count: 1 });
  });

  it("go to admins with access", async () => {
    const emails = await rolledBack(async (tx) => (await tx`select public.admin_emails() as email`).map((row) => row.email));
    expect(emails).toEqual(["admin@dashteam.local"]);
  });

  it("can't be written or read by an employee, or listed through the API", async () => {
    await expect(as(EMPLOYEE_ID, (tx) => tx`insert into public.filing_reminders (sent_on, months, recipients) values ('2030-02-06', '[]', '{}')`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN_ID, (tx) => tx`select public.admin_emails()`)).rejects.toThrow(/permission denied/);
  });
});

describe("who can see filing", () => {
  it("is admins only", async () => {
    const seen = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      await schedule(tx, runId);
      await filing(tx, runId);
      await receipt(tx, runId);
      await actAs(tx, EMPLOYEE_ID);
      return {
        schedules: (await tx`select id from public.it1a_schedules`).length,
        filings: (await tx`select id from public.filings`).length,
        receipts: (await tx`select id from public.filing_receipts`).length,
      };
    });
    expect(seen).toEqual({ schedules: 0, filings: 0, receipts: 0 });
  });
});

describe("audit", () => {
  it("records making the schedule (without the file), marking as filed, editing, receipts and downloads", async () => {
    const actions = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      await actAs(tx, ADMIN_ID);
      await tx`select set_config('dashteam.action', 'filing.schedule_made', true)`;
      const scheduleId = await schedule(tx, runId);
      const id = await filing(tx, runId);
      await tx`select set_config('dashteam.action', 'filing.marked_filed', true)`;
      await tx`update public.filings set filed_on = '2030-02-08', payment_reference = 'PAY-1', acknowledgement_number = 'ACK-1' where id = ${id}`;
      await tx`select set_config('dashteam.action', 'filing.receipt_added', true)`;
      const receiptId = await receipt(tx, runId);
      await tx`select set_config('dashteam.action', 'filing.edited', true)`;
      await tx`update public.filings set payment_reference = 'PAY-2', receipt_id = ${receiptId} where id = ${id}`;
      await tx`select public.record_filing_download('schedule', ${scheduleId})`;
      await tx`select public.record_filing_download('receipt', ${receiptId})`;
      await actAs(tx, null);
      return tx<{ action: string; entity_table: string; leaked: boolean }[]>`
        select action, entity_table, coalesce(after ? 'xls' or after ? 'bytes', false) as leaked from public.audit_log
        where transaction_id = txid_current() and entity_table in ('it1a_schedules', 'filings', 'filing_receipts') order by id`;
    });
    expect(actions.map((row) => `${row.action}:${row.entity_table}`)).toEqual([
      "filing.schedule_made:it1a_schedules",
      "filing.schedule_made:filings",
      "filing.marked_filed:filings",
      "filing.receipt_added:filing_receipts",
      "filing.edited:filings",
      "filing.schedule_downloaded:it1a_schedules",
      "filing.receipt_downloaded:filing_receipts",
    ]);
    expect(actions.some((row) => row.leaked)).toBe(false);
  });

  it("counts downloads and reveals as reads, which Undo ignores, and everything else as a change", async () => {
    const rows = await rolledBack((tx) =>
      tx`select action, public.audit_records_a_change(action) as change
         from unnest(array['filing.schedule_downloaded', 'filing.receipt_downloaded', 'payslip.downloaded', 'payroll.bank_list_downloaded',
                           'sensitive.revealed', 'filing.edited', 'filing.marked_filed', 'leave.approved']) as action`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.action, row.change]))).toEqual({
      "filing.schedule_downloaded": false,
      "filing.receipt_downloaded": false,
      "payslip.downloaded": false,
      "payroll.bank_list_downloaded": false,
      "sensitive.revealed": false,
      "filing.edited": true,
      "filing.marked_filed": true,
      "leave.approved": true,
    });
  });
});
