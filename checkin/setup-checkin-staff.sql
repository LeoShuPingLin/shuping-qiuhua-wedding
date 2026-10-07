-- 書平 & 秋華｜帶位專用帳號授權
-- 執行前：請先到 Supabase > Authentication > Users 建立使用者
-- Email 固定：checkin@shuping-qiuhua.com
-- Password：請自行設定婚禮當天要給工作人員使用的密碼
-- 建議建立時將 Email 視為已確認 / Auto Confirm。

create table if not exists public.wedding_checkin_staff (
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '帶位人員',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.wedding_checkin_staff enable row level security;

drop policy if exists checkin_staff_self_read on public.wedding_checkin_staff;
create policy checkin_staff_self_read
on public.wedding_checkin_staff
for select
to authenticated
using (user_id = auth.uid());

grant select on public.wedding_checkin_staff to authenticated;

-- 專用帶位帳號只擁有「讀桌次 / 讀名單 / 讀寫報到」權限。
-- 不加入 event_members，因此不能修改原本桌次系統。
drop policy if exists dedicated_checkin_read_guests on public.wedding_guests;
create policy dedicated_checkin_read_guests
on public.wedding_guests
for select
to authenticated
using (
  exists (
    select 1 from public.wedding_checkin_staff s
    where s.event_id = wedding_guests.event_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists dedicated_checkin_read_tables on public.wedding_tables;
create policy dedicated_checkin_read_tables
on public.wedding_tables
for select
to authenticated
using (
  exists (
    select 1 from public.wedding_checkin_staff s
    where s.event_id = wedding_tables.event_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists dedicated_checkin_read_checkins on public.wedding_checkins;
create policy dedicated_checkin_read_checkins
on public.wedding_checkins
for select
to authenticated
using (
  exists (
    select 1 from public.wedding_checkin_staff s
    where s.event_id = wedding_checkins.event_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists dedicated_checkin_insert_checkins on public.wedding_checkins;
create policy dedicated_checkin_insert_checkins
on public.wedding_checkins
for insert
to authenticated
with check (
  exists (
    select 1 from public.wedding_checkin_staff s
    where s.event_id = wedding_checkins.event_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists dedicated_checkin_update_checkins on public.wedding_checkins;
create policy dedicated_checkin_update_checkins
on public.wedding_checkins
for update
to authenticated
using (
  exists (
    select 1 from public.wedding_checkin_staff s
    where s.event_id = wedding_checkins.event_id
      and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.wedding_checkin_staff s
    where s.event_id = wedding_checkins.event_id
      and s.user_id = auth.uid()
  )
);

-- 將固定的帶位登入帳號綁定到這場婚禮。
do $$
declare
  checkin_user_id uuid;
begin
  select id into checkin_user_id
  from auth.users
  where lower(email) = lower('checkin@shuping-qiuhua.com')
  limit 1;

  if checkin_user_id is null then
    raise exception '找不到 checkin@shuping-qiuhua.com。請先到 Authentication > Users 建立此使用者，再重新執行本 SQL。';
  end if;

  insert into public.wedding_checkin_staff(event_id, user_id, display_name)
  values ('shu-qiu-2026', checkin_user_id, '帶位人員')
  on conflict (event_id, user_id)
  do update set display_name = excluded.display_name;
end $$;
