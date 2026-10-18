alter table public.profiles
  add column if not exists marketplace_approval_status text,
  add column if not exists marketplace_approval_note text,
  add column if not exists marketplace_reviewed_at timestamptz,
  add column if not exists marketplace_reviewed_by uuid references auth.users(id) on delete set null;

update public.profiles
set marketplace_approval_status = case when role in ('vendor', 'agent') then 'pending' else 'approved' end
where marketplace_approval_status is null;

alter table public.profiles
  alter column marketplace_approval_status set default 'approved',
  alter column marketplace_approval_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_marketplace_approval_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_marketplace_approval_status_check
      check (marketplace_approval_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

create table if not exists public.finance_admin_allowlist (
  email text primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);
alter table public.finance_admin_allowlist enable row level security;
revoke all on public.finance_admin_allowlist from public, anon, authenticated;
create or replace function public.is_finance_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users account
    join public.finance_admin_allowlist allowlist
      on allowlist.email = lower(account.email)
    where account.id = (select auth.uid())
      and account.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_finance_admin() from public, anon;
grant execute on function public.is_finance_admin() to authenticated;

create table if not exists public.finance_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('account_approved', 'account_rejected', 'seller_payout_paid', 'payment_case_refunded')),
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.finance_admin_audit_log enable row level security;
revoke all on public.finance_admin_audit_log from public, anon, authenticated;
grant select on public.finance_admin_audit_log to authenticated;
create policy "finance admins read audit history" on public.finance_admin_audit_log
  for select to authenticated using (public.is_finance_admin());

create policy "finance admins review marketplace applicants" on public.profiles
  for select to authenticated using (
    public.is_finance_admin()
    and role in ('vendor', 'agent')
    and marketplace_approval_status = 'pending'
  );

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
      and marketplace_approval_status = 'approved'
      and seller_upi_id is not null
      and seller_phone is not null
  );
$$;
revoke all on function public.seller_payment_details_are_set(uuid) from public, anon;
grant execute on function public.seller_payment_details_are_set(uuid) to authenticated;

drop policy if exists "vendors upload own product photos" on storage.objects;
create policy "vendors upload own product photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles vendor
      where vendor.id = (select auth.uid())
        and vendor.role = 'vendor'
        and vendor.marketplace_approval_status = 'approved'
    )
  );

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
    and exists (
      select 1 from public.profiles vendor
      where vendor.id = (select auth.uid())
        and vendor.role = 'vendor'
        and vendor.marketplace_approval_status = 'approved'
    )
  );

drop policy if exists "vendors update own listings" on public.products;
create policy "vendors update own listings" on public.products
  for update to authenticated using (vendor_id = (select auth.uid()))
  with check (
    vendor_id = (select auth.uid())
    and exists (
      select 1 from public.profiles vendor
      where vendor.id = (select auth.uid())
        and vendor.role = 'vendor'
        and vendor.marketplace_approval_status = 'approved'
    )
  );

create or replace function public.require_vendor_payment_details_for_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles vendor
    where vendor.id = new.vendor_id
      and vendor.role = 'vendor'
      and vendor.marketplace_approval_status = 'approved'
      and vendor.seller_upi_id is not null
      and vendor.seller_phone is not null
  ) then
    raise exception 'The seller must be approved and have payment details before accepting orders.';
  end if;
  return new;
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
  if p_role is null then raise exception 'Choose an account type.'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'Enter a name between 2 and 60 characters.'; end if;
  update public.profiles
    set role = p_role,
        display_name = v_name,
        marketplace_approval_status = case when p_role = 'buyer' then 'approved' else 'pending' end
    where id = v_user_id and role is null;
  if not found then raise exception 'The account role was already set.'; end if;
