-- Local development and CI only. Hosted projects never run this file.
-- Two people, one per role. Sign in at /login with either email; the code arrives in Mailpit (http://127.0.0.1:54324).
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'admin@dashteam.local', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Tashi Dorji"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'employee@dashteam.local', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sonam Wangmo"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from auth.users
where email in ('admin@dashteam.local', 'employee@dashteam.local');

-- The auth.users trigger created both profiles as employees; promote the admin.
update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111';
