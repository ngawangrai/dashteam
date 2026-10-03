-- Milestone 4: locked payroll months. A locked month is frozen for good: its run, snapshots, one-off
-- lines and acknowledgements never change, and nothing it used can change either (leave, holidays,
-- pay records, join and exit dates, rules). Every guard here ignores the undo flag, so Undo can't
-- reach into a locked month. A correction is a one-off line in a later month.
--
-- Refusals name the month in a token the app reads to say what to do instead:
--   "October 2026 payroll is locked. [payroll_locked:2026-10:2026-11]"  (locked month : first open month)

-- ── Which months are locked ─────────────────────────────────────────────────────
-- Security definer: these are called from guards that run as an employee, who can't read payroll_runs.

create function public.payroll_month_locked(day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payroll_runs
    where month = date_trunc('month', day)::date and status = 'locked'
  )
$$;

create function public.latest_locked_month()
returns date
language sql
stable
security definer
set search_path = ''
as $$ select max(month) from public.payroll_runs where status = 'locked' $$;

create function public.payroll_locked_error(day date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format(
    '%s payroll is locked. [payroll_locked:%s:%s]',
    to_char(day, 'FMMonth YYYY'),
    to_char(day, 'YYYY-MM'),
    to_char(greatest(coalesce(public.latest_locked_month(), date_trunc('month', day)::date), date_trunc('month', day)::date) + interval '1 month', 'YYYY-MM')
  )
$$;

-- The first month DashTeam pays, from the payroll settings in force now. Null until it is set.
create function public.payroll_first_month()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (value ->> 'first_month')::date
  from public.rules
  where key = 'payroll_settings'
    and employment_type = 'full_time'
    and effective_from <= date_trunc('month', public.thimphu_today())::date
  order by effective_from desc
  limit 1
$$;

-- Milestone 3 called this hook; it is real now.
create or replace function public.leave_month_locked(day date)
returns boolean
language sql
stable
set search_path = ''
as $$ select public.payroll_month_locked(day) $$;

-- The first locked month a date span touches, or null.
create function public.locked_month_in_span(first_day date, last_day date)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  month date := date_trunc('month', first_day)::date;
begin
  while month <= last_day loop
    if public.payroll_month_locked(month) then
      return month;
    end if;
    month := (month + interval '1 month')::date;
  end loop;
  return null;
end;
$$;

-- ── Payroll runs ────────────────────────────────────────────────────────────────
-- Created as a draft; locked once, in order, with a snapshot for everyone employed that month.
-- A locked run never changes again and no run is ever removed.
create function public.guard_payroll_run()
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
  if new.month <> old.month then
    raise exception 'A payroll run’s month can’t change.' using errcode = 'restrict_violation';
  end if;
  if new.status = 'draft' then
    return new;
  end if;

  -- Locking.
  first_month := public.payroll_first_month();
  if first_month is null then
    raise exception 'Choose the first month DashTeam pays before locking.' using errcode = 'restrict_violation';
  end if;
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

  month_end := (new.month + interval '1 month - 1 day')::date;
  if exists (
    select 1 from public.people person
    where person.start_date <= month_end
      and (person.end_date is null or person.end_date >= new.month)
      and not exists (select 1 from public.payroll_snapshots s where s.run_id = new.id and s.person_id = person.id)
  ) then
    raise exception 'Everyone paid this month needs a snapshot before locking.' using errcode = 'restrict_violation';
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

create trigger payroll_runs_guard
  before insert or update or delete on public.payroll_runs
  for each row execute function public.guard_payroll_run();

-- ── Snapshots: written once, while the run is being locked ──────────────────────
create function public.guard_payroll_snapshot()
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
  raise exception 'Payroll snapshots never change. Add a correction to a later month.' using errcode = 'restrict_violation';
end;
$$;

create trigger payroll_snapshots_guard
  before insert or update or delete on public.payroll_snapshots
  for each row execute function public.guard_payroll_snapshot();

-- ── One-off lines and acknowledgements: free in a draft, frozen once locked ──────
create function public.guard_payroll_month_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.payroll_month_locked(old.month) then
    raise exception '%', public.payroll_locked_error(old.month) using errcode = 'restrict_violation';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.payroll_month_locked(new.month) then
    raise exception '%', public.payroll_locked_error(new.month) using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and current_setting('dashteam.undoing', true) is distinct from 'on' then
    raise exception 'This can’t be edited. Remove it and add it again.' using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payroll_lines_guard
  before insert or update or delete on public.payroll_lines
  for each row execute function public.guard_payroll_month_row();
create trigger payroll_acknowledgements_guard
  before insert or update or delete on public.payroll_acknowledgements
  for each row execute function public.guard_payroll_month_row();

-- No emptying a payroll table, even by the database owner.
create function public.reject_payroll_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Payroll records can’t be emptied.' using errcode = 'restrict_violation';
end;
$$;

create trigger payroll_runs_no_truncate before truncate on public.payroll_runs
  for each statement execute function public.reject_payroll_truncate();
create trigger payroll_snapshots_no_truncate before truncate on public.payroll_snapshots
  for each statement execute function public.reject_payroll_truncate();
create trigger payroll_lines_no_truncate before truncate on public.payroll_lines
  for each statement execute function public.reject_payroll_truncate();
create trigger payroll_acknowledgements_no_truncate before truncate on public.payroll_acknowledgements
  for each statement execute function public.reject_payroll_truncate();

-- ── Leave: nothing new, approved or cancelled inside a locked month ───────────────
-- A pending request in a locked month can still be declined or cancelled: it was never paid as taken,
-- so that changes no figure the month used. Approving it, or cancelling approved leave, can't happen.
create or replace function public.guard_leave_request()
returns trigger
language plpgsql
set search_path = ''
as $$
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

  if current_setting('dashteam.undoing', true) = 'on' then
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
$$;

-- ── Holidays: never added, moved or removed in a locked month ─────────────────────
create or replace function public.guard_holiday()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  locked date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    locked := public.locked_month_in_span(old.start_date, old.end_date);
    -- Confirming a tentative date in a locked month changes only its label, never a count.
    if locked is not null and not (
      tg_op = 'UPDATE'
      and (new.name, new.start_date, new.end_date, new.year, new.kind, new.scope)
          is not distinct from (old.name, old.start_date, old.end_date, old.year, old.kind, old.scope)
    ) then
      raise exception '%', public.payroll_locked_error(locked) using errcode = 'restrict_violation';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    locked := public.locked_month_in_span(new.start_date, new.end_date);
    if locked is not null and (tg_op = 'INSERT' or (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date)) then
      raise exception '%', public.payroll_locked_error(locked) using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- ── Pay records: nothing dated on or before the latest locked month ────────────────
create or replace function public.protect_pay_records()
returns trigger
language plpgsql
set search_path = ''
as $$
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

  if current_setting('dashteam.undoing', true) = 'on' then
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
$$;

-- ── People: join and exit dates can't change who was paid in a locked month ────────
-- Compares the part of each locked month the person was employed for, before and after.
-- Removing someone who was paid in a locked month is refused by the snapshot's foreign key.
create function public.guard_people_locked_months()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run record;
  month_span daterange;
  before_part daterange;
  after_part daterange;
begin
  if tg_op = 'UPDATE' and (new.start_date, new.end_date) is not distinct from (old.start_date, old.end_date) then
    return new;
  end if;
  for run in select month from public.payroll_runs where status = 'locked' order by month loop
    month_span := daterange(run.month, (run.month + interval '1 month')::date, '[)');
    before_part := case when tg_op = 'INSERT' then 'empty'::daterange else daterange(old.start_date, old.end_date, '[]') * month_span end;
    after_part := daterange(new.start_date, new.end_date, '[]') * month_span;
    if before_part is distinct from after_part then
      raise exception '%', public.payroll_locked_error(run.month) using errcode = 'restrict_violation';
    end if;
  end loop;
  return new;
end;
$$;

create trigger people_locked_months
  before insert or update on public.people
  for each row execute function public.guard_people_locked_months();

-- ── Rules ─────────────────────────────────────────────────────────────────────────
-- A new rule can't start on or before the latest locked month, and the first payroll month can't
-- change once a month is locked. Payroll settings rows can be removed (or undone) only while no
-- month is locked: until then they only shape drafts.
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

  if old.effective_from <= (now() at time zone 'Asia/Thimphu')::date then
    raise exception 'A rule already in force cannot be deleted.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

create function public.guard_rule_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest date := public.latest_locked_month();
begin
  if latest is null then
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

create trigger rules_guard_insert
  before insert on public.rules
  for each row execute function public.guard_rule_insert();

-- Admins set payroll settings in the app (RLS allows that key only).
create policy "rules_insert_settings_admin" on public.rules as permissive for insert to authenticated
  with check ((select public.is_admin()) and key = 'payroll_settings');
create policy "rules_delete_settings_admin" on public.rules as permissive for delete to authenticated
  using ((select public.is_admin()) and key = 'payroll_settings');

-- ── Audit ─────────────────────────────────────────────────────────────────────────
create trigger rules_audit after insert or update or delete on public.rules
  for each row execute function public.write_audit_entry();
create trigger payroll_runs_audit after insert or update or delete on public.payroll_runs
  for each row execute function public.write_audit_entry();
create trigger payroll_snapshots_audit after insert or update or delete on public.payroll_snapshots
  for each row execute function public.write_audit_entry();
create trigger payroll_lines_audit after insert or update or delete on public.payroll_lines
  for each row execute function public.write_audit_entry();
create trigger payroll_acknowledgements_audit after insert or update or delete on public.payroll_acknowledgements
  for each row execute function public.write_audit_entry();

-- Downloading the bank transfer list (account numbers in full) is recorded too.
create function public.record_bank_list_download(run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_month date;
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  select month into run_month from public.payroll_runs where id = run and status = 'locked';
  if run_month is null then
    raise exception 'Only a locked month has a bank transfer list.';
  end if;
  insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
  values ((select auth.uid()), 'payroll.bank_list_downloaded', 'payroll_runs', run, txid_current(), null,
          jsonb_build_object('month', run_month));
end;
$$;

-- The bank list download isn't a change to undo, and must not block undoing anything else.
create or replace function public.undo_transaction(target_transaction bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  where transaction_id = target_transaction and action not in ('sensitive.revealed', 'payroll.bank_list_downloaded');

  if last_entry is null then
    raise exception 'There is nothing to undo.';
  end if;

  if exists (
    select 1 from public.audit_log
    where transaction_id = target_transaction
      and action not in ('sensitive.revealed', 'payroll.bank_list_downloaded')
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
     and later.action not in ('sensitive.revealed', 'payroll.bank_list_downloaded')
    where done.transaction_id = target_transaction
  ) then
    raise exception 'This was changed since, so it can''t be undone.';
  end if;

  perform set_config('dashteam.undoing', 'on', true);

  for entry in
    select * from public.audit_log
    where transaction_id = target_transaction and action not in ('sensitive.revealed', 'payroll.bank_list_downloaded')
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

  perform set_config('dashteam.undoing', '', true);
  return undone;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────────
revoke all on table public.payroll_runs, public.payroll_snapshots, public.payroll_lines, public.payroll_acknowledgements from anon, authenticated;
grant select, insert, update on table public.payroll_runs to authenticated;
grant select, insert on table public.payroll_snapshots to authenticated;
grant select, insert, delete on table public.payroll_lines to authenticated;
grant select, insert, delete on table public.payroll_acknowledgements to authenticated;
-- RLS limits these to admins and the payroll_settings key.
grant insert, delete on table public.rules to authenticated;

revoke execute on function public.payroll_month_locked(date) from public, anon;
revoke execute on function public.latest_locked_month() from public, anon;
revoke execute on function public.payroll_locked_error(date) from public, anon;
revoke execute on function public.payroll_first_month() from public, anon;
revoke execute on function public.locked_month_in_span(date, date) from public, anon;
revoke execute on function public.record_bank_list_download(uuid) from public, anon;
grant execute on function public.payroll_month_locked(date) to authenticated;
grant execute on function public.latest_locked_month() to authenticated;
grant execute on function public.payroll_locked_error(date) to authenticated;
grant execute on function public.payroll_first_month() to authenticated;
grant execute on function public.locked_month_in_span(date, date) to authenticated;
grant execute on function public.record_bank_list_download(uuid) to authenticated;
revoke execute on function public.guard_payroll_run() from public, anon, authenticated;
revoke execute on function public.guard_payroll_snapshot() from public, anon, authenticated;
revoke execute on function public.guard_people_locked_months() from public, anon, authenticated;
revoke execute on function public.guard_rule_insert() from public, anon, authenticated;
