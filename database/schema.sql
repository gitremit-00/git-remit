create table users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique,
  role text not null check (role in ('sender', 'merchant', 'admin')),
  full_name text not null,
  face_verified boolean not null default false,
  id_verified boolean not null default false,
  reputation_score integer not null default 50,
  created_at timestamptz not null default now()
);

create table merchants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  business_name text not null,
  category text not null,
  payout_wallet_address text not null,
  created_at timestamptz not null default now()
);

create table pledges (
  id uuid primary key default gen_random_uuid(),
  contract_pledge_id bigint unique,
  sender_id uuid not null references users(id),
  merchant_id uuid not null references merchants(id),
  asset_symbol text not null check (asset_symbol in ('ETH', 'USDC', 'USDT')),
  token_address text,
  total_amount numeric(36, 18) not null,
  deposited_amount numeric(36, 18) not null default 0,
  status text not null check (status in ('created', 'partially_locked', 'funded', 'released', 'cancelled')),
  tx_hash text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reputation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  pledge_id uuid references pledges(id),
  points integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
