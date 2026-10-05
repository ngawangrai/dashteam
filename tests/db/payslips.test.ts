import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ADMIN_ID, EMPLOYEE_ID, SEEDED_EMPLOYEE_PERSON_ID as SONAM, actAs, as, rolledBack, uniqueEmail } from "./local-db";

// Payslips and the email outbox in the database. Locks are permanent, so everything runs in
// transactions that roll back, on months in 2030 nothing else touches.

const JANUARY = "2030-01-01";

async function lockJanuary(tx: postgres.TransactionSql): Promise<string> {
  await tx`delete from public.rules where key = 'payroll_settings' and effective_from = date_trunc('month', public.thimphu_today())::date`;
  for (const type of ["full_time", "intern"]) {
    await tx`insert into public.rules (key, employment_type, effective_from, value, note)
             values ('payroll_settings', ${type}, date_trunc('month', public.thimphu_today())::date,
                     ${tx.json({ first_month: JANUARY, large_change_bp: 1000, due_day: 10 })}, 'test')`;
  }
  const [run] = await tx<{ id: string }[]>`insert into public.payroll_runs (month) values (${JANUARY}) returning id`;
  const runId = run?.id ?? "";
  await tx`
    insert into public.payroll_snapshots (run_id, person_id, full_name, email, employment_type, person, inputs, result, rule_ids,
      gross_ch, health_contribution_ch, provident_fund_ch, gis_ch, tds_ch, recoveries_ch, take_home_ch)
    select ${runId}, p.id, p.full_name, p.email, 'full_time', '{}', '{}', '{}', '{}', 100, 1, 0, 0, 0, 0, 99
    from public.people p
    where p.start_date <= '2030-01-31' and (p.end_date is null or p.end_date >= ${JANUARY})`;
  await tx`update public.payroll_runs
           set status = 'locked', people_count = 0, gross_ch = 0, health_contribution_ch = 0, provident_fund_ch = 0, gis_ch = 0,
               tds_ch = 0, recoveries_ch = 0, take_home_ch = 0, remit_ch = 0, due_date = '2030-02-10', rule_ids = '{}'
           where id = ${runId}`;
  return runId;
}

