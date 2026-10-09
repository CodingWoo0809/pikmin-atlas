-- =====================================================================
-- 주인 계정 지정 (001_init.sql 실행 후, 주인 계정을 만든 뒤 1번만 실행)
--   아래 이메일을 GitHub 변수 VITE_OWNER_EMAIL 값과 똑같이 바꾼 뒤 Run.
--   결과에 1행이 보이면 성공. 0행이면 이메일이 다르거나 계정이 아직 없는 것.
-- =====================================================================
insert into private.app_owner (user_id)
select id from auth.users where email = lower('owner@nomad-atlas.invalid')
on conflict (user_id) do nothing;

select u.email, o.user_id
  from private.app_owner o join auth.users u on u.id = o.user_id;
