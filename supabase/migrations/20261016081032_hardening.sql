-- Milestone 8: guards that can't be switched off from outside.
--
-- Undo and removing an import need to step past some guards, and used to say so with custom settings
-- (dashteam.undoing, dashteam.removing_import). Any SQL session can set a custom setting, so the
-- signal is now a row in a private table that only the owner's functions can write. Guards ask
-- public.undoing() and public.removing_import(), which read it for the current transaction only.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.guard_bypass (
  txid bigint not null,
  kind text not null check (kind in ('undo', 'removing_import')),
  value text,
  primary key (txid, kind)
);
revoke all on private.guard_bypass from public, anon, authenticated;

-- Is undo_transaction running in this transaction?
create function public.undoing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from private.guard_bypass where txid = txid_current() and kind = 'undo') $$;

-- The import remove_payroll_import is taking out in this transaction, if any.
create function public.removing_import()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select value from private.guard_bypass where txid = txid_current() and kind = 'removing_import' $$;

revoke execute on function public.undoing() from public, anon;
revoke execute on function public.removing_import() from public, anon;
grant execute on function public.undoing() to authenticated;
grant execute on function public.removing_import() to authenticated;

-- The same functions as before, with each custom-setting check swapped for the helpers above.
CREATE OR REPLACE FUNCTION public.guard_certificate_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  undoing boolean := public.undoing();
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_leave_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  is_owner boolean := new.person_id = public.current_person_id();
  admin boolean := public.is_admin();
  locked date;
begin
  if tg_op = 'INSERT' then
    locked := public.locked_month_in_span(new.start_date, new.end_date);
    if locked is not null then
      raise exception '%', public.payroll_locked_error(locked) using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    locked := public.locked_month_in_span(old.start_date, old.end_date);
    if locked is not null and not (old.status = 'pending' and new.status in ('declined', 'cancelled')) then
      raise exception '%', public.payroll_locked_error(locked) using errcode = 'restrict_violation';
    end if;
  end if;

  if public.undoing() then
    return new;
  end if;

  if (new.person_id, new.leave_type, new.start_date, new.end_date, new.start_half, new.end_half,
      new.child_order, new.event_date, new.note, new.requested_by, new.created_at)
     is distinct from
     (old.person_id, old.leave_type, old.start_date, old.end_date, old.start_half, old.end_half,
      old.child_order, old.event_date, old.note, old.requested_by, old.created_at) then
    raise exception 'A leave request can’t be edited after it’s sent. Cancel it and send a new one.' using errcode = 'restrict_violation';
  end if;

  if new.status = old.status then
    -- Only marking a decision as seen, by the person it belongs to.
    if (new.decision_note, new.decided_by, new.decided_at) is distinct from (old.decision_note, old.decided_by, old.decided_at) then
      raise exception 'This request has already been decided.' using errcode = 'restrict_violation';
    end if;
    if new.owner_seen_at is distinct from old.owner_seen_at and not is_owner then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('approved', 'declined') then
    if not admin then
      raise exception 'Only an admin can approve or decline leave.' using errcode = 'insufficient_privilege';
    end if;
  elsif old.status = 'pending' and new.status = 'cancelled' then
    if not (is_owner or admin) then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
  elsif old.status = 'approved' and new.status = 'cancelled' then
    if not (admin or (is_owner and old.start_date > public.thimphu_today())) then
      raise exception 'Leave that has started can only be cancelled by an admin.' using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'This request has already been decided.' using errcode = 'restrict_violation';
  end if;

  new.decided_by := (select auth.uid());
  new.decided_at := now();
  new.owner_seen_at := case when is_owner then now() else null end;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_payroll_import()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'An import is kept, even once removed.' using errcode = 'restrict_violation';
  end if;
  if (new.id, new.filename, new.csv, new.csv_sha256, new.months, new.rows, new.imported_by, new.imported_at)
     is distinct from (old.id, old.filename, old.csv, old.csv_sha256, old.months, old.rows, old.imported_by, old.imported_at)
     or old.removed_at is not null
     or public.removing_import() is distinct from old.id::text then
    raise exception 'An import is kept as it was brought in.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_payroll_month_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.payroll_month_locked(old.month) then
    raise exception '%', public.payroll_locked_error(old.month) using errcode = 'restrict_violation';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.payroll_month_locked(new.month) then
    raise exception '%', public.payroll_locked_error(new.month) using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and not public.undoing() then
    raise exception 'This can’t be edited. Remove it and add it again.' using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_payroll_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  first_month date;
  month_end date;
  open_month date;
begin
  if tg_op = 'DELETE' then
    if old.source = 'imported' and old.import_id::text = public.removing_import() then
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_profile_change_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if public.undoing() then
    return new;
  end if;

  if (new.person_id, new.requested_by, new.phone, new.bank_name, new.bank_account_ciphertext, new.bank_account_last4, new.created_at)
     is distinct from
     (old.person_id, old.requested_by, old.phone, old.bank_name, old.bank_account_ciphertext, old.bank_account_last4, old.created_at) then
    raise exception 'A change request cannot be edited after it is sent.' using errcode = 'restrict_violation';
  end if;

  if old.status <> 'pending' then
    raise exception 'This request has already been decided.' using errcode = 'restrict_violation';
  end if;

  if new.status in ('approved', 'declined') and not public.is_admin() then
    raise exception 'Only an admin can approve or decline a request.' using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'withdrawn' and old.requested_by is distinct from (select auth.uid()) then
    raise exception 'Only the person who asked can withdraw a request.' using errcode = 'insufficient_privilege';
  end if;

  if new.status <> 'pending' then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_salary_certificate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.certificate_requests r where r.id = new.request_id and r.person_id = new.person_id and r.status = 'pending') then
      raise exception 'A certificate is issued only for a waiting request.' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE'
     and public.undoing()
     and not exists (select 1 from public.audit_log a where a.entity_table = 'salary_certificates' and a.entity_id = old.id and a.action = 'certificate.downloaded') then
    return old;
  end if;
  raise exception 'An issued certificate never changes. Ask for a new one.' using errcode = 'restrict_violation';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.import_being_removed(run uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.payroll_runs r
    where r.id = run
      and r.source = 'imported'
      and r.import_id::text = public.removing_import()
  )