async function issue(tx: postgres.TransactionSql, runId: string, personId: string, reference: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into public.payslips (run_id, snapshot_id, person_id, month, reference, employment_type, take_home_ch, content, pdf, pdf_sha256)
    select ${runId}, s.id, s.person_id, ${JANUARY}, ${reference}, 'full_time', s.take_home_ch, '{"takeHome": 99}', '\\x255044462d'::bytea, 'abc'
    from public.payroll_snapshots s where s.run_id = ${runId} and s.person_id = ${personId}
    returning id`;
  return row?.id ?? "";
}

async function colleague(tx: postgres.TransactionSql): Promise<string> {
  const [row] = await tx<{ id: string }[]>`insert into public.people (full_name, email, start_date) values ('Pema Choden', ${uniqueEmail("pema")}, '2025-01-06') returning id`;
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

describe("a payslip never changes", () => {
  it("can be issued only from a locked month, then never updated, removed or emptied", async () => {
    const result = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      return {
        id,
        refusals: [
          await refused(tx, (sp) => sp`update public.payslips set take_home_ch = 1 where id = ${id}`),
          await refused(tx, (sp) => sp`delete from public.payslips where id = ${id}`),
          await refused(tx, (sp) => sp`truncate public.payslips cascade`),
          await refused(tx, async (sp) => {
            await sp`select set_config('dashteam.undoing', 'on', true)`;
            return sp`delete from public.payslips where id = ${id}`;
          }),
        ],
      };
    });
    expect(result.id).not.toBe("");
    expect(result.refusals[0]).toMatch(/never changes/);
    expect(result.refusals[1]).toMatch(/never changes/);
    expect(result.refusals[2]).toMatch(/can’t be emptied/);
    expect(result.refusals[3]).toMatch(/never changes/);
  });

  it("can't be made from a month that isn't locked", async () => {
    await expect(
      rolledBack(async (tx) => {
        const runId = await lockJanuary(tx);
        await tx`set local session_replication_role = replica`;
        await tx`update public.payroll_runs set status = 'draft' where id = ${runId}`;
        await tx`set local session_replication_role = origin`;
        return issue(tx, runId, SONAM, "XS-203001-001");
      }),
    ).rejects.toThrow(/only from a locked month/);
  });

  it("stays exactly as issued when the person, their pay or the rules change later", async () => {
    const result = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      const [before] = await tx`select content, pdf, pdf_sha256, take_home_ch, reference from public.payslips where id = ${id}`;
      await tx`update public.people set full_name = 'Sonam Renamed' where id = ${SONAM}`;
      await tx`insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch) values (${SONAM}, '2030-02-01', 'full_time', 9_000_000, 0)`;
      await tx`insert into public.rules (key, employment_type, effective_from, value, note) values ('gis', 'full_time', '2030-02-01', '{"amount_ch": 100}', 'test')`;
      const [after] = await tx`select content, pdf, pdf_sha256, take_home_ch, reference from public.payslips where id = ${id}`;
      return { same: JSON.stringify(before) === JSON.stringify(after) };
    });
    expect(result.same).toBe(true);
  });
});

describe("who can see payslips", () => {
  it("shows a person only their own, and admins everyone", async () => {
    const result = await rolledBack(async (tx) => {
      const pema = await colleague(tx);
      const runId = await lockJanuary(tx);
      const own = await issue(tx, runId, SONAM, "XS-203001-001");
      const other = await issue(tx, runId, pema, "XS-203001-002");
      await actAs(tx, EMPLOYEE_ID);
      const employeeSees = (await tx`select id from public.payslips where id in (${own}, ${other})`).map((row) => row.id);
      const byGuess = await tx`select pdf from public.payslips where id = ${other}`;
      await actAs(tx, ADMIN_ID);
      const adminSees = (await tx`select id from public.payslips where id in (${own}, ${other})`).length;
      return { employeeSees, byGuess: byGuess.length, adminSees, own };
    });
    expect(result.employeeSees).toEqual([result.own]);
    expect(result.byGuess).toBe(0);
    expect(result.adminSees).toBe(2);
  });

  it("shows nothing once someone's access has ended", async () => {
    const seen = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      await issue(tx, runId, SONAM, "XS-203001-001");
      // Leaving in the past would touch the locked month, so take access away the other way.
      await tx`set local session_replication_role = replica`;
      await tx`update public.people set end_date = public.thimphu_today() - 1 where id = ${SONAM}`;
      await tx`set local session_replication_role = origin`;
      await actAs(tx, EMPLOYEE_ID);
      return tx`select id from public.payslips`;
    });
    expect(seen).toHaveLength(0);
  });

  it("lets nobody but an admin write one", async () => {
    await expect(
      rolledBack(async (tx) => {
        const runId = await lockJanuary(tx);
        const [snapshot] = await tx<{ id: string }[]>`select id from public.payroll_snapshots where run_id = ${runId} and person_id = ${SONAM}`;
        await actAs(tx, EMPLOYEE_ID);
        return tx`insert into public.payslips (run_id, snapshot_id, person_id, month, reference, employment_type, take_home_ch, content, pdf, pdf_sha256)
                  values (${runId}, ${snapshot?.id ?? ""}, ${SONAM}, ${JANUARY}, 'XS-203001-001', 'full_time', 99, '{}', '\\x00'::bytea, 'abc')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("the email outbox", () => {
  it("queues the automatic payslip email once, however often it's asked", async () => {
    const result = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      await actAs(tx, ADMIN_ID);
      const [first] = await tx`select public.queue_payslip_email(${id}, 'payslip') as id`;
      const [second] = await tx`select public.queue_payslip_email(${id}, 'payslip') as id`;
      const rows = await tx`select to_email, status from public.email_deliveries where payslip_id = ${id}`;
      return { same: first?.id === second?.id, rows };
    });
    expect(result.same).toBe(true);
    expect(result.rows).toEqual([{ to_email: "employee@dashteam.local", status: "queued" }]);
  });

  it("sends a re-send or a send-to-self once per click", async () => {
    const count = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      await actAs(tx, ADMIN_ID);
      await tx`select public.queue_payslip_email(${id}, 'payslip_resend', 'click-1')`;
      await tx`select public.queue_payslip_email(${id}, 'payslip_resend', 'click-1')`;
      await tx`select public.queue_payslip_email(${id}, 'payslip_resend', 'click-2')`;
      await actAs(tx, EMPLOYEE_ID);
      await tx`select public.queue_payslip_email(${id}, 'payslip_self', 'tap-1')`;
      await actAs(tx, ADMIN_ID);
      const [row] = await tx`select count(*)::int as n from public.email_deliveries where payslip_id = ${id}`;
      return row?.n;
    });
    expect(count).toBe(3);
  });

  it("lets a person email only their own payslip, and only to themselves", async () => {
    const refusals = await rolledBack(async (tx) => {
      const pema = await colleague(tx);
      const runId = await lockJanuary(tx);
      const own = await issue(tx, runId, SONAM, "XS-203001-001");
      const other = await issue(tx, runId, pema, "XS-203001-002");
      await actAs(tx, EMPLOYEE_ID);
      return [
        await refused(tx, (sp) => sp`select public.queue_payslip_email(${other}, 'payslip_self')`),
        await refused(tx, (sp) => sp`select public.queue_payslip_email(${own}, 'payslip')`),
        await refused(tx, (sp) => sp`insert into public.email_deliveries (kind, payslip_id, to_email) values ('payslip_self', ${own}, 'me@elsewhere.example')`),
      ];
    });
    expect(refusals[0]).toMatch(/Not allowed/);
    expect(refusals[1]).toMatch(/Not allowed/);
    expect(refusals[2]).toMatch(/permission denied/);
  });

  it("claims an email once, keeps a sent one final, and never removes one", async () => {
    const result = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      await actAs(tx, ADMIN_ID);
      const [delivery] = await tx<{ id: string }[]>`select public.queue_payslip_email(${id}, 'payslip') as id`;
      const deliveryId = delivery?.id ?? "";
      const first = await tx`select id from public.claim_email_delivery(${deliveryId})`;
      const second = await tx`select id from public.claim_email_delivery(${deliveryId})`;
      await tx`select public.finish_email_delivery(${deliveryId}, 'sent', 'provider-1')`;
      const afterSent = await tx`select id from public.claim_email_delivery(${deliveryId})`;
      await actAs(tx, null);
      return {
        first: first.length,
        second: second.length,
        afterSent: afterSent.length,
        changeSent: await refused(tx, (sp) => sp`update public.email_deliveries set status = 'queued' where id = ${deliveryId}`),
        remove: await refused(tx, (sp) => sp`delete from public.email_deliveries where id = ${deliveryId}`),
        readdress: await refused(tx, (sp) => sp`update public.email_deliveries set to_email = 'x@y.z' where id = ${deliveryId}`),
      };
    });
    expect(result).toMatchObject({ first: 1, second: 0, afterSent: 0 });
    expect(result.changeSent).toMatch(/already sent/);
    expect(result.remove).toMatch(/kept/);
    expect(result.readdress).toMatch(/already sent/);
  });

  it("can retry a failed email, and reclaim one whose send died part way", async () => {
    const result = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      await actAs(tx, ADMIN_ID);
      const [delivery] = await tx<{ id: string }[]>`select public.queue_payslip_email(${id}, 'payslip') as id`;
      const deliveryId = delivery?.id ?? "";
      await tx`select id from public.claim_email_delivery(${deliveryId})`;
      await tx`select public.finish_email_delivery(${deliveryId}, 'failed', null, 'The email service didn’t answer.')`;
      const retried = await tx`select attempts from public.claim_email_delivery(${deliveryId})`;
      // A send that never finished: once its claim is old, it can be claimed again.
      const notYet = await tx`select id from public.claim_email_delivery(${deliveryId})`;
      await actAs(tx, null);
      await tx`update public.email_deliveries set claimed_at = now() - interval '6 minutes' where id = ${deliveryId}`;
      await actAs(tx, ADMIN_ID);
      const reclaimed = await tx`select attempts from public.claim_email_delivery(${deliveryId})`;
      return { retried: retried[0]?.attempts, notYet: notYet.length, reclaimed: reclaimed[0]?.attempts };
    });
    expect(result).toEqual({ retried: 2, notYet: 0, reclaimed: 3 });
  });

  it("queues leave emails to the admins after a moment, and to the person once decided", async () => {
    const result = await rolledBack(async (tx) => {
      const [request] = await tx<{ id: string }[]>`
        insert into public.leave_requests (person_id, leave_type, start_date, end_date, status, requested_by)
        values (${SONAM}, 'annual', '2031-03-04', '2031-03-05', 'pending', ${EMPLOYEE_ID}) returning id`;
      const requestId = request?.id ?? "";
      await actAs(tx, EMPLOYEE_ID);
      const [queued] = await tx`select public.queue_leave_email(${requestId}, 'leave_requested') as n`;
      const [again] = await tx`select public.queue_leave_email(${requestId}, 'leave_requested') as n`;
      const toAdmins = await tx<{ id: string; to_email: string }[]>`select id, to_email from public.email_deliveries where leave_request_id = ${requestId}`;
      const early = await tx`select id from public.claim_email_delivery(${toAdmins[0]?.id ?? ""})`;
      const decideRefused = await refused(tx, (sp) => sp`select public.queue_leave_email(${requestId}, 'leave_decided')`);
      await actAs(tx, ADMIN_ID);
      await tx`update public.leave_requests set status = 'approved' where id = ${requestId}`;
      await tx`select public.queue_leave_email(${requestId}, 'leave_decided')`;
      const [decided] = await tx`select to_email, context ->> 'status' as status from public.email_deliveries where leave_request_id = ${requestId} and kind = 'leave_decided'`;
      return { queued: queued?.n, again: again?.n, toAdmins: toAdmins.map((row) => row.to_email), early: early.length, decideRefused, decided };
    });
    expect(result.queued).toBe(1);
    expect(result.again).toBe(0);
    expect(result.toAdmins).toEqual(["admin@dashteam.local"]);
    expect(result.early).toBe(0);
    expect(result.decideRefused).toMatch(/Not allowed/);
    expect(result.decided).toEqual({ to_email: "employee@dashteam.local", status: "approved" });
  });
});

