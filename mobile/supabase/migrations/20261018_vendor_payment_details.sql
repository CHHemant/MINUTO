alter table public.profiles
  add column if not exists seller_upi_id text,
  add column if not exists seller_phone text;

create or replace function public.save_vendor_payment_details(p_upi_id text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_upi_id text := btrim(coalesce(p_upi_id, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if v_user_id is null then raise exception 'Sign in to save seller payment details.'; end if;
  if v_upi_id !~* '^[a-z0-9][a-z0-9._+-]{1,63}@[a-z0-9][a-z0-9.-]{1,63}$' then
    raise exception 'Enter a valid UPI ID, such as name@bank.';
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit Indian mobile number.';
  end if;

  update public.profiles
    set seller_upi_id = v_upi_id, seller_phone = v_phone
    where id = v_user_id and role = 'vendor';
  if not found then raise exception 'A vendor account is required to save seller payment details.'; end if;
end;
$$;

revoke all on function public.save_vendor_payment_details(text, text) from public, anon;
grant execute on function public.save_vendor_payment_details(text, text) to authenticated;

create or replace function public.seller_payment_details_are_set(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_vendor_id
      and role = 'vendor'
      and seller_upi_id is not null
      and seller_phone is not null
  );
$$;

revoke all on function public.seller_payment_details_are_set(uuid) from public, anon;
grant execute on function public.seller_payment_details_are_set(uuid) to authenticated;

drop policy if exists "active listings visible to signed-in users" on public.products;
create policy "active listings visible to signed-in users" on public.products
  for select to authenticated using (
    vendor_id = (select auth.uid())
    or (active and public.seller_payment_details_are_set(vendor_id))
  );

drop policy if exists "vendors create own listings" on public.products;
create policy "vendors create own listings" on public.products
  for insert to authenticated with check (
    vendor_id = (select auth.uid())
    and public.seller_payment_details_are_set((select auth.uid()))
  );

drop policy if exists "vendors update own listings" on public.products;
create policy "vendors update own listings" on public.products
  for update to authenticated using (vendor_id = (select auth.uid()))
  with check (
    vendor_id = (select auth.uid())
    and public.seller_payment_details_are_set((select auth.uid()))
  );

create or replace function public.require_vendor_payment_details_for_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.vendor_id
      and role = 'vendor'
      and seller_upi_id is not null
      and seller_phone is not null
  ) then
    raise exception 'The seller must set up UPI and phone details before accepting orders.';
  end if;
  return new;
end;
$$;

drop trigger if exists require_vendor_payment_details_for_order_item on public.order_items;
create trigger require_vendor_payment_details_for_order_item
  before insert on public.order_items
  for each row execute function public.require_vendor_payment_details_for_order_item();
