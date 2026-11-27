import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ADMIN_ID, EMPLOYEE_ID, SEEDED_EMPLOYEE_PERSON_ID as SONAM, actAs, rolledBack, sql, uniqueEmail } from "./local-db";

// Every table, one by one: the seeded employee (Sonam) against a second employee (Karma) who has a row
// in each. Sonam must never see, add, change or remove Karma's rows, and sees nothing at all in the
// tables only admins use. The last test fails when a table is added without a line here, so the
// promise "every table has a test" can't quietly lapse.
//
// Triggers stay off throughout (rows are seeded as the owner, then Sonam acts): this checks row level
// security and grants, and a guard refusing first would hide what they do. Guards have their own tests.

type Scope =
  /** Each row belongs to one person: Sonam sees only hers. */
  | "own"
  /** Only admins see or write it. */
  | "admin"
  /** Everyone with access reads it; only admins write it. */
  | "shared";

const TABLES: Record<string, Scope> = {
  audit_log: "admin",
  certificate_requests: "own",
  email_deliveries: "own",
  exit_leave_settlements: "admin",
  filing_receipts: "admin",
  filing_reminders: "admin",
  filings: "admin",
  holidays: "shared",
  it1a_schedules: "admin",
  leave_notices: "own",
  leave_opening_balances: "own",
  leave_requests: "own",
  pay_records: "own",
  pay_statements: "own",
  payroll_acknowledgements: "admin",
  payroll_imports: "admin",
  payroll_lines: "admin",
  payroll_runs: "admin",
  payroll_snapshots: "own",
  payslips: "own",
  people: "own",
  profile_change_requests: "own",
  profiles: "own",
  rules: "shared",
  salary_certificates: "own",
  signature_images: "admin",
};

const PDF = Buffer.from("%PDF-1.7 test");
const MONTH = "2030-01-01";

