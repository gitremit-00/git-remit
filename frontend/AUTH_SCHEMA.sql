-- RemitSafe Supabase Auth + profiles schema.
-- Run this in Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null check (role in ('ofw_sender', 'merchant')),
  full_name text not null,
  phone_number text not null,
  email text unique not null,
  country_of_work text not null,
  country_of_origin text not null,
  gov_id_type text not null,
  id_number text not null,
  gov_id_photo_url text not null,
  business_permit_url text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values
  ('government-ids', 'government-ids', false),
  ('business-permits', 'business-permits', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload own government IDs" on storage.objects;
create policy "Users can upload own government IDs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'government-ids'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own government IDs" on storage.objects;
create policy "Users can read own government IDs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'government-ids'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can upload own business permits" on storage.objects;
create policy "Users can upload own business permits"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'business-permits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own business permits" on storage.objects;
create policy "Users can read own business permits"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'business-permits'
  and (storage.foldername(name))[1] = auth.uid()::text
);
