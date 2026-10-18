create extension if not exists pgcrypto with schema extensions;

create type public.market_role as enum ('buyer', 'vendor', 'agent');
create type public.delivery_job_status as enum ('new', 'offered', 'accepted', 'picked_up', 'delivered', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role public.market_role,
  pickup_address text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.profiles(id),
  vendor_name text not null,
  name text not null check (char_length(name) between 2 and 70),
  details text not null check (char_length(details) between 2 and 300),
  category text not null check (category in ('fresh', 'pantry', 'tech', 'style')),
  seller_price integer not null check (seller_price between 1 and 100000),
  stock integer not null check (stock between 0 and 10000),
  image_path text not null,
  image_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_vendor_created_idx on public.products (vendor_id, created_at desc);
create index products_active_created_idx on public.products (active, created_at desc);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  buyer_name text not null,
  phone text not null,
  address text not null,
  area text not null,
  city text not null default 'Nagpur, Maharashtra',
  postal_code text not null,
  subtotal integer not null check (subtotal >= 0),
  item_markup integer not null check (item_markup >= 0),
  buyer_delivery_contribution integer not null default 6 check (buyer_delivery_contribution = 6),
  total integer not null check (total >= 0),
  created_at timestamptz not null default now()
);
create index orders_buyer_created_idx on public.orders (buyer_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id),
  product_id uuid not null references public.products(id),
  vendor_id uuid not null references public.profiles(id),
  product_name text not null,
  seller_price integer not null check (seller_price > 0),
  quantity integer not null check (quantity between 1 and 99),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_vendor_idx on public.order_items (vendor_id, created_at desc);

