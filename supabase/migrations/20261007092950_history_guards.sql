-- Milestone 7: imported months, pay statements, salary certificates and opening leave.
--
-- Imported months are locked runs like any other, flagged 'imported', so every guard that protects a
-- locked month protects them too. They take their own narrow path into the lock (before the first
-- payroll month, figures as given) and out of it: an import can be removed, as a whole, only until
-- the first live month locks. Statements and certificates are written once and never changed.

-- ── Is a live month locked yet? ────────────────────────────────────────────────────
create function public.live_month_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.payroll_runs where status = 'locked' and source = 'live') $$;

-- The earliest locked month, imported or live: where locked leave starts. Anyone signed in may ask.
create function public.earliest_locked_month()
returns date
language sql
stable
security definer
set search_path = ''
as $$ select min(month) from public.payroll_runs where status = 'locked' $$;

-- True only inside remove_payroll_import, for that import's own runs.
create function public.import_being_removed(run uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payroll_runs r
    where r.id = run
      and r.source = 'imported'
      and r.import_id::text = current_setting('dashteam.removing_import', true)
  )
$$;

-- ── Payroll runs: the imported path in, and out ────────────────────────────────────
create or replace function public.guard_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_month date;
  month_end date;
  open_month date;
begin
  if tg_op = 'DELETE' then
    if old.source = 'imported' and old.import_id::text = current_setting('dashteam.removing_import', true) then
      return old;
    end if;
    raise exception 'Payroll runs are never removed.' using errcode = 'restrict_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A payroll run starts as a draft.' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.status = 'locked' then
    raise exception '%', public.payroll_locked_error(old.month) using errcode = 'restrict_violation';
  end if;
  if new.month <> old.month or new.source <> old.source or new.import_id is distinct from old.import_id then
    raise exception 'A payroll run’s month and source can’t change.' using errcode = 'restrict_violation';
  end if;
  if new.status = 'draft' then
    return new;
  end if;

  first_month := public.payroll_first_month();
  if first_month is null then
    raise exception 'Choose the first month DashTeam pays before locking.' using errcode = 'restrict_violation';
  end if;
  month_end := (new.month + interval '1 month - 1 day')::date;

  if new.source = 'imported' then
    -- A month from before DashTeam, with the figures as they were given.
    if new.month >= first_month then
      raise exception 'Only months before % can be brought in.', to_char(first_month, 'FMMonth YYYY') using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from public.payroll_snapshots s where s.run_id = new.id) then
      raise exception 'An imported month needs at least one person.' using errcode = 'restrict_violation';
    end if;
  else
    if new.month < first_month then
      raise exception 'DashTeam pays from %. Earlier months can’t be locked.', to_char(first_month, 'FMMonth YYYY')
        using errcode = 'restrict_violation';
    end if;

    select min(m)::date into open_month
    from generate_series(first_month, new.month - interval '1 month', interval '1 month') as m
    where not public.payroll_month_locked(m::date);
    if open_month is not null then
      raise exception 'Months lock in order. Lock % first.', to_char(open_month, 'FMMonth YYYY')
        using errcode = 'restrict_violation';
    end if;

    if exists (
      select 1 from public.people person
      where person.start_date <= month_end
        and (person.end_date is null or person.end_date >= new.month)
        and not exists (select 1 from public.payroll_snapshots s where s.run_id = new.id and s.person_id = person.id)
    ) then
      raise exception 'Everyone paid this month needs a snapshot before locking.' using errcode = 'restrict_violation';
    end if;
  end if;

  if exists (
    select 1 from public.payroll_snapshots s
    join public.people person on person.id = s.person_id
    where s.run_id = new.id
      and not (person.start_date <= month_end and (person.end_date is null or person.end_date >= new.month))
  ) then
    raise exception 'A snapshot belongs to someone who isn’t paid this month.' using errcode = 'restrict_violation';
  end if;

  new.locked_at := now();
  new.locked_by := (select auth.uid());
  return new;
end;
$$;

