-- Milestone 6: the IT-1(a) schedule, filing records, receipts and reminders.
-- The schedule and receipts are written once and never change; the filing record is the admin's to
-- edit, and every edit is audited. Reminders are written only by the daily job, at most one a day.

-- ── The schedule: made once, from a locked month ───────────────────────────────────
create function public.guard_it1a_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'An IT-1(a) schedule never changes once it’s made.' using errcode = 'restrict_violation';
  end if;
  if not exists (select 1 from public.payroll_runs r where r.id = new.run_id and r.status = 'locked' and r.month = new.month) then
    raise exception 'An IT-1(a) schedule is made only for a locked month.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger it1a_schedules_guard before insert or update or delete on public.it1a_schedules
  for each row execute function public.guard_it1a_schedule();
create trigger it1a_schedules_no_truncate before truncate on public.it1a_schedules
  for each statement execute function public.reject_payroll_truncate();
create trigger it1a_schedules_audit after insert or update or delete on public.it1a_schedules
  for each row execute function public.write_audit_entry('xls');

-- ── Receipts: kept as uploaded ─────────────────────────────────────────────────────
create function public.reject_change_once_written()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This is kept as it was saved and can’t be changed or removed.' using errcode = 'restrict_violation';
end;
$$;

create trigger filing_receipts_guard before update or delete on public.filing_receipts
  for each row execute function public.reject_change_once_written();
create trigger filing_receipts_no_truncate before truncate on public.filing_receipts
  for each statement execute function public.reject_payroll_truncate();
create trigger filing_receipts_audit after insert or update or delete on public.filing_receipts
  for each row execute function public.write_audit_entry('bytes');

-- ── The filing record: for a locked month; changes are audited; never removed ──────
create function public.guard_filing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
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

create trigger filings_guard before insert or update or delete on public.filings
  for each row execute function public.guard_filing();
create trigger filings_no_truncate before truncate on public.filings
  for each statement execute function public.reject_payroll_truncate();
create trigger filings_audit after insert or update or delete on public.filings
  for each row execute function public.write_audit_entry();

-- ── Reminders: one row per day, written once ───────────────────────────────────────
create trigger filing_reminders_guard before update or delete on public.filing_reminders
  for each row execute function public.reject_change_once_written();
create trigger filing_reminders_audit after insert or update or delete on public.filing_reminders
  for each row execute function public.write_audit_entry();

-- Admins' email addresses, for reminders. Owner only: the daily job calls it on the server.
create function public.admin_emails()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from public.profiles pr
  join auth.users u on u.id = pr.id
  where pr.role = 'admin'
    and u.email is not null
    and not exists (select 1 from public.people ended where ended.profile_id = pr.id and ended.end_date < public.thimphu_today())
$$;

-- ── Downloads are recorded ─────────────────────────────────────────────────────────
create function public.record_filing_download(kind text, subject uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  if kind = 'schedule' and exists (select 1 from public.it1a_schedules where id = subject) then
    insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
    values ((select auth.uid()), 'filing.schedule_downloaded', 'it1a_schedules', subject, txid_current(), null, null);
  elsif kind = 'receipt' and exists (select 1 from public.filing_receipts where id = subject) then
    insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
    values ((select auth.uid()), 'filing.receipt_downloaded', 'filing_receipts', subject, txid_current(), null, null);
  else
    raise exception 'There’s nothing like that to download.';
  end if;
end;
$$;

-- ── Undo: reads (downloads, reveals) are recorded but aren't changes ───────────────
create function public.audit_records_a_change(action text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select action !~ '(downloaded|revealed)$' $$;

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

  perform set_config('dashteam.undoing', 'on', true);

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

  perform set_config('dashteam.undoing', '', true);
  return undone;
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────────────
revoke all on table public.it1a_schedules, public.filing_receipts, public.filings, public.filing_reminders from anon, authenticated;
grant select, insert on table public.it1a_schedules to authenticated;
grant select, insert on table public.filing_receipts to authenticated;
grant select, insert, update on table public.filings to authenticated;
-- Reminders are written only by the daily job, on the server's own connection.
grant select on table public.filing_reminders to authenticated;

revoke execute on function public.admin_emails() from public, anon, authenticated;
revoke execute on function public.record_filing_download(text, uuid) from public, anon;
grant execute on function public.record_filing_download(text, uuid) to authenticated;
revoke execute on function public.guard_it1a_schedule() from public, anon, authenticated;
revoke execute on function public.guard_filing() from public, anon, authenticated;
