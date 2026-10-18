alter table public.orders
  add column if not exists youpi_order_id text,
  add column if not exists payment_utr text,
  add column if not exists payment_review_required boolean not null default false,
  add column if not exists youpi_attempt_number integer not null default 1
    check (youpi_attempt_number > 0);

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('not_required', 'pending', 'paid', 'failed', 'expired', 'cancelled', 'review', 'refunded'));
alter table public.orders drop constraint if exists orders_payment_state_consistency_check;
alter table public.orders add constraint orders_payment_state_consistency_check
  check (
    (payment_method = 'cod' and payment_status = 'not_required')
    or (payment_method = 'upi' and payment_status in ('pending', 'paid', 'failed', 'expired', 'cancelled', 'review', 'refunded'))
  );

create table if not exists public.youpi_payment_attempts (
  payment_id text primary key,
  order_id uuid not null references public.orders(id),
  gateway_order_id text not null unique,
  checkout_url text not null,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null check (status in ('pending', 'success', 'failed', 'expired', 'cancelled', 'duplicate_success')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.youpi_payment_attempts enable row level security;

create table if not exists public.order_seller_payment_snapshots (
  order_id uuid not null references public.orders(id),
  vendor_id uuid not null references public.profiles(id),
  seller_upi_id text not null,
  seller_phone text not null,
  created_at timestamptz not null default now(),
  primary key (order_id, vendor_id)
);
alter table public.order_seller_payment_snapshots enable row level security;

create table if not exists public.seller_payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  vendor_id uuid not null references public.profiles(id),
  gross_amount integer not null check (gross_amount > 0),
  delivery_contribution integer not null default 6 check (delivery_contribution = 6),
  amount integer not null check (amount >= 0),
  seller_upi_id text not null,
  seller_phone text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'not_due')),
  transfer_reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (order_id, vendor_id),
  check (
    (status in ('pending', 'not_due') and paid_at is null)
    or (status = 'paid' and paid_at is not null)
  )
);
alter table public.seller_payouts enable row level security;

