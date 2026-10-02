-- Seat map migration for 書平 & 秋華 wedding seating planner
-- Run once in Supabase > SQL Editor.

alter table public.wedding_tables
  add column if not exists map_x numeric,
  add column if not exists map_y numeric;

create or replace function public.restore_wedding_snapshot(target_event_id text, payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  st jsonb;
begin
  if not (select public.is_event_owner(target_event_id)) then
    raise exception 'Only an event owner can restore a snapshot';
  end if;
  if payload is null or coalesce(payload->>'eventId','') <> target_event_id then
    raise exception 'Snapshot event ID mismatch';
  end if;

  delete from public.wedding_guests where event_id = target_event_id;
  delete from public.wedding_tables where event_id = target_event_id;

  for item in select value from jsonb_array_elements(coalesce(payload->'tables','[]'::jsonb))
  loop
    insert into public.wedding_tables(id,event_id,name,capacity,is_locked,sort_order,map_x,map_y)
    values (
      (item->>'id')::uuid,
      target_event_id,
      coalesce(item->>'name','未命名桌'),
      greatest(1,least(99,coalesce((item->>'capacity')::integer,10))),
      coalesce((item->>'is_locked')::boolean,false),
      coalesce((item->>'sort_order')::integer,0),
      nullif(item->>'map_x','')::numeric,
      nullif(item->>'map_y','')::numeric
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'guests','[]'::jsonb))
  loop
    insert into public.wedding_guests(
      id,event_id,name,party_size,side,attendance,child_seats,companions,notes,
      table_id,sort_order,source,source_key
    ) values (
      (item->>'id')::uuid,
      target_event_id,
      coalesce(item->>'name','未命名'),
      greatest(1,least(99,coalesce((item->>'party_size')::integer,1))),
      coalesce(item->>'side','其他'),
      coalesce(item->>'attendance','dinner'),
      greatest(0,least(20,coalesce((item->>'child_seats')::integer,0))),
      coalesce(item->>'companions',''),
      coalesce(item->>'notes',''),
      nullif(item->>'table_id','')::uuid,
      coalesce((item->>'sort_order')::integer,0),
      coalesce(item->>'source','restore'),
      nullif(item->>'source_key','')
    );
  end loop;

  st := coalesce(payload->'settings','{}'::jsonb);
  update public.wedding_settings
  set default_capacity = greatest(1,least(99,coalesce((st->>'default_capacity')::integer,10))),
      table_prefix = coalesce(nullif(st->>'table_prefix',''),'第'),
      next_table_no = greatest(1,coalesce((st->>'next_table_no')::integer,13))
  where event_id = target_event_id;
end;
$$;

revoke all on function public.restore_wedding_snapshot(text,jsonb) from public;
grant execute on function public.restore_wedding_snapshot(text,jsonb) to authenticated;
