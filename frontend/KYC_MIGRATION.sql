-- ============================================================
-- RemitSafe — KYC Migration (v2)
-- Run in Supabase SQL Editor (safe to re-run: idempotent)
-- ============================================================

-- ─────────────────────────────────────────
-- 1. ADD KYC COLUMNS
-- ─────────────────────────────────────────
alter table public.profiles
  add column if not exists kyc_status           text        not null default 'pending'
    check (kyc_status in ('pending', 'verified', 'rejected', 'needs_revision')),
  add column if not exists kyc_reviewed_by      uuid        references auth.users(id),
  add column if not exists kyc_reviewed_at      timestamptz,
  add column if not exists kyc_rejection_reason text;

-- Recreate constraint so it matches current allowed values
alter table public.profiles
  drop constraint if exists profiles_kyc_status_check;
alter table public.profiles
  add constraint profiles_kyc_status_check
  check (kyc_status in ('pending', 'verified', 'rejected', 'needs_revision'));

-- Back-fill any NULL kyc_status values on existing rows
update public.profiles
  set kyc_status = 'pending'
  where kyc_status is null;


-- ─────────────────────────────────────────
-- 2. RLS POLICIES
-- ─────────────────────────────────────────
-- NOTE: Admin reads/writes go through the service role key (adminClient in Next.js
-- API routes) which bypasses RLS entirely — no special admin policy is needed.
-- Regular users only need to read/update their own row.

alter table public.profiles enable row level security;

-- Users read their own profile
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select
  using (id = auth.uid());

-- Users insert their own profile (registration)
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert
  with check (id = auth.uid());

-- Users update their own non-KYC fields (kyc_status stays unchanged)
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and kyc_status = (select kyc_status from public.profiles where id = auth.uid())
  );

-- ─────────────────────────────────────────
-- 3. SERVICE ROLE BYPASS (already default)
-- ─────────────────────────────────────────
-- The Supabase service role key bypasses RLS by default.
-- All admin API routes use adminClient() which uses the service role key.
-- No extra policy needed for admin reads/writes.


-- ─────────────────────────────────────────
-- 4. STORAGE BUCKETS
-- ─────────────────────────────────────────
-- Create these in Supabase Dashboard → Storage → New bucket:
--   • government-ids    (Private)
--   • business-permits  (Private)
--   • avatars           (Public)
--
-- Then run the following storage policies:

-- Allow authenticated users to upload to their own folder
insert into storage.buckets (id, name, public) values
  ('government-ids',   'government-ids',   false),
  ('business-permits', 'business-permits', false),
  ('avatars',          'avatars',          true)
on conflict (id) do nothing;

-- Service role can read/write all storage (default, no policy needed)
-- Users can upload to their own subfolder only
drop policy if exists "Users upload own government-id" on storage.objects;
create policy "Users upload own government-id"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'government-ids' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users upload own business-permit" on storage.objects;
create policy "Users upload own business-permit"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'business-permits' and (storage.foldername(name))[1] = auth.uid()::text);


-- ─────────────────────────────────────────
-- 5. UPDATED_AT TRIGGER
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