end;
$$;
revoke all on function public.choose_market_role(public.market_role, text) from public, anon;
grant execute on function public.choose_market_role(public.market_role, text) to authenticated;

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
    select 1 from public.profiles
    where id = v_agent_id and role = 'agent' and marketplace_approval_status = 'approved'
  ) then
    raise exception 'An approved delivery-agent account is required.';
  end if;
  update public.delivery_jobs
    set agent_id = v_agent_id, status = 'accepted', updated_at = now()
    where id = p_job_id and status = 'offered'
    returning id into v_accepted;
  return v_accepted is not null;
end;
$$;
revoke all on function public.accept_delivery_job(uuid) from public, anon;
grant execute on function public.accept_delivery_job(uuid) to authenticated;

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
    select 1 from public.profiles
    where id = v_vendor_id and role = 'vendor' and marketplace_approval_status = 'approved'
  ) then raise exception 'An approved vendor account is required.'; end if;
  if char_length(v_pickup) not between 5 and 180 then raise exception 'Enter a valid vendor pickup address.'; end if;
  update public.profiles set pickup_address = v_pickup where id = v_vendor_id;
  update public.delivery_jobs
    set vendor_address = v_pickup, status = 'offered', updated_at = now()
    where id = p_job_id and vendor_id = v_vendor_id and status = 'new';
  if not found then raise exception 'This delivery is no longer waiting for vendor preparation.'; end if;
end;
$$;
revoke all on function public.prepare_delivery_job(uuid, text) from public, anon;
grant execute on function public.prepare_delivery_job(uuid, text) to authenticated;

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
    select 1 from public.profiles
    where id = v_agent_id and role = 'agent' and marketplace_approval_status = 'approved'
  ) then
    raise exception 'An approved delivery-agent account is required.';
  end if;
  if p_status not in ('picked_up', 'delivered') then raise exception 'Invalid delivery status.'; end if;
  update public.delivery_jobs
    set status = p_status, updated_at = now()
    where id = p_job_id
      and agent_id = v_agent_id
      and ((status = 'accepted' and p_status = 'picked_up') or (status = 'picked_up' and p_status = 'delivered'));
  if not found then raise exception 'This delivery cannot move to that status.'; end if;
end;
$$;
revoke all on function public.advance_delivery_job(uuid, public.delivery_job_status) from public, anon;
grant execute on function public.advance_delivery_job(uuid, public.delivery_job_status) to authenticated;

drop policy if exists "participants read delivery jobs" on public.delivery_jobs;
create policy "participants read delivery jobs" on public.delivery_jobs
  for select to authenticated using (
    buyer_id = (select auth.uid())
    or (
      vendor_id = (select auth.uid())
      and exists (
        select 1 from public.profiles vendor
        where vendor.id = (select auth.uid())
          and vendor.role = 'vendor'
          and vendor.marketplace_approval_status = 'approved'
      )
    )
    or (
      agent_id = (select auth.uid())
      and exists (
        select 1 from public.profiles agent
        where agent.id = (select auth.uid())
          and agent.role = 'agent'
          and agent.marketplace_approval_status = 'approved'
      )
    )
    or (
      status = 'offered'
      and exists (
        select 1 from public.profiles agent
        where agent.id = (select auth.uid())
          and agent.role = 'agent'
          and agent.marketplace_approval_status = 'approved'
      )
    )
  );

drop policy if exists "vendors ready jobs" on public.delivery_jobs;
revoke update on public.delivery_jobs from public, anon, authenticated;

