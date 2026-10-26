-- Optional route coordinates and latest delivery-agent location.
-- Addresses remain the source of truth; coordinates can be added incrementally
-- by the server or an approved geocoding workflow.

alter table public.delivery_jobs
  add column if not exists vendor_latitude double precision,
  add column if not exists vendor_longitude double precision,
  add column if not exists buyer_latitude double precision,
  add column if not exists buyer_longitude double precision;

create table if not exists public.delivery_agent_locations (
  agent_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  heading_degrees double precision check (heading_degrees is null or heading_degrees between 0 and 360),
  updated_at timestamptz not null default now()
);

alter table public.delivery_agent_locations enable row level security;

drop policy if exists "agents manage own location" on public.delivery_agent_locations;
create policy "agents manage own location" on public.delivery_agent_locations
  for all to authenticated
  using (
    agent_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'agent'
    )
  )
  with check (
    agent_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'agent'
    )
  );

drop policy if exists "delivery participants read agent location" on public.delivery_agent_locations;
create policy "delivery participants read agent location" on public.delivery_agent_locations
  for select to authenticated
  using (
    agent_id = (select auth.uid())
    or exists (
      select 1
      from public.delivery_jobs
      where delivery_jobs.agent_id = delivery_agent_locations.agent_id
        and (
          delivery_jobs.buyer_id = (select auth.uid())
          or delivery_jobs.vendor_id = (select auth.uid())
        )
        and delivery_jobs.status in ('accepted', 'picked_up')
    )
  );

create or replace function public.update_delivery_agent_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_heading_degrees double precision default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid := auth.uid();
begin
  if v_agent_id is null or not exists (
    select 1 from public.profiles where id = v_agent_id and role = 'agent'
  ) then
    raise exception 'An approved delivery-agent account is required.';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'The location coordinates are invalid.';
  end if;
  if p_accuracy_meters is not null and p_accuracy_meters < 0 then
    raise exception 'The location accuracy is invalid.';
  end if;
  if p_heading_degrees is not null and p_heading_degrees not between 0 and 360 then
    raise exception 'The location heading is invalid.';
  end if;

  insert into public.delivery_agent_locations (
    agent_id, latitude, longitude, accuracy_meters, heading_degrees, updated_at
  ) values (
    v_agent_id, p_latitude, p_longitude, p_accuracy_meters, p_heading_degrees, now()
  )
  on conflict (agent_id) do update set
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_meters = excluded.accuracy_meters,
    heading_degrees = excluded.heading_degrees,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.update_delivery_agent_location(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.update_delivery_agent_location(double precision, double precision, double precision, double precision) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'delivery_agent_locations'
    ) then
      alter publication supabase_realtime add table public.delivery_agent_locations;
    end if;
  end if;
end;
$$;
