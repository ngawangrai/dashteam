-- Runs before the profiles table exists, so it is plpgsql (body resolved at call time).
-- security definer lets RLS policies on profiles call it without recursing into themselves.
create function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
end;
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
