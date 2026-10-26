create or replace function public.cancel_service_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to cancel a service.'; end if;
  update public.service_bookings
    set status = 'cancelled', updated_at = now()
    where id = p_booking_id
      and buyer_id = auth.uid()
      and status in ('requested', 'confirmed');
  if not found then
    raise exception 'This booking can no longer be cancelled.';
  end if;
end;
$$;

revoke all on function public.cancel_service_booking(uuid) from public, anon;
grant execute on function public.cancel_service_booking(uuid) to authenticated;