create or replace function public.guard_payroll_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run record;
begin
  if tg_op = 'INSERT' then
    select month, status into run from public.payroll_runs where id = new.run_id;
    if run.status is distinct from 'draft' then
      raise exception '%', public.payroll_locked_error(run.month) using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' and public.import_being_removed(old.run_id) then
    return old;
  end if;
  raise exception 'Payroll snapshots never change. Add a correction to a later month.' using errcode = 'restrict_violation';
end;
$$;

create or replace function public.guard_payslip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.import_being_removed(old.run_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'A payslip never changes once it’s issued. Correct it with a one-off in a later month.'
      using errcode = 'restrict_violation';
  end if;
  if not exists (
    select 1
    from public.payroll_snapshots s
    join public.payroll_runs r on r.id = s.run_id
    where s.id = new.snapshot_id
      and s.run_id = new.run_id
      and s.person_id = new.person_id
      and r.status = 'locked'
      and r.month = new.month
  ) then
    raise exception 'A payslip is made only from a locked month’s snapshot.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create or replace function public.guard_filing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.import_being_removed(old.run_id) then
      return old;
    end if;
    raise exception 'A filing record is kept. Change it instead.' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.payroll_runs r where r.id = new.run_id and r.status = 'locked' and r.month = new.month) then
    raise exception 'A month is filed only once it’s locked.' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and (new.run_id, new.month) is distinct from (old.run_id, old.month) then
    raise exception 'A filing record stays with its month.' using errcode = 'restrict_violation';
  end if;
  if new.receipt_id is not null and not exists (select 1 from public.filing_receipts f where f.id = new.receipt_id and f.run_id = new.run_id) then
    raise exception 'That receipt belongs to another month.' using errcode = 'restrict_violation';
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create function public.guard_filing_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.import_being_removed(old.run_id) then
    return old;
  end if;
  raise exception 'This is kept as it was saved and can’t be changed or removed.' using errcode = 'restrict_violation';
end;
$$;

drop trigger filing_receipts_guard on public.filing_receipts;
create trigger filing_receipts_guard before update or delete on public.filing_receipts
  for each row execute function public.guard_filing_receipt();

-- The IT-1(a) is made for live months only; imported months were filed before DashTeam.
create or replace function public.guard_it1a_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'An IT-1(a) schedule never changes once it’s made.' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from public.payroll_runs r where r.id = new.run_id and r.status = 'locked' and r.month = new.month and r.source = 'live') then
    raise exception 'An IT-1(a) schedule is made only for a month locked in DashTeam.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- ── Imports: kept as brought in; removed whole, and only before the first live lock ──
create function public.guard_payroll_import()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'An import is kept, even once removed.' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.filename, new.csv, new.csv_sha256, new.months, new.rows, new.imported_by, new.imported_at)
     is distinct from (old.id, old.filename, old.csv, old.csv_sha256, old.months, old.rows, old.imported_by, old.imported_at)
     or old.removed_at is not null
     or current_setting('dashteam.removing_import', true) is distinct from old.id::text then
    raise exception 'An import is kept as it was brought in.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger payroll_imports_guard before update or delete on public.payroll_imports
  for each row execute function public.guard_payroll_import();
create trigger payroll_imports_no_truncate before truncate on public.payroll_imports
  for each statement execute function public.reject_payroll_truncate();
create trigger payroll_imports_audit after insert or update or delete on public.payroll_imports
  for each row execute function public.write_audit_entry('csv');

create function public.remove_payroll_import(import uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  runs uuid[];
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.payroll_imports where id = import and removed_at is null) then
    raise exception 'That import has already been removed.';
  end if;
  if public.live_month_locked() then
    raise exception 'Imported months are permanent once a month is locked in DashTeam.' using errcode = 'restrict_violation';
  end if;
  select array_agg(id) into runs from public.payroll_runs where import_id = import;
  if exists (select 1 from public.email_deliveries d join public.payslips p on p.id = d.payslip_id where p.run_id = any(runs)) then
    raise exception 'A payslip from these months has already been emailed, so they’re kept.' using errcode = 'restrict_violation';
  end if;

  perform set_config('dashteam.removing_import', import::text, true);
  perform set_config('dashteam.action', 'payroll.import_removed', true);
  delete from public.filings where run_id = any(runs);
  delete from public.filing_receipts where run_id = any(runs);
  delete from public.payslips where run_id = any(runs);
  delete from public.payroll_snapshots where run_id = any(runs);
  delete from public.payroll_runs where id = any(runs);
  update public.payroll_imports set removed_at = now(), removed_by = (select auth.uid()) where id = import;
  perform set_config('dashteam.removing_import', '', true);
