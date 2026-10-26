do $$
begin
  alter table public.profiles
    drop constraint if exists profiles_marketplace_approval_status_check;
  alter table public.profiles
    add constraint profiles_marketplace_approval_status_check
    check (marketplace_approval_status in ('pending', 'approved', 'rejected', 'suspended', 'banned'));
end;
$$;

create table if not exists public.admin_invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  intended_role public.market_role not null check (intended_role in ('vendor', 'agent')),
  created_by uuid references auth.users(id) on delete set null,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.admin_invite_codes enable row level security;
revoke all on public.admin_invite_codes from public, anon, authenticated;

drop policy if exists "finance admins read marketplace applicants" on public.profiles;
drop policy if exists "finance admins manage marketplace accounts" on public.profiles;
create policy "finance admins manage marketplace accounts" on public.profiles
  for select to authenticated using (
    public.is_finance_admin() and role in ('vendor', 'agent')
  );

alter table public.finance_admin_audit_log
  drop constraint if exists finance_admin_audit_log_action_check;
alter table public.finance_admin_audit_log
  add constraint finance_admin_audit_log_action_check check (
    action in (
      'account_approved',
      'account_rejected',
      'account_suspended',
      'account_banned',
      'account_reinstated',
      'seller_payout_paid',
      'payment_case_refunded',
      'service_provider_created',
      'invite_code_created',
      'invite_code_redeemed'
    )
  );

create or replace function public.create_admin_invite_code(p_role public.market_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(substr(pg_catalog.md5(
    auth.uid()::text || pg_catalog.clock_timestamp()::text || pg_catalog.random()::text
  ), 1, 12));
begin
  if not public.is_finance_admin() then
    raise exception 'Finance administrator access is required.';
  end if;
  if p_role not in ('vendor', 'agent') then
    raise exception 'Invite codes are only available for sellers and delivery agents.';
  end if;

  insert into public.admin_invite_codes (code_hash, intended_role, created_by)
  values (pg_catalog.md5(lower(v_code)), p_role, auth.uid());

  insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
  values (auth.uid(), 'invite_code_created', v_code, jsonb_build_object('role', p_role));
  return v_code;
end;
$$;
revoke all on function public.create_admin_invite_code(public.market_role) from public, anon;
grant execute on function public.create_admin_invite_code(public.market_role) to authenticated;

create or replace function public.choose_market_role(
  p_role public.market_role,
  p_display_name text,
  p_invite_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_code text := lower(btrim(coalesce(p_invite_code, '')));
  v_code_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to finish account setup.'; end if;
  if p_role is null then raise exception 'Choose an account type.'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'Enter a name between 2 and 60 characters.'; end if;

  if p_role in ('vendor', 'agent') then
    if v_code = '' then raise exception 'An admin invite code is required for this account type.'; end if;
    update public.admin_invite_codes
      set redeemed_by = v_user_id, redeemed_at = now()
      where code_hash = pg_catalog.md5(v_code)
        and intended_role = p_role
        and redeemed_by is null
      returning id into v_code_id;
    if v_code_id is null then raise exception 'This invite code is invalid, expired, or already used.'; end if;
  end if;

  update public.profiles
    set role = p_role,
        display_name = v_name,
        marketplace_approval_status = case when p_role = 'buyer' then 'approved' else 'pending' end
    where id = v_user_id and role is null;
  if not found then raise exception 'The account role was already set.'; end if;

  if v_code_id is not null then
    insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
    values (null, 'invite_code_redeemed', v_code_id::text, jsonb_build_object('user_id', v_user_id, 'role', p_role));
  end if;
end;
$$;
revoke all on function public.choose_market_role(public.market_role, text, text) from public, anon;
grant execute on function public.choose_market_role(public.market_role, text, text) to authenticated;

create or replace function public.choose_market_role(p_role public.market_role, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.choose_market_role(p_role, p_display_name, null);
end;
$$;
revoke all on function public.choose_market_role(public.market_role, text) from public, anon;
grant execute on function public.choose_market_role(public.market_role, text) to authenticated;

create or replace function public.update_marketplace_account_status(
  p_user_id uuid,
  p_status text,
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
  if p_status not in ('approved', 'rejected', 'suspended', 'banned') then
    raise exception 'Choose a valid account status.';
  end if;
  if char_length(v_note) not between 10 and 500 then
    raise exception 'Enter a reason between 10 and 500 characters.';
  end if;

  update public.profiles
    set marketplace_approval_status = p_status,
        marketplace_approval_note = v_note,
        marketplace_reviewed_at = now(),
        marketplace_reviewed_by = auth.uid()
    where id = p_user_id and role in ('vendor', 'agent');
  if not found then raise exception 'Marketplace account not found.'; end if;

  insert into public.finance_admin_audit_log (admin_id, action, entity_id, details)
  values (
    auth.uid(),
    case p_status
      when 'approved' then 'account_reinstated'
      when 'suspended' then 'account_suspended'
      when 'banned' then 'account_banned'
      else 'account_rejected'
    end,
    p_user_id::text,
    jsonb_build_object('status', p_status, 'note', v_note)
  );
end;
$$;
revoke all on function public.update_marketplace_account_status(uuid, text, text) from public, anon;
grant execute on function public.update_marketplace_account_status(uuid, text, text) to authenticated;