/** Karma: a second employee with a login, and one row of hers (or the company's) in every table. */
async function seedKarma(tx: postgres.TransactionSql): Promise<Record<string, string>> {
  await tx`set local session_replication_role = replica`;
  const one = async (query: Promise<{ id: string }[]>) => (await query)[0]?.id ?? "";
  const [user] = await tx<{ id: string }[]>`
    insert into auth.users (instance_id, id, aud, role, email)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${uniqueEmail("karma")})
    returning id`;
  const karmaUser = user?.id ?? "";
  // Triggers are off, so the profile the sign-up trigger would make is made here.
  const profile = await one(tx`insert into public.profiles (id, role) values (${karmaUser}, 'employee') returning id`);
  const person = await one(tx`
    insert into public.people (full_name, email, start_date, profile_id)
    values ('Karma Dema', ${uniqueEmail("karma")}, '2025-01-06', ${karmaUser}) returning id`);
  const run = await one(tx`insert into public.payroll_runs (month) values (${MONTH}) returning id`);
  const snapshot = await one(tx`
    insert into public.payroll_snapshots (run_id, person_id, full_name, email, employment_type, person, inputs, result, rule_ids,
      gross_ch, health_contribution_ch, provident_fund_ch, gis_ch, tds_ch, recoveries_ch, take_home_ch)
    values (${run}, ${person}, 'Karma Dema', 'karma@dashteam.local', 'full_time', '{}', '{}', '{}', '{}', 100, 1, 0, 0, 0, 0, 99)
    returning id`);
  const request = await one(tx`insert into public.certificate_requests (person_id, requested_by) values (${person}, ${karmaUser}) returning id`);
  const receipt = await one(tx`
    insert into public.filing_receipts (run_id, filename, content_type, bytes) values (${run}, 'receipt.pdf', 'application/pdf', ${PDF}) returning id`);

  return {
    profiles: profile,
    people: person,
    payroll_runs: run,
    payroll_snapshots: snapshot,
    certificate_requests: request,
    filing_receipts: receipt,
    pay_records: await one(tx`
      insert into public.pay_records (person_id, effective_from, employment_type, basic_ch, allowances_ch)
      values (${person}, '2025-01-01', 'full_time', 5000000, 0) returning id`),
    profile_change_requests: await one(tx`
      insert into public.profile_change_requests (person_id, phone, requested_by) values (${person}, '17000000', ${karmaUser}) returning id`),
    leave_requests: await one(tx`
      insert into public.leave_requests (person_id, leave_type, start_date, end_date, requested_by)
      values (${person}, 'annual', '2030-03-04', '2030-03-04', ${karmaUser}) returning id`),
    leave_notices: await one(tx`insert into public.leave_notices (person_id, message) values (${person}, 'Test notice') returning id`),
    leave_opening_balances: await one(tx`
      insert into public.leave_opening_balances (person_id, leave_year, leave_type, days, as_of)
      values (${person}, 2030, 'annual', 3, '2030-01-01') returning id`),
    exit_leave_settlements: await one(tx`
      insert into public.exit_leave_settlements (person_id, leave_year, days_over, daily_rate_ch, suggested_ch, unused_annual_days, status, final_ch)
      values (${person}, 2030, 0, 100, 0, 0, 'accepted', 0) returning id`),
    payslips: await one(tx`
      insert into public.payslips (run_id, snapshot_id, person_id, month, reference, employment_type, take_home_ch, content, pdf, pdf_sha256)
      values (${run}, ${snapshot}, ${person}, ${MONTH}, 'XS-203001-901', 'full_time', 99, '{}', ${PDF}, 'x') returning id`),
    pay_statements: await one(tx`
      insert into public.pay_statements (person_id, from_month, to_month, issued_on, reference, content, pdf, pdf_sha256, created_by)
      values (${person}, ${MONTH}, ${MONTH}, '2030-02-01', 'XS-PS-2030-9001', '{}', ${PDF}, 'x', ${karmaUser}) returning id`),
    salary_certificates: await one(tx`
      insert into public.salary_certificates (request_id, person_id, reference, issued_on, content, pdf, pdf_sha256, rule_ids)
      values (${request}, ${person}, 'XS-SC-2030-901', '2030-02-01', '{}', ${PDF}, 'x', '{}') returning id`),
    email_deliveries: await one(tx`
      insert into public.email_deliveries (kind, to_email, requested_by) values ('leave_requested', 'admin@dashteam.local', ${karmaUser}) returning id`),
    payroll_lines: await one(tx`
      insert into public.payroll_lines (month, person_id, kind, amount_ch) values (${MONTH}, ${person}, 'bonus', 100) returning id`),
    payroll_acknowledgements: await one(tx`
      insert into public.payroll_acknowledgements (month, check_key) values (${MONTH}, 'test') returning id`),
    it1a_schedules: await one(tx`
      insert into public.it1a_schedules (run_id, month, rows, totals, xls, xls_sha256) values (${run}, ${MONTH}, '[]', '{}', ${PDF}, 'x') returning id`),
    filings: await one(tx`insert into public.filings (run_id, month) values (${run}, ${MONTH}) returning id`),
    filing_reminders: await one(tx`
      insert into public.filing_reminders (sent_on, months, recipients) values ('2030-02-05', '[]', '{}') returning id`),
    payroll_imports: await one(tx`
      insert into public.payroll_imports (filename, csv, csv_sha256, months, rows) values ('old.csv', 'a', 'x', '{}', 0) returning id`),
    signature_images: await one(tx`insert into public.signature_images (content_type, bytes) values ('image/png', 'png') returning id`),
    holidays: await one(tx`
      insert into public.holidays (name, start_date, end_date, year, kind, scope, status, source)
      values ('Test day', '2030-05-01', '2030-05-01', 2030, 'one_off', 'national', 'confirmed', 'test') returning id`),
    rules: await one(tx`
      insert into public.rules (key, employment_type, effective_from, value, note)
      values ('gis', 'full_time', '2030-06-01', '{"rate_bp": 0}', 'test') returning id`),
    audit_log: await one(tx`
      insert into public.audit_log (action, entity_table, entity_id, transaction_id, after)
      values ('test', 'people', ${person}, 1, '{}') returning id::text`),
  };
}

type Attempt = { refused: boolean; rows: number; code?: string };

/** Tries a write in a savepoint, so a refusal doesn't end the test's transaction. */
async function attempt(tx: postgres.TransactionSql, write: (sp: postgres.TransactionSql) => Promise<postgres.RowList<postgres.Row[]>>): Promise<Attempt> {
  try {
    const rows = await tx.savepoint((sp) => write(sp));
    return { refused: rows.count === 0, rows: rows.count };
  } catch (error) {
    return { refused: true, rows: 0, code: (error as { code?: string }).code };
  }
}

/** Refused for the right reason: no rows touched, or a permission error, never some other failure. */
function expectRefused(result: Attempt, label: string) {
  expect(result.refused, label).toBe(true);
  if (result.code) expect(result.code, label).toBe("42501");
}