describe("audit", () => {
  it("records generation without the file, each queue and send, a failure, a re-send and an admin download", async () => {
    const actions = await rolledBack(async (tx) => {
      const runId = await lockJanuary(tx);
      await actAs(tx, ADMIN_ID);
      await tx`select set_config('dashteam.action', 'payslip.generated', true)`;
      const id = await issue(tx, runId, SONAM, "XS-203001-001");
      const [delivery] = await tx<{ id: string }[]>`select public.queue_payslip_email(${id}, 'payslip') as id`;
      await tx`select id from public.claim_email_delivery(${delivery?.id ?? ""})`;
      await tx`select public.finish_email_delivery(${delivery?.id ?? ""}, 'failed', null, 'No answer')`;
      await tx`select id from public.claim_email_delivery(${delivery?.id ?? ""})`;
      await tx`select public.finish_email_delivery(${delivery?.id ?? ""}, 'sent', 'provider-1')`;
      await tx`select public.queue_payslip_email(${id}, 'payslip_resend', 'click')`;
      await tx`select public.record_payslip_download(${id})`;
      await actAs(tx, null);
      return tx<{ action: string; has_pdf: boolean; actor_id: string }[]>`
        select action, coalesce(after ? 'pdf', false) as has_pdf, actor_id from public.audit_log
        where transaction_id = txid_current() and entity_table in ('payslips', 'email_deliveries') order by id`;
    });
    expect(actions.map((row) => row.action)).toEqual([
      "payslip.generated",
      "payslip.email_queued",
      "email.sending",
      "email.failed",
      "email.sending",
      "email.sent",
      "payslip.resent",
      "payslip.downloaded",
    ]);
    expect(actions.some((row) => row.has_pdf)).toBe(false);
    expect(actions.every((row) => row.actor_id === ADMIN_ID)).toBe(true);
  });

  it("refuses a download record from anyone but an admin", async () => {
    await expect(as(EMPLOYEE_ID, (tx) => tx`select public.record_payslip_download(gen_random_uuid())`)).rejects.toThrow(/Not allowed/);
  });
});
