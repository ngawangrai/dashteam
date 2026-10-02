-- Guards, audit and undo for people, pay records and profile change requests.

-- ── updated_at ────────────────────────────────────────────────────────────────
create trigger people_set_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

-- ── Pay records: dated, append-only ───────────────────────────────────────────
-- Never updated. A new record starts this month or later (a person's first record may start in their
-- joining month). Only records starting this month or later can be removed, so past months never move.
-- Undo (dashteam.undoing) and removing a person who was just added are the only exceptions.
create function public.protect_pay_records()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  this_month date := date_trunc('month', public.thimphu_today())::date;
begin
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

create trigger pay_records_protect
  before insert or update or delete on public.pay_records
  for each row execute function public.protect_pay_records();

-- ── Change requests: allowed transitions ──────────────────────────────────────
-- pending → approved / declined by an admin; pending → withdrawn by the person who asked.
-- Nothing else about a request can change after it is sent.
create function public.guard_profile_change_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('dashteam.undoing', true) = 'on' then
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
$$;

create trigger profile_change_requests_guard
  before update on public.profile_change_requests
  for each row execute function public.guard_profile_change_request();

-- ── Audit log ─────────────────────────────────────────────────────────────────
-- Every insert, update and delete on these tables is recorded by trigger, so app code cannot skip it.
-- The app names the action with set_config('dashteam.action', 'person.exited', true) before writing.
-- Encrypted fields appear as ciphertext (undo needs them); plaintext never reaches this table.
create function public.write_audit_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text := nullif(current_setting('dashteam.action', true), '');
  before_row jsonb;
  after_row jsonb;
begin
  if current_setting('dashteam.undoing', true) = 'on' then
    label := 'undo';
  end if;
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;

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
$$;

create trigger people_audit after insert or update or delete on public.people
  for each row execute function public.write_audit_entry();
create trigger pay_records_audit after insert or update or delete on public.pay_records
  for each row execute function public.write_audit_entry();
create trigger profile_change_requests_audit after insert or update or delete on public.profile_change_requests
  for each row execute function public.write_audit_entry();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.write_audit_entry();

-- Append-only, even for the database owner.
create function public.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log cannot be changed or removed.' using errcode = 'restrict_violation';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_change();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_audit_change();

-- Showing a TPN or bank account in full is recorded too.
create function public.record_reveal(person uuid, field text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if field not in ('tpn', 'bank_account') then
    raise exception 'Unknown field.';
  end if;
  if not (public.is_admin() or person = public.current_person_id()) then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
  values ((select auth.uid()), 'sensitive.revealed', 'people', person, txid_current(), null, jsonb_build_object('field', field));
end;
$$;

-- ── Undo ──────────────────────────────────────────────────────────────────────
-- Reverts everything one transaction wrote, newest first, if the same person asks within 10 minutes
-- and nothing has touched those rows since. Returns what it reverted. The undo is itself audited.
create function public.undo_transaction(target_transaction bigint)
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
  where transaction_id = target_transaction and action <> 'sensitive.revealed';

  if last_entry is null then
    raise exception 'There is nothing to undo.';
  end if;

  if exists (
    select 1 from public.audit_log
    where transaction_id = target_transaction
      and action <> 'sensitive.revealed'
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
     and later.action <> 'sensitive.revealed'
    where done.transaction_id = target_transaction
  ) then
    raise exception 'This was changed since, so it can''t be undone.';
  end if;

  perform set_config('dashteam.undoing', 'on', true);

  for entry in
    select * from public.audit_log
    where transaction_id = target_transaction and action <> 'sensitive.revealed'
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

-- Finding an existing login by email when an admin adds someone who already has one (the admin themself).
create function public.auth_user_id_for_email(lookup_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  return (select id from auth.users where lower(email) = lower(lookup_email) limit 1);
end;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
revoke all on table public.people, public.pay_records, public.profile_change_requests, public.audit_log from anon;
revoke all on table public.people, public.pay_records, public.profile_change_requests, public.audit_log from authenticated;
grant select, insert, update on table public.people to authenticated;
grant select, insert, delete on table public.pay_records to authenticated;
grant select, insert, update on table public.profile_change_requests to authenticated;
grant select on table public.audit_log to authenticated;

revoke execute on function public.record_reveal(uuid, text) from public, anon;
revoke execute on function public.undo_transaction(bigint) from public, anon;
revoke execute on function public.auth_user_id_for_email(text) from public, anon;
grant execute on function public.record_reveal(uuid, text) to authenticated;
grant execute on function public.undo_transaction(bigint) to authenticated;
grant execute on function public.auth_user_id_for_email(text) to authenticated;
revoke execute on function public.write_audit_entry() from public, anon, authenticated;