end;
$$;

-- ── Opening leave: set until the first live month locks ────────────────────────────
create function public.guard_leave_opening_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.live_month_locked() then
    raise exception 'Leave taken before DashTeam is fixed once a month is locked in DashTeam.' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger leave_opening_balances_guard before insert or update or delete on public.leave_opening_balances
  for each row execute function public.guard_leave_opening_balance();
create trigger leave_opening_balances_audit after insert or update or delete on public.leave_opening_balances
  for each row execute function public.write_audit_entry();

-- ── Statements: written once ───────────────────────────────────────────────────────
create trigger pay_statements_guard before update or delete on public.pay_statements
  for each row execute function public.reject_change_once_written();
create trigger pay_statements_no_truncate before truncate on public.pay_statements
  for each statement execute function public.reject_payroll_truncate();
create trigger pay_statements_audit after insert or update or delete on public.pay_statements
  for each row execute function public.write_audit_entry('pdf');

-- ── Certificate requests ───────────────────────────────────────────────────────────
-- The person asks while employed, and can withdraw while it waits. An admin issues (with the
-- certificate written first) or declines. Undo puts any of these back.
create function public.guard_certificate_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  undoing boolean := current_setting('dashteam.undoing', true) = 'on';
begin
  if tg_op = 'DELETE' then
    if undoing then
      return old;
    end if;
    raise exception 'Certificate requests are kept.' using errcode = 'restrict_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' and not undoing then
      raise exception 'A request starts out waiting.' using errcode = 'restrict_violation';
    end if;
    if not undoing and exists (select 1 from public.people p where p.id = new.person_id and p.end_date is not null and p.end_date < public.thimphu_today()) then
      raise exception 'Certificates are for people who work at Xceed now.' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if undoing then
    return new;
  end if;
  if (new.person_id, new.addressee, new.purpose, new.requested_by, new.created_at)
     is distinct from (old.person_id, old.addressee, old.purpose, old.requested_by, old.created_at) then
    raise exception 'A request can’t be changed. Withdraw it and ask again.' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'pending' then
    raise exception 'This request has already been %.', old.status using errcode = 'restrict_violation';
  end if;
  if new.status = 'withdrawn' then
    if new.person_id is distinct from public.current_person_id() then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
  elsif new.status in ('issued', 'declined') then
    if not public.is_admin() then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'issued' and not exists (select 1 from public.salary_certificates c where c.request_id = new.id) then
      raise exception 'Issue the certificate first.' using errcode = 'restrict_violation';
    end if;
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  else
    raise exception 'A waiting request is withdrawn, issued or declined.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger certificate_requests_guard before insert or update or delete on public.certificate_requests
  for each row execute function public.guard_certificate_request();
create trigger certificate_requests_audit after insert or update or delete on public.certificate_requests
  for each row execute function public.write_audit_entry();

-- ── Certificates: written once. Undo may take one back, only before anyone has opened it ──
create function public.guard_salary_certificate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.certificate_requests r where r.id = new.request_id and r.person_id = new.person_id and r.status = 'pending') then
      raise exception 'A certificate is issued only for a waiting request.' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE'
     and current_setting('dashteam.undoing', true) = 'on'
     and not exists (select 1 from public.audit_log a where a.entity_table = 'salary_certificates' and a.entity_id = old.id and a.action = 'certificate.downloaded') then
    return old;
  end if;
  raise exception 'An issued certificate never changes. Ask for a new one.' using errcode = 'restrict_violation';