create table public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id),
  vendor_id uuid not null references public.profiles(id),
  vendor_name text not null,
  vendor_address text not null default '',
  buyer_name text not null,
  buyer_phone text not null,
  buyer_address text not null,
  buyer_area text not null,
  buyer_postal_code text not null,
  vendor_contribution integer not null default 6 check (vendor_contribution = 6),
  status public.delivery_job_status not null default 'new',
  agent_id uuid references public.profiles(id),
  payout_rate_per_km integer not null default 0 check (payout_rate_per_km >= 0),
  distance_km numeric(7,2) check (distance_km is null or distance_km >= 0),
  agent_payout integer check (agent_payout is null or agent_payout >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index delivery_jobs_vendor_created_idx on public.delivery_jobs (vendor_id, created_at desc);
create index delivery_jobs_buyer_created_idx on public.delivery_jobs (buyer_id, created_at desc);
create index delivery_jobs_offers_created_idx on public.delivery_jobs (status, created_at desc);
create index delivery_jobs_agent_created_idx on public.delivery_jobs (agent_id, created_at desc);

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.place_marketplace_order(p_items jsonb, p_delivery jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_buyer public.profiles%rowtype;
  v_order_id uuid;
  v_subtotal integer := 0;
  v_markup integer := 0;
  v_product public.products%rowtype;
  v_item record;
  v_vendor record;
  v_quantity integer;
  v_phone text;
  v_address text;
  v_area text;
  v_postal text;
begin
  if v_buyer_id is null then
    raise exception 'Sign in to place an order.';
  end if;
  select * into v_buyer from public.profiles where id = v_buyer_id for share;
  if not found or v_buyer.role <> 'buyer' then
    raise exception 'A buyer account is required to place an order.';
  end if;
  if coalesce(jsonb_typeof(p_items) <> 'array', true)
    or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) not between 1 and 50 then
    raise exception 'The bag must contain 1 to 50 products.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item ->> 'product_id', '') = ''
      or coalesce(item ->> 'quantity', '') !~ '^[0-9]+$'
  ) then
    raise exception 'Each product requires a valid product ID and whole-number quantity.';
  end if;
  v_phone := regexp_replace(coalesce(p_delivery ->> 'phone', ''), '\D', '', 'g');
  v_address := btrim(coalesce(p_delivery ->> 'address', ''));
  v_area := btrim(coalesce(p_delivery ->> 'area', ''));
  v_postal := btrim(coalesce(p_delivery ->> 'postal_code', ''));
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit Indian mobile number.'; end if;
  if char_length(v_address) not between 5 and 120 or char_length(v_area) not between 2 and 80 then
    raise exception 'Enter a valid street address and area.';
  end if;
  if v_postal !~ '^[0-9]{6}$' then raise exception 'Enter a valid six-digit PIN code.'; end if;

  for v_item in
    select (item ->> 'product_id')::uuid as product_id,
      sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'product_id')::uuid
  loop
    if v_item.quantity not between 1 and 99 then raise exception 'A product quantity must be between 1 and 99.'; end if;
    select * into v_product from public.products
      where id = v_item.product_id and active = true for update;
    if not found or v_product.stock < v_item.quantity then
      raise exception 'A product is no longer available in the requested quantity.';
    end if;
    v_subtotal := v_subtotal + v_product.seller_price * v_item.quantity;
    v_markup := v_markup + 5 * v_item.quantity;
  end loop;

  insert into public.orders (
    buyer_id, buyer_name, phone, address, area, city, postal_code,
    subtotal, item_markup, buyer_delivery_contribution, total
  ) values (
    v_buyer_id, v_buyer.display_name, v_phone, v_address, v_area, 'Nagpur, Maharashtra', v_postal,
    v_subtotal, v_markup, 6, v_subtotal + v_markup + 6
  ) returning id into v_order_id;

  for v_item in
    select (item ->> 'product_id')::uuid as product_id,
      sum((item ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) item
    group by (item ->> 'product_id')::uuid
  loop
    select * into v_product from public.products where id = v_item.product_id for update;
    insert into public.order_items (order_id, buyer_id, product_id, vendor_id, product_name, seller_price, quantity)
    values (v_order_id, v_buyer_id, v_product.id, v_product.vendor_id, v_product.name, v_product.seller_price, v_item.quantity);
    update public.products set stock = stock - v_item.quantity where id = v_product.id;
  end loop;

  for v_vendor in
    select p.id, p.display_name, p.pickup_address
    from public.profiles p
    where p.id in (
      select distinct pr.vendor_id
      from public.products pr
      join jsonb_array_elements(p_items) item on pr.id = (item ->> 'product_id')::uuid
    )
  loop
    insert into public.delivery_jobs (
      order_id, buyer_id, vendor_id, vendor_name, vendor_address,
      buyer_name, buyer_phone, buyer_address, buyer_area, buyer_postal_code,
      vendor_contribution, status
    ) values (
      v_order_id, v_buyer_id, v_vendor.id, v_vendor.display_name, coalesce(v_vendor.pickup_address, ''),
      v_buyer.display_name, v_phone, v_address, v_area, v_postal, 6, 'new'
    );
  end loop;
  return v_order_id;
end;
$$;

create or replace function public.accept_delivery_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid := auth.uid();
  v_accepted uuid;
begin
  if v_agent_id is null or not exists (
    select 1 from public.profiles where id = v_agent_id and role = 'agent'
  ) then
    raise exception 'A delivery-agent account is required.';
  end if;
  update public.delivery_jobs
    set agent_id = v_agent_id, status = 'accepted', updated_at = now()
    where id = p_job_id and status = 'offered'
    returning id into v_accepted;
  return v_accepted is not null;
end;
$$;

create or replace function public.choose_market_role(p_role public.market_role, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_user_id is null then raise exception 'Sign in to finish account setup.'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'Enter a name between 2 and 60 characters.'; end if;
  update public.profiles
    set role = p_role, display_name = v_name
    where id = v_user_id and role is null;
  if not found then raise exception 'The account role was already set.'; end if;
end;
$$;

create or replace function public.prepare_delivery_job(p_job_id uuid, p_pickup_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor_id uuid := auth.uid();
  v_pickup text := btrim(coalesce(p_pickup_address, ''));
begin
  if v_vendor_id is null or not exists (
    select 1 from public.profiles where id = v_vendor_id and role = 'vendor'
  ) then raise exception 'A vendor account is required.'; end if;
  if char_length(v_pickup) not between 5 and 180 then raise exception 'Enter a valid vendor pickup address.'; end if;
  update public.profiles set pickup_address = v_pickup where id = v_vendor_id;
  update public.delivery_jobs
    set vendor_address = v_pickup, status = 'offered', updated_at = now()
    where id = p_job_id and vendor_id = v_vendor_id and status = 'new';
  if not found then raise exception 'This delivery is no longer waiting for vendor preparation.'; end if;
end;
$$;

create or replace function public.advance_delivery_job(p_job_id uuid, p_status public.delivery_job_status)
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
  ) then raise exception 'A delivery-agent account is required.'; end if;
  if p_status not in ('picked_up', 'delivered') then raise exception 'Invalid delivery status.'; end if;
  update public.delivery_jobs
    set status = p_status, updated_at = now()
    where id = p_job_id
      and agent_id = v_agent_id
      and ((status = 'accepted' and p_status = 'picked_up') or (status = 'picked_up' and p_status = 'delivered'));
  if not found then raise exception 'This delivery cannot move to that status.'; end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.delivery_jobs enable row level security;
alter table public.favorites enable row level security;

create policy "users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (display_name, pickup_address) on public.profiles to authenticated;

create policy "active listings visible to signed-in users" on public.products
  for select to authenticated using (active or vendor_id = (select auth.uid()));
create policy "vendors create own listings" on public.products
  for insert to authenticated with check (
    vendor_id = (select auth.uid()) and exists (
      select 1 from public.profiles where id = (select auth.uid()) and role = 'vendor'
    )
  );
create policy "vendors update own listings" on public.products
  for update to authenticated using (vendor_id = (select auth.uid()))
  with check (vendor_id = (select auth.uid()));

create policy "buyers read own orders" on public.orders
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy "buyers read own order items" on public.order_items
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy "vendors read own order items" on public.order_items
  for select to authenticated using (vendor_id = (select auth.uid()));

create policy "participants read delivery jobs" on public.delivery_jobs
  for select to authenticated using (
    buyer_id = (select auth.uid())
    or vendor_id = (select auth.uid())
    or agent_id = (select auth.uid())
    or (
      status = 'offered'
      and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'agent')
    )
  );
create policy "vendors ready jobs" on public.delivery_jobs
  for update to authenticated using (vendor_id = (select auth.uid()) and status = 'new')
  with check (vendor_id = (select auth.uid()) and status = 'offered');
create policy "users manage own favorites" on public.favorites
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant execute on function public.place_marketplace_order(jsonb, jsonb) to authenticated;
grant execute on function public.accept_delivery_job(uuid) to authenticated;
grant execute on function public.choose_market_role(public.market_role, text) to authenticated;
grant execute on function public.prepare_delivery_job(uuid, text) to authenticated;
grant execute on function public.advance_delivery_job(uuid, public.delivery_job_status) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
    ) then
      alter publication supabase_realtime add table public.products;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_jobs'
    ) then
      alter publication supabase_realtime add table public.delivery_jobs;
    end if;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "signed-in users read product photos" on storage.objects
  for select to authenticated using (bucket_id = 'product-images');
create policy "vendors upload own product photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'vendor')
  );
create policy "vendors delete own product photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
