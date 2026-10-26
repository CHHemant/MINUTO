create table public.service_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.service_bookings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.service_providers(id),
  rating integer not null check (rating between 1 and 5),
  review text not null default '' check (char_length(review) <= 500),
  created_at timestamptz not null default now()
);
create index service_reviews_provider_idx on public.service_reviews (provider_id, created_at desc);

alter table public.service_reviews enable row level security;

create policy "buyers read own service reviews" on public.service_reviews
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy "buyers create own completed service reviews" on public.service_reviews
  for insert to authenticated with check (
    buyer_id = (select auth.uid())
    and exists (
      select 1 from public.service_bookings booking
      where booking.id = booking_id
        and booking.buyer_id = (select auth.uid())
        and booking.status = 'completed'
        and booking.provider_id = service_reviews.provider_id
    )
  );
create policy "finance admins read service reviews" on public.service_reviews
  for select to authenticated using (public.is_finance_admin());

create or replace function public.submit_service_review(
  p_booking_id uuid,
  p_rating integer,
  p_review text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_booking public.service_bookings%rowtype;
  v_review_id uuid;
  v_review text := btrim(coalesce(p_review, ''));
begin
  if v_buyer_id is null then raise exception 'Sign in to review a service.'; end if;
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5.'; end if;
  if char_length(v_review) > 500 then raise exception 'Review must be 500 characters or fewer.'; end if;
  select * into v_booking from public.service_bookings
    where id = p_booking_id and buyer_id = v_buyer_id and status = 'completed';
  if not found then raise exception 'Only completed services can be reviewed.'; end if;
  if exists (select 1 from public.service_reviews where booking_id = p_booking_id) then
    raise exception 'This service has already been reviewed.';
  end if;
  insert into public.service_reviews (booking_id, buyer_id, provider_id, rating, review)
  values (v_booking.id, v_buyer_id, v_booking.provider_id, p_rating, v_review)
  returning id into v_review_id;
  update public.service_providers provider
    set rating = round((
      select avg(review.rating)::numeric
      from public.service_reviews review
      where review.provider_id = provider.id
    ), 1),
    review_count = (
      select count(*)::integer
      from public.service_reviews review
      where review.provider_id = provider.id
    )
    where provider.id = v_booking.provider_id;
  return v_review_id;
end;
$$;

revoke all on function public.submit_service_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_service_review(uuid, integer, text) to authenticated;
