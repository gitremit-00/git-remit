-- Add wallet_address column to profiles table
-- Run this in the Supabase SQL editor before deploying the KYC on-chain fix.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Optional: index for lookups by wallet address
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_address ON profiles (wallet_address);
