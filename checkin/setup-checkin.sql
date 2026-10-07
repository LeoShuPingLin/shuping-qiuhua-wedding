-- 書平 & 秋華｜婚宴報到功能
-- 請在 Supabase > SQL Editor 執行一次。
-- 這份 SQL 不會修改 wedding_guests / wedding_tables 的資料內容。

create table if not exists public.wedding_checkins (
  event_id text not null,
  guest_id uuid not null references public.wedding_guests(id) on delete cascade,
  arrived_count integer not null default 0 check (arrived_count >= 0),
  reporter_name text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (event_id, guest_id)
);

create index if not exists wedding_checkins_event_idx
  on public.wedding_checkins(event_id);

alter table public.wedding_checkins enable row level security;

-- 每次回報時，確認 guest_id 屬於同一場婚禮，並限制已到人數不得超過原始 party_size。
create or replace function public.validate_wedding_checkin()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  expected_count integer;
begin
  select greatest(1, coalesce(g.party_size, 1))
    into expected_count
  from public.wedding_guests g
  where g.id = new.guest_id
    and g.event_id = new.event_id
    and g.attendance = 'dinner';

  if expected_count is null then
    raise exception 'Guest does not belong to this dinner event';
  end if;

  new.arrived_count := greatest(0, least(coalesce(new.arrived_count, 0), expected_count));
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists wedding_checkins_validate on public.wedding_checkins;
create trigger wedding_checkins_validate
before insert or update on public.wedding_checkins
for each row execute function public.validate_wedding_checkin();

-- 報到工作人員：event_members.role 可使用 checkin 或 usher；owner 也可使用。
-- 只額外開放「讀取原始桌次/名單」，不允許帶位頁修改 wedding_guests / wedding_tables。
drop policy if exists checkin_staff_read_guests on public.wedding_guests;
create policy checkin_staff_read_guests
on public.wedding_guests
for select
to authenticated
using (
  exists (
    select 1
    from public.event_members em
    where em.event_id = wedding_guests.event_id
      and em.user_id = auth.uid()
      and em.role in ('owner', 'checkin', 'usher')
  )
);

drop policy if exists checkin_staff_read_tables on public.wedding_tables;
create policy checkin_staff_read_tables
on public.wedding_tables
for select
to authenticated
using (
  exists (
    select 1
    from public.event_members em
    where em.event_id = wedding_tables.event_id
      and em.user_id = auth.uid()
      and em.role in ('owner', 'checkin', 'usher')
  )
);

drop policy if exists checkin_staff_select_checkins on public.wedding_checkins;
create policy checkin_staff_select_checkins
on public.wedding_checkins
for select
to authenticated
using (
  exists (
    select 1
    from public.event_members em
    where em.event_id = wedding_checkins.event_id
      and em.user_id = auth.uid()
      and em.role in ('owner', 'checkin', 'usher')
  )
);

drop policy if exists checkin_staff_insert_checkins on public.wedding_checkins;
create policy checkin_staff_insert_checkins
on public.wedding_checkins
for insert
to authenticated
with check (
  exists (
    select 1
    from public.event_members em
    where em.event_id = wedding_checkins.event_id
      and em.user_id = auth.uid()
      and em.role in ('owner', 'checkin', 'usher')
  )
);

drop policy if exists checkin_staff_update_checkins on public.wedding_checkins;
create policy checkin_staff_update_checkins
on public.wedding_checkins
for update
to authenticated
using (
  exists (
    select 1
    from public.event_members em
    where em.event_id = wedding_checkins.event_id
      and em.user_id = auth.uid()
      and em.role in ('owner', 'checkin', 'usher')
  )
)
with check (
  exists (
    select 1
    from public.event_members em
    where em.event_id = wedding_checkins.event_id
      and em.user_id = auth.uid()
      and em.role in ('owner', 'checkin', 'usher')
  )
);

grant select on public.wedding_guests to authenticated;
grant select on public.wedding_tables to authenticated;
grant select, insert, update on public.wedding_checkins to authenticated;

-- Realtime：多位帶位人員同時操作時立即同步。
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wedding_checkins'
  ) then
    alter publication supabase_realtime add table public.wedding_checkins;
  end if;
end $$;

-- 若要建立「帶位專用帳號」：
-- 1. 先到 Authentication > Users 建立一個 Email / Password 使用者。
-- 2. 再把該使用者加入 event_members，role 設為 checkin。
--    欄位格式可沿用你目前 event_members 建 owner 的方式。