end;
$$;

create trigger salary_certificates_guard before insert or update or delete on public.salary_certificates
  for each row execute function public.guard_salary_certificate();
create trigger salary_certificates_no_truncate before truncate on public.salary_certificates
  for each statement execute function public.reject_payroll_truncate();
create trigger salary_certificates_audit after insert or update or delete on public.salary_certificates
  for each row execute function public.write_audit_entry('pdf');

create trigger signature_images_guard before update or delete on public.signature_images
  for each row execute function public.reject_change_once_written();
create trigger signature_images_audit after insert or update or delete on public.signature_images
  for each row execute function public.write_audit_entry('bytes');

-- ── References: the next number in the year, one at a time ─────────────────────────
-- Counts across everyone (statements are per person under RLS), so it runs as the owner. The lock is
-- held to the end of the caller's transaction, so two at once can't take the same number.
create function public.next_document_number(kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text;
  position integer;
begin
  if kind = 'statement' then
    if not (public.is_admin() or public.current_person_id() is not null) then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
    prefix := 'XS-PS-' || extract(year from public.thimphu_today())::text || '-';
    perform pg_advisory_xact_lock(hashtext('dashteam:statement-number'));
    select coalesce(max(substring(reference from length(prefix) + 1)::integer), 0) + 1 into position
    from public.pay_statements where reference like prefix || '%';
  elsif kind = 'certificate' then
    if not public.is_admin() then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
    prefix := 'XS-SC-' || extract(year from public.thimphu_today())::text || '-';
    perform pg_advisory_xact_lock(hashtext('dashteam:certificate-number'));
    select coalesce(max(substring(reference from length(prefix) + 1)::integer), 0) + 1 into position
    from public.salary_certificates where reference like prefix || '%';
  else
    raise exception 'There’s no such document.';
  end if;
  return position;
end;
$$;

-- ── Downloads are recorded ─────────────────────────────────────────────────────────
create function public.record_document_download(kind text, subject uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  if kind = 'statement' then
    select person_id into owner from public.pay_statements where id = subject;
  elsif kind = 'certificate' then
    select person_id into owner from public.salary_certificates where id = subject;
  end if;
  if owner is null then
    raise exception 'There’s nothing like that to download.';
  end if;
  if not (public.is_admin() or owner = public.current_person_id()) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
  values ((select auth.uid()), kind || '.downloaded', case kind when 'statement' then 'pay_statements' else 'salary_certificates' end, subject, txid_current(), null, null);
end;
$$;

-- ── Certificate emails: queued after the issue, held back so Undo can stop them ─────
create or replace function public.guard_email_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Emails are kept, sent or not.' using errcode = 'restrict_violation';
  end if;
  -- What it was about was removed (a leave request, or a certificate taken back by Undo).
  if ((new.leave_request_id is null and old.leave_request_id is not null) or (new.certificate_id is null and old.certificate_id is not null))
     and (new.kind, new.payslip_id, new.to_email, new.dedupe_key, new.context, new.status, new.requested_by, new.created_at)
         is not distinct from (old.kind, old.payslip_id, old.to_email, old.dedupe_key, old.context, old.status, old.requested_by, old.created_at) then
    return new;
  end if;
  if old.status in ('sent', 'skipped') then
    raise exception 'This email is already %.', old.status using errcode = 'restrict_violation';
  end if;
  if (new.kind, new.payslip_id, new.leave_request_id, new.certificate_id, new.to_email, new.dedupe_key, new.context, new.requested_by, new.created_at)
     is distinct from
     (old.kind, old.payslip_id, old.leave_request_id, old.certificate_id, old.to_email, old.dedupe_key, old.context, old.requested_by, old.created_at) then
    raise exception 'An email can’t be changed after it’s queued.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create function public.queue_certificate_email(certificate uuid, delay_seconds integer default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text;
  delivery uuid;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  select p.email into address
  from public.salary_certificates c join public.people p on p.id = c.person_id
  where c.id = certificate;
  if address is null then
    raise exception 'There’s no such certificate.';
  end if;
  perform set_config('dashteam.action', 'email.queued', true);
  insert into public.email_deliveries (kind, certificate_id, to_email, dedupe_key, send_after, requested_by)
  values ('certificate_issued', certificate, address, 'certificate_issued:' || certificate,
          now() + make_interval(secs => greatest(delay_seconds, 0)), (select auth.uid()))
  on conflict (dedupe_key) do nothing
  returning id into delivery;
  return delivery;
end;
$$;

-- ── Rules: who signs certificates, set by an admin ─────────────────────────────────
-- It never shapes a payroll month and every certificate keeps its own copy, so it can change in any
-- month, and this month's row can be replaced.
create or replace function public.protect_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Rules cannot be changed. Add a new rule with a later effective_from.'
      using errcode = 'restrict_violation';
  end if;

  if old.key = 'payroll_settings' and public.latest_locked_month() is null then
    return old;
  end if;
  if old.key = 'certificate_settings' and old.effective_from >= date_trunc('month', public.thimphu_today())::date then
    return old;
  end if;

  if old.effective_from <= (now() at time zone 'Asia/Thimphu')::date then
    raise exception 'A rule already in force cannot be deleted.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

create or replace function public.guard_rule_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest date := public.latest_locked_month();
begin
  if latest is null or new.key = 'certificate_settings' then
    return new;
  end if;
  if new.effective_from <= latest then
    raise exception '%', public.payroll_locked_error(latest) using errcode = 'restrict_violation';
  end if;
  if new.key = 'payroll_settings'
     and (new.value ->> 'first_month')::date is distinct from public.payroll_first_month() then
    raise exception 'The first payroll month can’t change once a month is locked.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop policy "rules_insert_settings_admin" on public.rules;
drop policy "rules_delete_settings_admin" on public.rules;
create policy "rules_insert_settings_admin" on public.rules as permissive for insert to authenticated
  with check ((select public.is_admin()) and key in ('payroll_settings', 'certificate_settings'));
create policy "rules_delete_settings_admin" on public.rules as permissive for delete to authenticated
  using ((select public.is_admin()) and key in ('payroll_settings', 'certificate_settings'));

-- ── Grants ─────────────────────────────────────────────────────────────────────────
revoke all on table public.payroll_imports, public.leave_opening_balances, public.pay_statements,
  public.certificate_requests, public.salary_certificates, public.signature_images from anon, authenticated;
grant select, insert on table public.payroll_imports to authenticated;
grant select, insert, update, delete on table public.leave_opening_balances to authenticated;
grant select, insert on table public.pay_statements to authenticated;
grant select, insert, update on table public.certificate_requests to authenticated;
grant select, insert on table public.salary_certificates to authenticated;
grant select, insert on table public.signature_images to authenticated;

revoke execute on function public.earliest_locked_month() from public, anon;
grant execute on function public.earliest_locked_month() to authenticated;
revoke execute on function public.live_month_locked() from public, anon;
grant execute on function public.live_month_locked() to authenticated;
revoke execute on function public.import_being_removed(uuid) from public, anon, authenticated;
revoke execute on function public.remove_payroll_import(uuid) from public, anon;
grant execute on function public.remove_payroll_import(uuid) to authenticated;
revoke execute on function public.next_document_number(text) from public, anon;
grant execute on function public.next_document_number(text) to authenticated;
revoke execute on function public.record_document_download(text, uuid) from public, anon;
grant execute on function public.record_document_download(text, uuid) to authenticated;
revoke execute on function public.queue_certificate_email(uuid, integer) from public, anon;
grant execute on function public.queue_certificate_email(uuid, integer) to authenticated;
revoke execute on function public.guard_payroll_import() from public, anon, authenticated;
revoke execute on function public.guard_leave_opening_balance() from public, anon, authenticated;
revoke execute on function public.guard_certificate_request() from public, anon, authenticated;
revoke execute on function public.guard_salary_certificate() from public, anon, authenticated;
revoke execute on function public.guard_filing_receipt() from public, anon, authenticated;
