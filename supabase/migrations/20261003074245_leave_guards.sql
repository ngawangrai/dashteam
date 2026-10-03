-- Guards, audit and the team calendar for leave.

-- ── No overlapping leave for the same person ────────────────────────────────────
create extension if not exists btree_gist with schema extensions;

alter table public.leave_requests
  add constraint leave_requests_no_overlap
  exclude using gist (
    person_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'approved'));

-- ── Locked payroll months ──────────────────────────────────────────────────────
-- Milestone 4 replaces this: no leave may be added, changed or cancelled inside a locked month.
create function public.leave_month_locked(day date)
returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;

create function public.leave_span_locked(first_day date, last_day date)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  month date := date_trunc('month', first_day)::date;
begin
  while month <= last_day loop
    if public.leave_month_locked(month) then
      return true;
    end if;
    month := (month + interval '1 month')::date;
  end loop;
  return false;
end;
$$;

-- ── What may change on a request, and by whom ───────────────────────────────────
-- pending  → approved / declined   an admin
-- pending  → cancelled             the person or an admin
-- approved → cancelled             an admin, or the person while the leave hasn't started
-- The person may also mark a decision as seen. Nothing else changes after sending.
create function public.guard_leave_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_owner boolean := new.person_id = public.current_person_id();
  admin boolean := public.is_admin();
begin
  if current_setting('dashteam.undoing', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.leave_span_locked(new.start_date, new.end_date) then
      raise exception 'Payroll for this month is locked. Ask your admin to add a correction instead.' using errcode = 'restrict_violation';
    end if;
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

  if public.leave_span_locked(old.start_date, old.end_date) then
    raise exception 'Payroll for this month is locked. Ask your admin to add a correction instead.' using errcode = 'restrict_violation';
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

create trigger leave_requests_guard
  before insert or update on public.leave_requests
  for each row execute function public.guard_leave_request();

-- ── Audit ───────────────────────────────────────────────────────────────────────
create trigger leave_requests_audit after insert or update or delete on public.leave_requests
  for each row execute function public.write_audit_entry();
create trigger holidays_audit after insert or update or delete on public.holidays
  for each row execute function public.write_audit_entry();
create trigger exit_leave_settlements_audit after insert or update or delete on public.exit_leave_settlements
  for each row execute function public.write_audit_entry();

-- ── Holidays ────────────────────────────────────────────────────────────────────
create trigger holidays_set_updated_at
  before update on public.holidays
  for each row execute function public.set_updated_at();

-- A holiday change shifts how leave is counted, so it must never reach into a locked payroll month.
-- (Milestone 4 makes leave_month_locked() real; until then this always allows the change.)
create function public.guard_holiday()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('dashteam.undoing', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and public.leave_span_locked(old.start_date, old.end_date) then
    raise exception 'This holiday is in a locked payroll month and can’t be changed.' using errcode = 'restrict_violation';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.leave_span_locked(new.start_date, new.end_date) then
    raise exception 'That date is in a locked payroll month.' using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger holidays_guard
  before insert or update or delete on public.holidays
  for each row execute function public.guard_holiday();

-- Notes are audited too, so undoing a holiday change also removes the notes it wrote.
create trigger leave_notices_audit after insert or update or delete on public.leave_notices
  for each row execute function public.write_audit_entry();

-- ── Who's out, for everyone ─────────────────────────────────────────────────────
-- Names and dates of approved leave only. Never the type, balances or pending requests:
-- those stay with the person and the admin.
create function public.team_out(from_date date, to_date date)
returns table (person_id uuid, full_name text, start_date date, end_date date, start_half boolean, end_half boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_access() then
    return;
  end if;
  return query
    select request.person_id, person.full_name, request.start_date, request.end_date, request.start_half, request.end_half
    from public.leave_requests request
    join public.people person on person.id = request.person_id
    where request.status = 'approved'
      and request.start_date <= to_date
      and request.end_date >= from_date
    order by request.start_date, person.full_name;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────────
revoke all on table public.holidays, public.leave_requests, public.exit_leave_settlements, public.leave_notices from anon, authenticated;
grant select, insert, update, delete on table public.holidays to authenticated;
grant select, insert on table public.leave_notices to authenticated;
-- People may only mark their own notes seen.
grant update (seen_at) on table public.leave_notices to authenticated;
grant select, insert, update on table public.leave_requests to authenticated;
grant select, insert, update, delete on table public.exit_leave_settlements to authenticated;

revoke execute on function public.team_out(date, date) from public, anon;
grant execute on function public.team_out(date, date) to authenticated;
revoke execute on function public.leave_month_locked(date) from public, anon;
revoke execute on function public.leave_span_locked(date, date) from public, anon;
grant execute on function public.leave_month_locked(date) to authenticated;
grant execute on function public.leave_span_locked(date, date) to authenticated;