create table if not exists public.payment_reconciliation_cases (
  payment_id text primary key,
  order_id uuid not null references public.orders(id),
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.payment_reconciliation_cases enable row level security;

create policy "buyers read own payment reconciliation cases" on public.payment_reconciliation_cases
  for select to authenticated using (
    exists (
      select 1 from public.orders
      where orders.id = payment_reconciliation_cases.order_id
        and orders.buyer_id = (select auth.uid())
    )
  );

alter table public.payment_reconciliation_cases
  add column if not exists resolution_note text;

create policy "vendors read own payout records" on public.seller_payouts
  for select to authenticated using (vendor_id = (select auth.uid()));

revoke all on public.youpi_payment_attempts from public, anon, authenticated;
revoke all on public.order_seller_payment_snapshots from public, anon, authenticated;
revoke all on public.payment_reconciliation_cases from public, anon, authenticated;
grant select on public.payment_reconciliation_cases to authenticated;
revoke insert, update, delete on public.seller_payouts from public, anon, authenticated;
grant select on public.seller_payouts to authenticated;

drop function if exists public.apply_youpi_payment_webhook(text, uuid, text, bigint, text);
drop function if exists public.record_youpi_payment_session(uuid, text, text);

create or replace function public.place_marketplace_order_upi(p_items jsonb, p_delivery jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  v_order_id := public.place_marketplace_order(p_items, p_delivery);
  update public.orders
    set payment_method = 'upi', payment_status = 'pending'
    where id = v_order_id and buyer_id = auth.uid();
  if not found then raise exception 'Could not prepare the UPI order.'; end if;
  delete from public.delivery_jobs where order_id = v_order_id;

  insert into public.order_seller_payment_snapshots (order_id, vendor_id, seller_upi_id, seller_phone)
  select v_order_id, item.vendor_id, profile.seller_upi_id, profile.seller_phone
  from public.order_items item
  join public.profiles profile on profile.id = item.vendor_id
  where item.order_id = v_order_id
  group by item.vendor_id, profile.seller_upi_id, profile.seller_phone;
  return v_order_id;
end;
$$;

revoke all on function public.place_marketplace_order_upi(jsonb, jsonb) from public, anon;
grant execute on function public.place_marketplace_order_upi(jsonb, jsonb) to authenticated;

create or replace function public.record_youpi_payment_session(
  p_order_id uuid,
  p_payment_id text,
  p_gateway_order_id text,
  p_checkout_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if coalesce(p_payment_id, '') = ''
    or coalesce(p_gateway_order_id, '') = ''
    or coalesce(p_checkout_url, '') not like 'https://%'
    or p_gateway_order_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(-R[0-9]{1,10})?$' then
    raise exception 'The gateway payment session is invalid.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.payment_method <> 'upi' or v_order.payment_status <> 'pending' then
    raise exception 'The order is not waiting for a gateway payment session.';
  end if;

  insert into public.youpi_payment_attempts (
    payment_id, order_id, gateway_order_id, checkout_url, amount_paise, status
  ) values (
    p_payment_id, p_order_id, p_gateway_order_id, p_checkout_url, v_order.total::bigint * 100, 'pending'
  )
  on conflict (payment_id) do update
    set checkout_url = excluded.checkout_url
    where youpi_payment_attempts.order_id = excluded.order_id
      and youpi_payment_attempts.gateway_order_id = excluded.gateway_order_id
      and youpi_payment_attempts.amount_paise = excluded.amount_paise
      and youpi_payment_attempts.status = 'pending';
  if not exists (
    select 1 from public.youpi_payment_attempts
    where payment_id = p_payment_id
      and order_id = p_order_id
      and gateway_order_id = p_gateway_order_id
      and amount_paise = v_order.total::bigint * 100
      and status = 'pending'
  ) then
    raise exception 'The gateway payment attempt conflicts with an existing attempt.';
  end if;

  update public.orders
    set youpi_payment_id = p_payment_id,
        youpi_order_id = p_gateway_order_id,
        youpi_checkout_url = p_checkout_url
    where id = p_order_id
        and (youpi_payment_id is null or youpi_payment_id = p_payment_id);
  if not found then raise exception 'A different payment attempt is already active for this order.'; end if;
end;
$$;

revoke all on function public.record_youpi_payment_session(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_youpi_payment_session(uuid, text, text, text) to service_role;

create or replace function public.prepare_youpi_payment_retry(p_order_id uuid, p_buyer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  if exists (
    select 1 from public.orders
    where id = p_order_id
      and buyer_id = p_buyer_id
      and payment_method = 'upi'
      and payment_status = 'pending'
      and youpi_payment_id is null
  ) then return; end if;

  select * into v_order
    from public.orders
    where id = p_order_id and buyer_id = p_buyer_id
    for update;
  if not found or v_order.payment_method <> 'upi' then
    raise exception 'The UPI order was not found.';
  end if;
  if v_order.payment_status not in ('failed', 'expired', 'cancelled') then
    raise exception 'This order is not eligible for a payment retry.';
  end if;

  for v_item in
    select item.product_id, sum(item.quantity)::integer as quantity
    from public.order_items item
    where item.order_id = p_order_id
    group by item.product_id
  loop
    update public.products
      set stock = stock - v_item.quantity
      where id = v_item.product_id and active and stock >= v_item.quantity;
    if not found then
      raise exception 'A product is no longer available in the quantity required for this order.';
    end if;
  end loop;

  update public.orders
    set payment_status = 'pending',
        youpi_attempt_number = youpi_attempt_number + 1,
        youpi_payment_id = null,
        youpi_order_id = null,
        youpi_checkout_url = null,
        payment_utr = null
    where id = p_order_id;
end;
$$;

revoke all on function public.prepare_youpi_payment_retry(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_youpi_payment_retry(uuid, uuid) to service_role;

create or replace function public.apply_youpi_payment_webhook(
  p_event text,
  p_gateway_order_id text,
  p_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_utr text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.youpi_payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_attempt_status text;
begin
  if p_event is null or p_event not in ('SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED') then
    raise exception 'Unsupported payment event.';
  end if;

  select * into v_attempt
    from public.youpi_payment_attempts
    where payment_id = p_payment_id and gateway_order_id = p_gateway_order_id
    for update;
  if not found then raise exception 'The gateway payment attempt was not found.'; end if;
  if v_attempt.amount_paise <> p_amount_paise then
    raise exception 'The verified payment amount does not match the gateway attempt.';
  end if;

  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if not found or v_order.payment_method <> 'upi' then
    raise exception 'The UPI order was not found.';
  end if;
  if p_event = 'SUCCESS' and p_currency is distinct from 'INR' then
    raise exception 'The verified payment currency is not INR.';
  end if;

  v_attempt_status := case p_event
    when 'SUCCESS' then 'success'
    when 'FAILED' then 'failed'
    when 'EXPIRED' then 'expired'
    else 'cancelled'
  end;

  if v_attempt.status = v_attempt_status then return; end if;
  if p_event = 'SUCCESS' and v_attempt.status <> 'pending' then
    update public.youpi_payment_attempts
      set status = 'duplicate_success', completed_at = now()
      where payment_id = p_payment_id;
    update public.orders
      set payment_status = case when payment_status = 'paid' then 'paid' else 'review' end,
          payment_review_required = true
      where id = v_order.id;
    insert into public.payment_reconciliation_cases (payment_id, order_id, amount_paise, reason)
    values (p_payment_id, v_order.id, p_amount_paise, 'Payment succeeded after its attempt had already ended.')
    on conflict (payment_id) do nothing;
    return;
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'The gateway attempt has already reached a different final status.';
  end if;

  update public.youpi_payment_attempts
    set status = v_attempt_status,
        completed_at = now()
    where payment_id = p_payment_id;

  if p_event = 'SUCCESS' then
    if v_order.payment_status <> 'pending' or v_order.youpi_payment_id is distinct from p_payment_id then
      update public.youpi_payment_attempts
        set status = 'duplicate_success', completed_at = now()
        where payment_id = p_payment_id;
      update public.orders
        set payment_status = case when payment_status = 'paid' then 'paid' else 'review' end,
            payment_review_required = true
        where id = v_order.id;
      insert into public.payment_reconciliation_cases (payment_id, order_id, amount_paise, reason)
      values (p_payment_id, v_order.id, p_amount_paise, 'Payment succeeded outside the active payment attempt.')
      on conflict (payment_id) do nothing;
      return;
    end if;
    update public.orders
      set payment_status = 'paid', payment_utr = nullif(btrim(p_utr), '')
      where id = v_order.id;

    insert into public.seller_payouts (
      order_id, vendor_id, gross_amount, delivery_contribution, amount,
      seller_upi_id, seller_phone, status
    )
    select
      v_order.id,
      item.vendor_id,
      sum(item.seller_price * item.quantity)::integer,
      6,
      greatest(sum(item.seller_price * item.quantity)::integer - 6, 0),
      snapshot.seller_upi_id,
      snapshot.seller_phone,
      case when sum(item.seller_price * item.quantity) <= 6 then 'not_due' else 'pending' end
    from public.order_items item
    join public.order_seller_payment_snapshots snapshot
      on snapshot.order_id = v_order.id and snapshot.vendor_id = item.vendor_id
    where item.order_id = v_order.id
    group by item.vendor_id, snapshot.seller_upi_id, snapshot.seller_phone
    on conflict (order_id, vendor_id) do nothing;

    insert into public.delivery_jobs (
      order_id, buyer_id, vendor_id, vendor_name, vendor_address,
      buyer_name, buyer_phone, buyer_address, buyer_area, buyer_postal_code,
      vendor_contribution, status
    )
    select
      v_order.id, v_order.buyer_id, vendor.id, vendor.display_name, coalesce(vendor.pickup_address, ''),
      v_order.buyer_name, v_order.phone, v_order.address, v_order.area, v_order.postal_code,
      6, 'new'
    from public.profiles vendor
    where vendor.id in (
      select distinct item.vendor_id
      from public.order_items item
      where item.order_id = v_order.id
    );
    return;
  end if;

  update public.orders
    set payment_status = v_attempt_status
    where id = v_order.id
      and payment_status = 'pending'
      and youpi_payment_id = p_payment_id;
  if not found then return; end if;

  update public.products product
    set stock = product.stock + reserved.quantity
    from (
      select item.product_id, sum(item.quantity)::integer as quantity
      from public.order_items item
      where item.order_id = v_order.id
      group by item.product_id
    ) reserved
    where product.id = reserved.product_id;
end;
$$;

revoke all on function public.apply_youpi_payment_webhook(text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.apply_youpi_payment_webhook(text, text, text, bigint, text, text) to service_role;

create or replace function public.record_seller_payout(p_payout_id uuid, p_transfer_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text := btrim(coalesce(p_transfer_reference, ''));
begin
  if char_length(v_reference) not between 4 and 120 then
    raise exception 'Enter a valid bank transfer reference.';
  end if;
  update public.seller_payouts
    set status = 'paid', transfer_reference = v_reference, paid_at = now()
    where id = p_payout_id and status = 'pending' and amount > 0;
  if not found then raise exception 'The seller payout is not pending or has no amount due.'; end if;
end;
$$;

revoke all on function public.record_seller_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.record_seller_payout(uuid, text) to service_role;

create or replace function public.resolve_payment_reconciliation(
  p_payment_id text,
  p_resolution_status text,
  p_resolution_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_resolution_note, ''));
begin
  if p_resolution_status is null
    or p_resolution_status not in ('failed', 'cancelled', 'refunded') then
    raise exception 'Choose a valid reconciliation outcome.';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'Enter a resolution note between 10 and 500 characters.';
  end if;
  update public.payment_reconciliation_cases
    set status = 'resolved', resolution_note = v_note, resolved_at = now()
    where payment_id = p_payment_id and status = 'open';
  if not found then raise exception 'The payment reconciliation case is not open.'; end if;
  update public.orders
    set payment_review_required = exists (
      select 1 from public.payment_reconciliation_cases
      where order_id = orders.id and status = 'open'
    ),
    payment_status = case
      when payment_status = 'review' and not exists (
        select 1 from public.payment_reconciliation_cases
        where order_id = orders.id and status = 'open'
      ) then p_resolution_status
      else payment_status
    end
    where id = (
      select order_id from public.payment_reconciliation_cases where payment_id = p_payment_id
    );
end;
$$;

revoke all on function public.resolve_payment_reconciliation(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_payment_reconciliation(text, text, text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seller_payouts'
    ) then
    alter publication supabase_realtime add table public.seller_payouts;
  end if;
end;
$$;
