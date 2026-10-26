alter table public.delivery_jobs
  add column if not exists delivery_otp text,
  add column if not exists delivery_proof_note text,
  add column if not exists delivery_proof_photo_path text,
  add column if not exists delivered_at timestamptz;

revoke select (delivery_otp) on table public.delivery_jobs from authenticated;

create or replace function public.get_delivery_otp(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_otp text;
begin
  select delivery_otp into v_otp
  from public.delivery_jobs
  where id = p_job_id and buyer_id = v_buyer_id and status not in ('cancelled', 'delivered')
  for update;
  if not found then
    raise exception 'Only the buyer can view the active delivery code.';
  end if;
  if v_otp is null then
    v_otp := lpad((floor(random() * 10000))::integer::text, 4, '0');
    update public.delivery_jobs set delivery_otp = v_otp, updated_at = now() where id = p_job_id;
  end if;
  return v_otp;
end;
$$;

create or replace function public.advance_delivery_job(
  p_job_id uuid,
  p_status public.delivery_job_status,
  p_otp text default null,
  p_proof_note text default null,
  p_proof_photo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid := auth.uid();
  v_expected_otp text;
  v_note text := btrim(coalesce(p_proof_note, ''));
begin
  if v_agent_id is null or not exists (
    select 1 from public.profiles where id = v_agent_id and role = 'agent'
  ) then
    raise exception 'A delivery-agent account is required.';
  end if;
  if p_status not in ('picked_up', 'delivered') then
    raise exception 'Invalid delivery status.';
  end if;
  if p_status = 'delivered' then
    if p_otp !~ '^[0-9]{4}$' then raise exception 'Enter the buyer delivery code.'; end if;
    if char_length(v_note) > 500 then raise exception 'Delivery notes must be 500 characters or fewer.'; end if;
    select delivery_otp into v_expected_otp
    from public.delivery_jobs
    where id = p_job_id and agent_id = v_agent_id and status = 'picked_up'
    for update;
    if not found or v_expected_otp is null or p_otp <> v_expected_otp then
      raise exception 'That delivery code is incorrect.';
    end if;
    update public.delivery_jobs
      set status = 'delivered',
          delivery_proof_note = nullif(v_note, ''),
          delivery_proof_photo_path = nullif(btrim(coalesce(p_proof_photo_path, '')), ''),
          delivered_at = now(),
          updated_at = now()
      where id = p_job_id and agent_id = v_agent_id and status = 'picked_up';
  else
    update public.delivery_jobs
      set status = 'picked_up', updated_at = now()
      where id = p_job_id and agent_id = v_agent_id and status = 'accepted';
  end if;
  if not found then raise exception 'This delivery cannot move to that status.'; end if;
end;
$$;

revoke all on function public.get_delivery_otp(uuid) from public, anon;
grant execute on function public.get_delivery_otp(uuid) to authenticated;
revoke all on function public.advance_delivery_job(uuid, public.delivery_job_status, text, text, text) from public, anon;
grant execute on function public.advance_delivery_job(uuid, public.delivery_job_status, text, text, text) to authenticated;

create or replace function public.create_delivery_proof_bucket()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into storage.buckets (id, name, public)
  values ('delivery-proof', 'delivery-proof', false)
  on conflict (id) do nothing;
end;
$$;
select public.create_delivery_proof_bucket();
drop function public.create_delivery_proof_bucket();

drop policy if exists "agents upload delivery proof" on storage.objects;
create policy "agents upload delivery proof" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-proof'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'agent')
  );
