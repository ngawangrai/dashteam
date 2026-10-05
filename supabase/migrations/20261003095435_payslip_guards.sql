-- Milestone 5: payslips and the email outbox.
-- A payslip is written once, from a locked snapshot, and never changes. Emails are rows in an outbox
-- that only these functions write, so every send is claimed once, recorded, and safe to retry.

-- ── Audit: leave large binary columns out of the log ──────────────────────────────
-- Triggers may name columns to leave out (the payslip PDF): the log keeps the row's identity and
-- figures, and the file itself stays in one place.
create or replace function public.write_audit_entry()
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
$$;

-- ── Payslips: written once, from a locked snapshot ────────────────────────────────
create function public.guard_payslip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger payslips_guard
  before insert or update or delete on public.payslips
  for each row execute function public.guard_payslip();
create trigger payslips_no_truncate before truncate on public.payslips
  for each statement execute function public.reject_payroll_truncate();
create trigger payslips_audit after insert or update or delete on public.payslips
  for each row execute function public.write_audit_entry('pdf');

-- ── The outbox: what may change about an email ────────────────────────────────────
-- Only status and its bookkeeping change, never what the email is or who it goes to. Sent and skipped
-- are final. Rows are never removed. (A deleted person's leave requests go, so that link may clear.)
create function public.guard_email_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Emails are kept, sent or not.' using errcode = 'restrict_violation';
  end if;
  if new.leave_request_id is null and old.leave_request_id is not null
     and (new.kind, new.payslip_id, new.to_email, new.dedupe_key, new.context, new.status, new.requested_by, new.created_at)
         is not distinct from (old.kind, old.payslip_id, old.to_email, old.dedupe_key, old.context, old.status, old.requested_by, old.created_at) then
    return new;
  end if;
  if old.status in ('sent', 'skipped') then
    raise exception 'This email is already %.', old.status using errcode = 'restrict_violation';
  end if;
  if (new.kind, new.payslip_id, new.leave_request_id, new.to_email, new.dedupe_key, new.context, new.requested_by, new.created_at)
     is distinct from
     (old.kind, old.payslip_id, old.leave_request_id, old.to_email, old.dedupe_key, old.context, old.requested_by, old.created_at) then
    raise exception 'An email can’t be changed after it’s queued.' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger email_deliveries_guard
  before update or delete on public.email_deliveries
  for each row execute function public.guard_email_delivery();
create trigger email_deliveries_no_truncate before truncate on public.email_deliveries
  for each statement execute function public.reject_payroll_truncate();
create trigger email_deliveries_audit after insert or update or delete on public.email_deliveries
  for each row execute function public.write_audit_entry();

-- ── Queuing payslip emails ─────────────────────────────────────────────────────────
-- payslip         the automatic email on lock: admins only, once per payslip, ever
-- payslip_resend  an admin sending it again: once per click (the nonce)
-- payslip_self    a person emailing their own payslip to themselves: once per click
-- Goes to the person's email as it is now. Returns the delivery, new or the one already queued.
create function public.queue_payslip_email(payslip uuid, email public.email_kind, nonce text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  address text;
  key text;
  delivery uuid;
begin
  select person_id into owner from public.payslips where id = payslip;
  if owner is null then
    raise exception 'There’s no such payslip.';
  end if;
  if email in ('payslip', 'payslip_resend') then
    if not public.is_admin() then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
  elsif email = 'payslip_self' then
    if owner is distinct from public.current_person_id() then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'That isn’t a payslip email.';
  end if;

  select person.email into address from public.people person where person.id = owner;
  key := case when email = 'payslip' then 'payslip:' || payslip
              else email::text || ':' || payslip || ':' || coalesce(nullif(nonce, ''), gen_random_uuid()::text) end;

  perform set_config('dashteam.action',
    case email when 'payslip' then 'payslip.email_queued' when 'payslip_resend' then 'payslip.resent' else 'payslip.emailed_to_self' end, true);
  insert into public.email_deliveries (kind, payslip_id, to_email, dedupe_key, requested_by)
  values (email, payslip, address, key, (select auth.uid()))
  on conflict (dedupe_key) do nothing
  returning id into delivery;
  if delivery is null then
    select id into delivery from public.email_deliveries where dedupe_key = key;
  end if;
  return delivery;
end;
$$;

-- ── Queuing leave emails ───────────────────────────────────────────────────────────
-- leave_requested  to every admin with access (not the person asking): by the person or an admin
-- leave_decided    to the person, after an approval or decline: by an admin
-- Each waits a moment so Undo can still take the change back; at send time the app checks the
-- request still matches `context` and skips the email if not. Returns how many were queued.
create function public.queue_leave_email(request uuid, email public.email_kind, delay_seconds integer default 15)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  leave record;
  admin_email text;
  queued integer := 0;
  send_at timestamptz := now() + make_interval(secs => greatest(delay_seconds, 0));
begin
  select r.id, r.person_id, r.status, r.decided_at, p.email as person_email
  into leave
  from public.leave_requests r
  join public.people p on p.id = r.person_id
  where r.id = request;
  if leave.id is null then
    raise exception 'There’s no such request.';
  end if;

  perform set_config('dashteam.action', 'email.queued', true);

  if email = 'leave_requested' then
    if not (leave.person_id = public.current_person_id() or public.is_admin()) then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
    for admin_email in
      select lower(u.email)
      from public.profiles pr
      join auth.users u on u.id = pr.id
      where pr.role = 'admin'
        and u.email is not null
        and lower(u.email) <> lower(leave.person_email)
        and not exists (select 1 from public.people ended where ended.profile_id = pr.id and ended.end_date < public.thimphu_today())
    loop
      insert into public.email_deliveries (kind, leave_request_id, to_email, dedupe_key, context, send_after, requested_by)
      values ('leave_requested', request, admin_email, 'leave_requested:' || request || ':' || admin_email,
              jsonb_build_object('status', 'pending'), send_at, (select auth.uid()))
      on conflict (dedupe_key) do nothing;
      if found then queued := queued + 1; end if;
    end loop;
  elsif email = 'leave_decided' then
    if not public.is_admin() then
      raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
    end if;
    if leave.status not in ('approved', 'declined') then
      raise exception 'This request hasn’t been decided.';
    end if;
    insert into public.email_deliveries (kind, leave_request_id, to_email, dedupe_key, context, send_after, requested_by)
    values ('leave_decided', request, leave.person_email,
            'leave_decided:' || request || ':' || leave.status || ':' || extract(epoch from leave.decided_at)::text,
            jsonb_build_object('status', leave.status, 'decided_at', leave.decided_at), send_at, (select auth.uid()))
    on conflict (dedupe_key) do nothing;
    if found then queued := queued + 1; end if;
  else
    raise exception 'That isn’t a leave email.';
  end if;
  return queued;
end;
$$;

-- ── Sending: claim, then finish ────────────────────────────────────────────────────
-- A claim is atomic: two retries at once can't both send. A send that died part way (claimed over
-- five minutes ago) can be claimed again; the provider's idempotency key stops a second delivery.
create function public.claim_email_delivery(delivery uuid)
returns setof public.email_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('dashteam.action', 'email.sending', true);
  return query
    update public.email_deliveries d
    set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
    where d.id = delivery
      and d.send_after <= now()
      and (d.status in ('queued', 'failed') or (d.status = 'sending' and d.claimed_at < now() - interval '5 minutes'))
      and (public.is_admin() or d.requested_by = (select auth.uid()))
    returning d.*;
end;
$$;

create function public.finish_email_delivery(delivery uuid, outcome public.email_status, provider text default null, error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if outcome not in ('sent', 'failed', 'skipped') then
    raise exception 'An email ends sent, failed or skipped.';
  end if;
  perform set_config('dashteam.action', 'email.' || outcome::text, true);
  update public.email_deliveries d
  set status = outcome,
      provider_id = coalesce(provider, d.provider_id),
      last_error = case when outcome = 'failed' then left(coalesce(error, 'It didn’t send.'), 300) else null end,
      sent_at = case when outcome = 'sent' then now() else d.sent_at end
  where d.id = delivery
    and d.status = 'sending'
    and (public.is_admin() or d.requested_by = (select auth.uid()));
  if not found then
    raise exception 'This email isn’t being sent right now.';
  end if;
end;
$$;

-- Opening a payslip as an admin is recorded, like the bank list.
create function public.record_payslip_download(payslip uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.payslips where id = payslip) then
    raise exception 'There’s no such payslip.';
  end if;
  insert into public.audit_log (actor_id, action, entity_table, entity_id, transaction_id, before, after)
  values ((select auth.uid()), 'payslip.downloaded', 'payslips', payslip, txid_current(), null, null);
end;
$$;

-- The download entry isn't a change, so it must not block undoing anything else.
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
  not_changes constant text[] := array['sensitive.revealed', 'payroll.bank_list_downloaded', 'payslip.downloaded'];
begin
  if caller is null then
    raise exception 'Sign in to undo.' using errcode = 'insufficient_privilege';
  end if;

  select max(id) into last_entry
  from public.audit_log
  where transaction_id = target_transaction and action <> all (not_changes);

  if last_entry is null then
    raise exception 'There is nothing to undo.';
  end if;

  if exists (
    select 1 from public.audit_log
    where transaction_id = target_transaction
      and action <> all (not_changes)
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
     and later.action <> all (not_changes)
    where done.transaction_id = target_transaction
  ) then
    raise exception 'This was changed since, so it can''t be undone.';
  end if;

  perform set_config('dashteam.undoing', 'on', true);

  for entry in
    select * from public.audit_log
    where transaction_id = target_transaction and action <> all (not_changes)
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
revoke all on table public.payslips, public.email_deliveries from anon, authenticated;
grant select, insert on table public.payslips to authenticated;
-- The outbox is written only through the functions above.
grant select on table public.email_deliveries to authenticated;

revoke execute on function public.queue_payslip_email(uuid, public.email_kind, text) from public, anon;
revoke execute on function public.queue_leave_email(uuid, public.email_kind, integer) from public, anon;
revoke execute on function public.claim_email_delivery(uuid) from public, anon;
revoke execute on function public.finish_email_delivery(uuid, public.email_status, text, text) from public, anon;
revoke execute on function public.record_payslip_download(uuid) from public, anon;
grant execute on function public.queue_payslip_email(uuid, public.email_kind, text) to authenticated;
grant execute on function public.queue_leave_email(uuid, public.email_kind, integer) to authenticated;
grant execute on function public.claim_email_delivery(uuid) to authenticated;
grant execute on function public.finish_email_delivery(uuid, public.email_status, text, text) to authenticated;
grant execute on function public.record_payslip_download(uuid) to authenticated;
revoke execute on function public.guard_payslip() from public, anon, authenticated;
