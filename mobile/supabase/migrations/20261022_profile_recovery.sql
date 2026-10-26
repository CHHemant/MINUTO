create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to initialize your profile.'; end if;
  insert into public.profiles (id, email, display_name)
  select account.id, coalesce(account.email, ''), coalesce(account.raw_user_meta_data ->> 'display_name', '')
  from auth.users account
  where account.id = auth.uid()
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;
