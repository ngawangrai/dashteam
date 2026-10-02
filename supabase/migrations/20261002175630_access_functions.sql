-- Who may use the app. Created before the people table (plpgsql resolves tables when called), because
-- the RLS policies on people, pay and change requests call these functions.

create function public.thimphu_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Thimphu')::date $$;

-- The signed-in person's own record, only while they still have access: their last working day
-- (end_date) has not passed in Thimphu. Null for an admin with no person record, or an exited person.
create function public.current_person_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select id
    from public.people
    where profile_id = (select auth.uid())
      and (end_date is null or end_date >= public.thimphu_today())
  );
end;
$$;

-- Access: a person whose employment has not ended, or an admin with no person record (the founder).
-- A person whose employment has ended has no access, whatever their role.
create function public.has_access()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  linked boolean;
begin
  if public.current_person_id() is not null then
    return true;
  end if;
  select exists (select 1 from public.people where profile_id = (select auth.uid())) into linked;
  if linked then
    return false;
  end if;
  return exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
end;
$$;

-- Admin rights now also require access, so an admin whose employment has ended is shut out by every policy.
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  ) and public.has_access();
end;
$$;

revoke execute on function public.thimphu_today() from public, anon;
revoke execute on function public.current_person_id() from public, anon;
revoke execute on function public.has_access() from public, anon;
grant execute on function public.thimphu_today() to authenticated;
grant execute on function public.current_person_id() to authenticated;
grant execute on function public.has_access() to authenticated;