create or replace function public.review_marketplace_account(
  p_user_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not public.is_finance_admin() then raise exception 'Finance administrator access is required.'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Choose an approval or rejection decision.';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'Enter a review note between 10 and 500 characters.';
  end if;
  if p_decision = 'approved' and exists (
    select 1 from public.profiles
    where id = p_user_id
      and role = 'vendor'
      and (seller_upi_id is null or seller_phone is null)
  ) then
    raise exception 'The vendor must save a UPI ID and phone number before approval.';
  end if;

  update public.profiles
    set marketplace_approval_status = p_decision,
        marketplace_approval_note = v_note,
        marketplace_reviewed_at = now(),
        marketplace_reviewed_by = auth.uid()
    where id = p_user_id
      and role in ('vendor', 'agent')
      and marketplace_approval_status = 'pending';
  if not found then raise exception 'This account is not awaiting review.'; end if;

  insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
  values (
    auth.uid(),
    case when p_decision = 'approved' then 'account_approved' else 'account_rejected' end,
    p_user_id::text,
    jsonb_build_object('decision', p_decision, 'note', v_note)
  );
end;
$$;
revoke all on function public.review_marketplace_account(uuid, text, text) from public, anon;
grant execute on function public.review_marketplace_account(uuid, text, text) to authenticated;

create or replace function public.request_marketplace_review()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  update public.profiles
    set marketplace_approval_status = 'pending',
        marketplace_approval_note = null,
        marketplace_reviewed_at = null,
        marketplace_reviewed_by = null
    where id = v_user_id
      and role in ('vendor', 'agent')
      and marketplace_approval_status = 'rejected'
      and (role <> 'vendor' or (seller_upi_id is not null and seller_phone is not null));
  if not found then raise exception 'This account cannot request another review yet.'; end if;
end;
$$;
revoke all on function public.request_marketplace_review() from public, anon;
grant execute on function public.request_marketplace_review() to authenticated;

create policy "finance admins read seller payouts" on public.seller_payouts
  for select to authenticated using (public.is_finance_admin());
create policy "finance admins read payment review cases" on public.payment_reconciliation_cases
  for select to authenticated using (public.is_finance_admin());

create or replace function public.record_seller_payout(p_payout_id uuid, p_transfer_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text := btrim(coalesce(p_transfer_reference, ''));
begin
  if auth.uid() is not null and not public.is_finance_admin() then
    raise exception 'Finance administrator access is required.';
  end if;
  if char_length(v_reference) not between 4 and 120 then
    raise exception 'Enter a valid bank transfer reference.';
  end if;
  update public.seller_payouts
    set status = 'paid', transfer_reference = v_reference, paid_at = now()
    where id = p_payout_id and status = 'pending' and amount > 0;
  if not found then raise exception 'The seller payout is not pending or has no amount due.'; end if;

  insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
  values (auth.uid(), 'seller_payout_paid', p_payout_id::text, jsonb_build_object('transfer_reference', v_reference));
end;
$$;
revoke all on function public.record_seller_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.record_seller_payout(uuid, text) to authenticated, service_role;

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
  v_order_id uuid;
begin
  if auth.uid() is not null and not public.is_finance_admin() then
    raise exception 'Finance administrator access is required.';
  end if;
  if p_resolution_status is distinct from 'refunded' then
    raise exception 'Only record a successful refund after the funds are actually returned.';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'Enter a refund reference and note between 10 and 500 characters.';
  end if;

  update public.payment_reconciliation_cases
    set status = 'resolved', resolution_note = v_note, resolved_at = now()
    where payment_id = p_payment_id and status = 'open'
    returning order_id into v_order_id;
  if not found then raise exception 'The payment reconciliation case is not open.'; end if;

  update public.orders
    set payment_review_required = exists (
      select 1 from public.payment_reconciliation_cases
      where order_id = v_order_id and status = 'open'
    ),
    payment_status = case
      when payment_status = 'review' and not exists (
        select 1 from public.payment_reconciliation_cases
        where order_id = v_order_id and status = 'open'
      ) then 'refunded'
      else payment_status
    end
    where id = v_order_id;

  insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
  values (auth.uid(), 'payment_case_refunded', p_payment_id, jsonb_build_object('note', v_note));
end;
$$;
revoke all on function public.resolve_payment_reconciliation(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_payment_reconciliation(text, text, text) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_reconciliation_cases'
    ) then
      alter publication supabase_realtime add table public.payment_reconciliation_cases;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_admin_audit_log'
    ) then
      alter publication supabase_realtime add table public.finance_admin_audit_log;
    end if;
  end if;
end;
$$;
