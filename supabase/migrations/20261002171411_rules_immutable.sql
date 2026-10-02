-- Rules are append-only. A change is a new row with a later effective_from, so a past payroll
-- month always resolves to the same rules. Updates are never allowed; a rule that is already in
-- force (by Thimphu time) cannot be deleted either. A future rule entered by mistake can be.
create function public.protect_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Rules cannot be changed. Add a new rule with a later effective_from.'
      using errcode = 'restrict_violation';
  end if;

  if old.effective_from <= (now() at time zone 'Asia/Thimphu')::date then
    raise exception 'A rule already in force cannot be deleted.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

create trigger rules_protect
  before update or delete on public.rules
  for each row execute function public.protect_rules();

-- Admins read through RLS. Nobody writes through the API: rule changes will be an audited admin action.
revoke all on table public.rules from anon;
revoke insert, update, delete, truncate, references, trigger on table public.rules from authenticated;
