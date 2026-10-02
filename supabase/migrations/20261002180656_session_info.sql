-- What the app needs to know about the signed-in person on every request, in one call.
-- Includes the end date even after access has ended, so the app can say when it ended;
-- RLS hides the record itself from them by then.
create function public.session_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  info jsonb;
begin
  if me is null then
    return null;
  end if;
  select jsonb_build_object(
    'role', profile.role,
    'has_access', public.has_access(),
    'person_id', person.id,
    'full_name', person.full_name,
    'end_date', person.end_date
  )
  into info
  from public.profiles profile
  left join public.people person on person.profile_id = profile.id
  where profile.id = me;
  return info;
end;
$$;

revoke execute on function public.session_info() from public, anon;
grant execute on function public.session_info() to authenticated;
