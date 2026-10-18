alter table public.orders
  add column if not exists payment_method text not null default 'cod',
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists youpi_payment_id text,
  add column if not exists youpi_checkout_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_method_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (payment_method in ('cod', 'upi'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in ('not_required', 'pending', 'paid', 'failed', 'expired', 'cancelled'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_state_consistency_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_state_consistency_check
      check (
        (payment_method = 'cod' and payment_status = 'not_required')
        or (payment_method = 'upi' and payment_status in ('pending', 'paid', 'failed', 'expired', 'cancelled'))
      );
  end if;
end;
$$;

create unique index if not exists orders_youpi_payment_id_idx
  on public.orders (youpi_payment_id)
  where youpi_payment_id is not null;

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
  return v_order_id;
end;
$$;

revoke all on function public.place_marketplace_order_upi(jsonb, jsonb) from public, anon;
grant execute on function public.place_marketplace_order_upi(jsonb, jsonb) to authenticated;

create or replace function public.record_youpi_payment_session(
  p_order_id uuid,
  p_payment_id text,
  p_checkout_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_payment_id, '') = ''
    or coalesce(p_checkout_url, '') not like 'https://%' then
    raise exception 'The gateway payment session is invalid.';
  end if;

  update public.orders
    set youpi_payment_id = p_payment_id,
        youpi_checkout_url = p_checkout_url
    where id = p_order_id
      and payment_method = 'upi'
      and payment_status = 'pending'
      and (youpi_payment_id is null or youpi_payment_id = p_payment_id);
  if not found then raise exception 'The order is not waiting for this gateway payment session.'; end if;
end;
$$;

revoke all on function public.record_youpi_payment_session(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_youpi_payment_session(uuid, text, text) to service_role;

create or replace function public.apply_youpi_payment_webhook(
  p_event text,
  p_order_id uuid,
  p_payment_id text,
  p_amount_paise bigint,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_failure_status text;
begin
  if p_event is null or p_event not in ('SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED') then
    raise exception 'Unsupported payment event.';
  end if;

  select * into v_order
    from public.orders
    where id = p_order_id
    for update;
  if not found or v_order.payment_method <> 'upi' then
    raise exception 'The UPI order was not found.';
  end if;
  if v_order.youpi_payment_id is null or v_order.youpi_payment_id is distinct from p_payment_id then
    raise exception 'The gateway payment does not match the order.';
  end if;
  if p_event = 'SUCCESS'
    and (p_currency is distinct from 'INR' or p_amount_paise is distinct from v_order.total::bigint * 100) then
    raise exception 'The verified payment amount does not match the order.';
  end if;

  if v_order.payment_status = 'paid' and p_event = 'SUCCESS' then return; end if;
  if v_order.payment_status <> 'pending' then
    if (p_event = 'FAILED' and v_order.payment_status = 'failed')
      or (p_event = 'EXPIRED' and v_order.payment_status = 'expired')
      or (p_event = 'CANCELLED' and v_order.payment_status = 'cancelled') then
      return;
    end if;
    raise exception 'The order has already left the pending payment state.';
  end if;

  if p_event = 'SUCCESS' then
    update public.orders set payment_status = 'paid' where id = p_order_id;
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

  v_failure_status := case p_event
    when 'FAILED' then 'failed'
    when 'EXPIRED' then 'expired'
    else 'cancelled'
  end;
  update public.orders set payment_status = v_failure_status where id = p_order_id;
  update public.products product
    set stock = product.stock + reserved.quantity
    from (
      select item.product_id, sum(item.quantity)::integer as quantity
      from public.order_items item
      where item.order_id = p_order_id
      group by item.product_id
    ) reserved
    where product.id = reserved.product_id;
end;
$$;

revoke all on function public.apply_youpi_payment_webhook(text, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.apply_youpi_payment_webhook(text, uuid, text, bigint, text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