describe("every table keeps people apart", () => {
  it.each(Object.entries(TABLES))("%s (%s)", async (table, scope) => {
    const result = await rolledBack(async (tx) => {
      const ids = await seedKarma(tx);
      const id = ids[table];
      if (!id) throw new Error(`No fixture row for ${table}`);
      // A copy of Karma's row, to try adding as Sonam (it would be Karma's, or the company's).
      const [copy] = await tx<{ row: Record<string, unknown> }[]>`
        select to_jsonb(t) - 'id' as row from ${tx(table)} t where id::text = ${id}`;
      const row = (copy?.row ?? {}) as postgres.JSONValue & Record<string, unknown>;
      const columns = Object.keys(row);

      await actAs(tx, EMPLOYEE_ID);
      const [seen] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)} where id::text = ${id}`;
      const [all] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)}`;
      const insert = await attempt(tx, (sp) => sp`
        insert into ${sp(table)} (${sp(columns)})
        select ${sp(columns)} from jsonb_populate_record(null::${sp(`public.${table}`)}, ${sp.json(row)}) returning 1`);
      const column = columns[0] ?? "id";
      const update = await attempt(tx, (sp) => sp`update ${sp(table)} set ${sp(column)} = ${sp(column)} where id::text = ${id} returning 1`);
      const remove = await attempt(tx, (sp) => sp`delete from ${sp(table)} where id::text = ${id} returning 1`);
      return { seen: seen?.n ?? -1, all: all?.n ?? -1, insert, update, remove };
    });

    if (scope === "shared") {
      expect(result.seen, "everyone with access reads it").toBe(1);
    } else {
      expect(result.seen, "Karma's row is hidden from Sonam").toBe(0);
    }
    if (scope === "admin") expect(result.all, "nothing at all in an admin table").toBe(0);
    expectRefused(result.insert, "adding Karma's row");
    expectRefused(result.update, "changing Karma's row");
    expectRefused(result.remove, "removing Karma's row");
  });

  it("lets an admin see a row in every table", async () => {
    const counts = await rolledBack(async (tx) => {
      const ids = await seedKarma(tx);
      await tx`set local session_replication_role = origin`;
      await actAs(tx, ADMIN_ID);
      const seen: Record<string, number> = {};
      for (const table of Object.keys(TABLES)) {
        const [row] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)} where id::text = ${ids[table] ?? ""}`;
        seen[table] = row?.n ?? 0;
      }
      return seen;
    });
    // Admins act with MFA only (see the MFA tests); here the admin is fully signed in.
    expect(Object.entries(counts).filter(([, n]) => n !== 1)).toEqual([]);
  });

  it("covers every table, and every table but the log itself is audited", async () => {
    const tables = await sql<{ name: string; audited: boolean }[]>`
      select t.tablename as name,
             exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.tablename)::regclass
                       and g.tgfoid = 'public.write_audit_entry'::regproc) as audited
      from pg_tables t where t.schemaname = 'public' order by 1`;
    expect(tables.map((t) => t.name)).toEqual(Object.keys(TABLES).sort());
    expect(tables.filter((t) => !t.audited).map((t) => t.name)).toEqual(["audit_log"]);
  });
});

describe("guards can't be switched off from outside", () => {
  it("ignores the old undo setting when an employee sets it", async () => {
    const outcome = await rolledBack(async (tx) => {
      const [request] = await tx<{ id: string }[]>`
        insert into public.profile_change_requests (person_id, phone, requested_by)
        values (${SONAM}, '17999999', ${EMPLOYEE_ID}) returning id`;
      await actAs(tx, EMPLOYEE_ID);
      await tx`select set_config('dashteam.undoing', 'on', true)`;
      return attempt(tx, (sp) => sp`update public.profile_change_requests set status = 'approved' where id = ${request?.id ?? ""} returning 1`);
    });
    expect(outcome.refused).toBe(true);
  });

  it("keeps the private marker table out of reach", async () => {
    const outcome = await rolledBack(async (tx) => {
      await actAs(tx, EMPLOYEE_ID);
      return attempt(tx, (sp) => sp`insert into private.guard_bypass (txid, kind) values (txid_current(), 'undo') returning 1`);
    });
    expectRefused(outcome, "writing the marker");
    expect(outcome.code).toBe("42501");
  });

  it("refuses a malformed bank account on a change request", async () => {
    const outcome = await rolledBack(async (tx) => {
      await actAs(tx, EMPLOYEE_ID);
      return attempt(tx, (sp) => sp`
        insert into public.profile_change_requests (person_id, bank_account_ciphertext, bank_account_last4, requested_by)
        values (${SONAM}, 'not a ciphertext', 'abcd', ${EMPLOYEE_ID}) returning 1`);
    });
    expect(outcome.code).toBe("23514");
  });
});