$function$
;

CREATE OR REPLACE FUNCTION public.protect_pay_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  this_month date := date_trunc('month', public.thimphu_today())::date;
  latest date := public.latest_locked_month();
begin
  -- A record is in force from its month until the next one, so anything dated on or before the
  -- latest locked month could change what a locked month used.
  if latest is not null then
    if tg_op = 'INSERT' and new.effective_from <= latest then
      raise exception '%', public.payroll_locked_error(latest) using errcode = 'restrict_violation';
    end if;
    if tg_op = 'DELETE' and old.effective_from <= latest
       and exists (select 1 from public.people where id = old.person_id) then
      raise exception '%', public.payroll_locked_error(latest) using errcode = 'restrict_violation';
    end if;
  end if;

  if public.undoing() then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Pay records cannot be changed. Record a pay change from a later month.'
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.effective_from < this_month
       and exists (select 1 from public.pay_records where person_id = new.person_id) then
      raise exception 'A pay change can start this month at the earliest.'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- DELETE
  if old.effective_from < this_month
     and exists (select 1 from public.people where id = old.person_id) then
    raise exception 'Pay for a past month cannot be removed.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_payroll_import(import uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  insert into private.guard_bypass (txid, kind, value) values (txid_current(), 'removing_import', import::text)
    on conflict (txid, kind) do update set value = excluded.value;
  perform set_config('dashteam.action', 'payroll.import_removed', true);
  delete from public.filings where run_id = any(runs);
  delete from public.filing_receipts where run_id = any(runs);
  delete from public.payslips where run_id = any(runs);
  delete from public.payroll_snapshots where run_id = any(runs);
  delete from public.payroll_runs where id = any(runs);
  update public.payroll_imports set removed_at = now(), removed_by = (select auth.uid()) where id = import;
  delete from private.guard_bypass where txid = txid_current() and kind = 'removing_import';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.undo_transaction(target_transaction bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := (select auth.uid());
  entry record;
  columns text;
  last_entry bigint;
  undone jsonb := '[]'::jsonb;
begin
  if caller is null then
    raise exception 'Sign in to undo.' using errcode = 'insufficient_privilege';
  end if;

  select max(id) into last_entry
  from public.audit_log
  where transaction_id = target_transaction and public.audit_records_a_change(action);

  if last_entry is null then
    raise exception 'There is nothing to undo.';
  end if;

  if exists (
    select 1 from public.audit_log
    where transaction_id = target_transaction
      and public.audit_records_a_change(action)
      and (actor_id is distinct from caller or occurred_at < now() - interval '10 minutes' or action = 'undo')
  ) then
    raise exception 'Undo is no longer available.' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1
    from public.audit_log done
    join public.audit_log later
      on later.entity_table = done.entity_table
     and later.entity_id = done.entity_id
     and later.id > last_entry
     and public.audit_records_a_change(later.action)
    where done.transaction_id = target_transaction
  ) then
    raise exception 'This was changed since, so it can''t be undone.';
  end if;

  insert into private.guard_bypass (txid, kind) values (txid_current(), 'undo') on conflict do nothing;

  for entry in
    select * from public.audit_log
    where transaction_id = target_transaction and public.audit_records_a_change(action)
    order by id desc
  loop
    if entry.before is null then
      execute format('delete from public.%I where id = $1', entry.entity_table) using entry.entity_id;
    elsif entry.after is null then
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', entry.entity_table, entry.entity_table)
        using entry.before;
    else
      select string_agg(quote_ident(key), ', ') into columns
      from jsonb_object_keys(entry.before) as key
      where key <> 'id';
      execute format(
        'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2',
        entry.entity_table, columns, columns, entry.entity_table
      ) using entry.before, entry.entity_id;
    end if;
    undone := undone || jsonb_build_object('table', entry.entity_table, 'id', entry.entity_id, 'before', entry.before, 'after', entry.after);
  end loop;

  delete from private.guard_bypass where txid = txid_current() and kind = 'undo';
  return undone;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.write_audit_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  label text := nullif(current_setting('dashteam.action', true), '');
  before_row jsonb;
  after_row jsonb;
begin
  if public.undoing() then
    label := 'undo';
  end if;
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  if tg_nargs > 0 then
    before_row := before_row - tg_argv;
    after_row := after_row - tg_argv;
  end if;

  insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
  values (
    (select auth.uid()),
    coalesce(label, tg_table_name || '.' || lower(tg_op)),
    tg_table_name,
    coalesce((after_row ->> 'id')::uuid, (before_row ->> 'id')::uuid),
    txid_current(),
    before_row,
    after_row
  );
  return null;
end;
$function$
;
