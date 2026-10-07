import type postgres from "postgres";

// A locked January 2030 inside a test transaction: settings from this month naming January as the
// first month, a run, a snapshot for everyone employed, then the lock. Figures don't matter here.
// Committed locks are permanent, so callers always run inside rolledBack().

export const JANUARY = "2030-01-01";

export async function lockJanuary(tx: postgres.TransactionSql): Promise<string> {
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

