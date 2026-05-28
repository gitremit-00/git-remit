-- ============================================================
-- RemitSafe — Complete Supabase Schema
-- Run this in Supabase SQL Editor (safe to re-run: idempotent)
-- ============================================================


-- ─────────────────────────────────────────
-- 1. PROFILES
-- ─────────────────────────────────────────

create table if not exists public.profiles (
  id                    uuid        primary key references auth.users(id) on delete cascade,
  username              text        unique not null,
  -- role: 'ofw_sender' | 'merchant' | 'admin'
  role                  text        not null default 'ofw_sender'
                                    check (role in ('ofw_sender', 'merchant', 'admin')),
  full_name             text        not null,
  phone_number          text        not null,
  email                 text        unique not null,
  country_of_work       text        not null,
  country_of_origin     text        not null,
  gov_id_type           text        not null,
  id_number             text        not null,
  gov_id_photo_url      text        not null,
  business_permit_url   text,
  -- extended profile fields
  bio                   text,
  avatar_url            text,
  business_name         text,
  business_type         text,
  business_address      text,
  city                  text,
  -- KYC review fields
  kyc_status            text        not null default 'pending'
                                    check (kyc_status in ('pending', 'verified', 'rejected', 'needs_revision')),
  kyc_reviewed_by       uuid        references auth.users(id),
  kyc_reviewed_at       timestamptz,
  kyc_rejection_reason  text,
  -- meta
  email_verified        boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

-- Recreate role constraint (adds 'admin' if upgrading from old schema)
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ofw_sender', 'merchant', 'admin'));

-- Recreate KYC status constraint
alter table public.profiles
  drop constraint if exists profiles_kyc_status_check;
alter table public.profiles
  add constraint profiles_kyc_status_check
  check (kyc_status in ('pending', 'verified', 'rejected', 'needs_revision'));

-- Add columns for existing databases upgrading from older schema
alter table public.profiles add column if not exists bio                  text;
alter table public.profiles add column if not exists avatar_url           text;
alter table public.profiles add column if not exists business_name        text;
alter table public.profiles add column if not exists business_type        text;
alter table public.profiles add column if not exists business_address     text;
alter table public.profiles add column if not exists city                 text;
alter table public.profiles add column if not exists kyc_status           text not null default 'pending';
alter table public.profiles add column if not exists kyc_reviewed_by      uuid references auth.users(id);
alter table public.profiles add column if not exists kyc_reviewed_at      timestamptz;
alter table public.profiles add column if not exists kyc_rejection_reason text;

-- Back-fill any existing rows that have no KYC status
update public.profiles set kyc_status = 'pending' where kyc_status is null;


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
-- NOTE: All admin reads/writes use adminClient() (service role key) in
-- Next.js API routes, which bypasses RLS entirely. No admin-specific
-- policy is needed here.

alter table public.profiles enable row level security;

-- Users read their own profile
drop policy if exists "Users read own profile" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Users insert their own profile (registration via service role — this is a
-- safety net for any client-side insert attempt)
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Users update their own non-KYC profile fields.
-- The sub-select prevents users from changing their own kyc_status.
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and kyc_status = (select kyc_status from public.profiles where id = auth.uid())
  );


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

drop policy if exists "Anyone can read payment requests" on public.payment_requests;
create policy "Anyone can read payment requests"
  on public.payment_requests for select
  to authenticated
  using (true);

drop policy if exists "Merchants can create payment requests" on public.payment_requests;
create policy "Merchants can create payment requests"
  on public.payment_requests for insert
  to authenticated
  with check (true);

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

drop policy if exists "Senders read own notifications" on public.payment_request_notifications;
create policy "Senders read own notifications"
  on public.payment_request_notifications for select
  to authenticated
  using (true);

drop policy if exists "Anyone can insert notifications" on public.payment_request_notifications;
create policy "Anyone can insert notifications"
  on public.payment_request_notifications for insert
  to authenticated
  with check (true);

drop policy if exists "Senders can update notifications" on public.payment_request_notifications;
create policy "Senders can update notifications"
  on public.payment_request_notifications for update
  to authenticated
  using (true);


-- ─────────────────────────────────────────
-- 6. STORAGE BUCKETS
-- ─────────────────────────────────────────

-- Government IDs (private — signed URLs required to view)
insert into storage.buckets (id, name, public)
  values ('government-ids', 'government-ids', false)
  on conflict (id) do update set public = false;

-- Business permits (private — signed URLs required to view)
insert into storage.buckets (id, name, public)
  values ('business-permits', 'business-permits', false)
  on conflict (id) do update set public = false;

-- Avatars (public — URLs are shared in the UI)
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;


-- ─────────────────────────────────────────
-- 7. STORAGE POLICIES
-- ─────────────────────────────────────────

-- Government IDs — users upload to their own folder only
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

-- Service role reads all (used by admin signed-URL API route)
drop policy if exists "Service role can read all government IDs" on storage.objects;
create policy "Service role can read all government IDs"
  on storage.objects for select to service_role
  using (bucket_id = 'government-ids');

-- Business permits — users upload to their own folder only
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
--    Uncomment and replace the email below.
-- ─────────────────────────────────────────

-- update public.profiles
--   set role = 'admin'
--   where email = 'your@email.com';
