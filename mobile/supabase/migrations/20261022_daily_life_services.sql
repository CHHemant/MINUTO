create type public.service_category as enum ('grooming', 'vehicle', 'home', 'errands');
create type public.service_booking_status as enum ('requested', 'confirmed', 'in_progress', 'completed', 'cancelled');

create table public.service_providers (
  id uuid primary key default gen_random_uuid(),
  category public.service_category not null,
  name text not null check (char_length(name) between 2 and 100),
  description text not null check (char_length(description) between 2 and 500),
  service_area text not null check (char_length(service_area) between 2 and 120),
  starting_price integer not null check (starting_price >= 0),
  rating numeric(2,1) not null default 5.0 check (rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  verified boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create index service_providers_category_idx on public.service_providers (category, active, verified);

create table public.service_bookings (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.service_providers(id),
  category public.service_category not null,
  requested_for timestamptz not null,
  address text not null check (char_length(address) between 5 and 180),
  notes text not null default '' check (char_length(notes) <= 500),
  status public.service_booking_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_bookings_buyer_created_idx on public.service_bookings (buyer_id, created_at desc);
create index service_bookings_provider_status_idx on public.service_bookings (provider_id, status);

create table public.saved_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(label) between 2 and 30),
  address text not null check (char_length(address) between 5 and 180),
  area text not null check (char_length(area) between 2 and 80),
  postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, label)
);

create table public.life_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  due_at timestamptz,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index life_reminders_user_due_idx on public.life_reminders (user_id, completed, due_at);

alter table public.service_providers enable row level security;
alter table public.service_bookings enable row level security;
alter table public.saved_addresses enable row level security;
alter table public.life_reminders enable row level security;

create policy "users read active service providers" on public.service_providers
  for select to authenticated using (active = true);
create policy "finance admins read all service providers" on public.service_providers
  for select to authenticated using (public.is_finance_admin());
create policy "buyers read own service bookings" on public.service_bookings
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy "finance admins read service bookings" on public.service_bookings
  for select to authenticated using (public.is_finance_admin());
create policy "buyers manage own saved addresses" on public.saved_addresses
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "users manage own reminders" on public.life_reminders
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.request_service_booking(
  p_provider_id uuid,
  p_requested_for timestamptz,
  p_address_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_provider public.service_providers%rowtype;
  v_address public.saved_addresses%rowtype;
  v_booking_id uuid;
  v_notes text := btrim(coalesce(p_notes, ''));
begin
  if v_buyer_id is null then raise exception 'Sign in to request a service.'; end if;
  if not exists (select 1 from public.profiles where id = v_buyer_id and role = 'buyer') then
    raise exception 'A buyer account is required.';
  end if;
  if p_requested_for < now() or p_requested_for > now() + interval '90 days' then
    raise exception 'Choose a time within the next 90 days.';
  end if;
  select * into v_provider from public.service_providers
    where id = p_provider_id and active = true for share;
  if not found then raise exception 'This provider is no longer available.'; end if;
  select * into v_address from public.saved_addresses
    where id = p_address_id and user_id = v_buyer_id;
  if not found then raise exception 'Choose one of your saved addresses.'; end if;
  if char_length(v_notes) > 500 then raise exception 'Notes must be 500 characters or fewer.'; end if;
  insert into public.service_bookings (
    buyer_id, provider_id, category, requested_for, address, notes
  ) values (
    v_buyer_id, v_provider.id, v_provider.category, p_requested_for,
    v_address.address || ', ' || v_address.area || ' ' || v_address.postal_code, v_notes
  ) returning id into v_booking_id;
  return v_booking_id;
end;
$$;

revoke all on function public.request_service_booking(uuid, timestamptz, uuid, text) from public, anon;
grant execute on function public.request_service_booking(uuid, timestamptz, uuid, text) to authenticated;

alter table public.finance_admin_audit_log
  drop constraint if exists finance_admin_audit_log_action_check;
alter table public.finance_admin_audit_log
  add constraint finance_admin_audit_log_action_check
  check (action in ('account_approved', 'account_rejected', 'seller_payout_paid', 'payment_case_refunded', 'service_provider_created'));

create or replace function public.create_service_provider(
  p_category public.service_category,
  p_name text,
  p_description text,
  p_service_area text,
  p_starting_price integer,
  p_verified boolean,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_area text := btrim(coalesce(p_service_area, ''));
begin
  if not public.is_finance_admin() then raise exception 'Finance administrator access is required.'; end if;
  if p_category is null then raise exception 'Choose a service category.'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'Provider name must be 2 to 100 characters.'; end if;
  if char_length(v_description) not between 2 and 500 then raise exception 'Description must be 2 to 500 characters.'; end if;
  if char_length(v_area) not between 2 and 120 then raise exception 'Service area must be 2 to 120 characters.'; end if;
  if p_starting_price is null or p_starting_price < 0 or p_starting_price > 100000 then raise exception 'Starting price must be between ₹0 and ₹1,00,000.'; end if;
  insert into public.service_providers (
    category, name, description, service_area, starting_price, verified, active
  ) values (
    p_category, v_name, v_description, v_area, p_starting_price, coalesce(p_verified, false), coalesce(p_active, false)
  ) returning id into v_provider_id;
  insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
  values ((select auth.uid()), 'service_provider_created', v_provider_id::text, jsonb_build_object('category', p_category, 'active', coalesce(p_active, false)));
  return v_provider_id;
end;
$$;

revoke all on function public.create_service_provider(public.service_category, text, text, text, integer, boolean, boolean) from public, anon;
grant execute on function public.create_service_provider(public.service_category, text, text, text, integer, boolean, boolean) to authenticated;

create or replace function public.update_service_booking_status(
  p_booking_id uuid,
  p_status public.service_booking_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_finance_admin() then raise exception 'Finance administrator access is required.'; end if;
  if p_status not in ('confirmed', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Invalid service booking status.';
  end if;
  update public.service_bookings
    set status = p_status, updated_at = now()
    where id = p_booking_id;
  if not found then raise exception 'Service booking was not found.'; end if;
end;
$$;

revoke all on function public.update_service_booking_status(uuid, public.service_booking_status) from public, anon;
grant execute on function public.update_service_booking_status(uuid, public.service_booking_status) to authenticated;
