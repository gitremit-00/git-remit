-- Migration: Add account hold fields to profiles table
-- Run this in the Supabase SQL editor or via supabase db push

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'on_hold')),
  ADD COLUMN IF NOT EXISTS account_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS account_held_at TIMESTAMPTZ;

-- Index for quick admin queries filtering by hold status
CREATE INDEX IF NOT EXISTS idx_profiles_account_status ON profiles (account_status);
