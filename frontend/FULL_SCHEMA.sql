-- ============================================================
-- RemitSafe — Complete Supabase Schema
-- Run this in Supabase SQL Editor (safe to re-run: idempotent)
-- ============================================================


-- ─────────────────────────────────────────
-- 1. PROFILES
-- ─────────────────────────────────────────

create table if not exists public.profiles (
  id                  uuid        primary key references auth.users(id) on delete cascade,
  username            text        unique not null,
  -- role: 'ofw_sender' | 'merchant' | 'admin'
  role                text        not null default 'ofw_sender'
                                  check (role in ('ofw_sender', 'merchant', 'admin')),
  full_name           text        not null,
  phone_number        text        not null,
  email               text        unique not null,
  country_of_work     text        not null,
  country_of_origin   text        not null,
  gov_id_type         text        not null,
  id_number           text        not null,
  gov_id_photo_url    text        not null,
  business_permit_url text,
  -- extended profile fields
  bio                 text,
  avatar_url          text,
  business_name       text,
  business_type       text,
  business_address    text,
  city                text,
  -- meta
  email_verified      boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

-- Drop old constraint if it existed without 'admin', then recreate
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ofw_sender', 'merchant', 'admin'));

-- Add new columns if upgrading from old schema
alter table public.profiles add column if not exists bio              text;
alter table public.profiles add column if not exists avatar_url       text;
alter table public.profiles add column if not exists business_name    text;
alter table public.profiles add column if not exists business_type    text;
alter table public.profiles add column if not exists business_address text;
alter table public.profiles add column if not exists city             text;


-- ─────────────────────────────────────────
-- 2. UPDATED_AT TRIGGER
-- ─────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ─────────────────────────────────────────
-- 3. PROFILES — ROW LEVEL SECURITY
-- ─────────────────────────────────────────

alter table public.profiles enable row level security;

-- Users read their own profile
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Users insert their own profile (on signup)
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Users update their own profile
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Service role (used by Next.js API routes) bypasses RLS automatically.
-- No extra policy needed — adminClient() uses the service role key.


-- ─────────────────────────────────────────
-- 4. PAYMENT REQUESTS
-- ─────────────────────────────────────────

create table if not exists public.payment_requests (
  id               uuid        primary key default gen_random_uuid(),
  merchant_address text        not null,
  merchant_name    text,
  amount           numeric     not null check (amount > 0),
  deadline         timestamptz not null,
  title            text,
  note             text,
  status           text        not null default 'open'
                               check (status in ('open', 'fulfilled', 'cancelled')),
  created_at       timestamptz not null default now()
);

alter table public.payment_requests enable row level security;

-- Anyone authenticated can read open payment requests
drop policy if exists "Anyone can read payment requests" on public.payment_requests;
create policy "Anyone can read payment requests"
  on public.payment_requests for select
  to authenticated
  using (true);

-- Merchants can create payment requests
drop policy if exists "Merchants can create payment requests" on public.payment_requests;
create policy "Merchants can create payment requests"
  on public.payment_requests for insert
  to authenticated
  with check (true);

-- Merchants can update their own payment requests
drop policy if exists "Merchants can update own payment requests" on public.payment_requests;
create policy "Merchants can update own payment requests"
  on public.payment_requests for update
  to authenticated
  using (true);


-- ─────────────────────────────────────────
-- 5. PAYMENT REQUEST NOTIFICATIONS
-- ─────────────────────────────────────────

create table if not exists public.payment_request_notifications (
  id             uuid        primary key default gen_random_uuid(),
  request_id     uuid        not null references public.payment_requests(id) on delete cascade,
  sender_address text        not null,
  read           boolean     not null default false,
  created_at     timestamptz not null default now()
);

alter table public.payment_request_notifications enable row level security;

-- Senders read their own notifications
drop policy if exists "Senders read own notifications" on public.payment_request_notifications;
create policy "Senders read own notifications"
  on public.payment_request_notifications for select
  to authenticated
  using (true);

-- Anyone authenticated can insert notifications
drop policy if exists "Anyone can insert notifications" on public.payment_request_notifications;
create policy "Anyone can insert notifications"
  on public.payment_request_notifications for insert
  to authenticated
  with check (true);

-- Senders can mark their notifications as read
drop policy if exists "Senders can update notifications" on public.payment_request_notifications;
create policy "Senders can update notifications"
  on public.payment_request_notifications for update
  to authenticated
  using (true);


-- ─────────────────────────────────────────
-- 6. STORAGE BUCKETS
-- ─────────────────────────────────────────

-- Government IDs (private)
insert into storage.buckets (id, name, public)
  values ('government-ids', 'government-ids', false)
  on conflict (id) do nothing;

-- Business permits (private)
insert into storage.buckets (id, name, public)
  values ('business-permits', 'business-permits', false)
  on conflict (id) do nothing;

-- Avatars (public — URLs are shared in the UI)
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;


-- ─────────────────────────────────────────
-- 7. STORAGE POLICIES
-- ─────────────────────────────────────────

-- Government IDs
drop policy if exists "Users can upload own government IDs" on storage.objects;
create policy "Users can upload own government IDs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'government-ids'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read own government IDs" on storage.objects;
create policy "Users can read own government IDs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'government-ids'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Service role can read all government IDs" on storage.objects;
create policy "Service role can read all government IDs"
  on storage.objects for select to service_role
  using (bucket_id = 'government-ids');

-- Business permits
drop policy if exists "Users can upload own business permits" on storage.objects;
create policy "Users can upload own business permits"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-permits'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can read own business permits" on storage.objects;
create policy "Users can read own business permits"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'business-permits'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Service role can read all business permits" on storage.objects;
create policy "Service role can read all business permits"
  on storage.objects for select to service_role
  using (bucket_id = 'business-permits');

-- Avatars (public bucket — anyone can read)
drop policy if exists "Anyone can read avatars" on storage.objects;
create policy "Anyone can read avatars"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ─────────────────────────────────────────
-- 8. MAKE AN EXISTING USER ADMIN
--    Replace the email below with your own.
-- ─────────────────────────────────────────

-- update public.profiles
--   set role = 'admin'
--   where email = 'your@email.com';
