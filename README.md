# RemitSafe

RemitSafe is a blockchain-backed remittance pledge system for overseas Filipino workers. A sender can lock partial funds into a pledge first, then complete the remaining payment later. Merchants such as schools, landlords, and clinics can view pledge status, verify locked funds, and receive payment after the sender completes the deposit.

The hackathon build supports native ETH plus ERC-20 USDC and USDT. ETH is handled with payable Solidity functions. USDC and USDT use the standard ERC-20 flow: `approve()`, `allowance()`, `transferFrom()`, and `transfer()`.

## Tech Stack

- Web dashboard: Next.js, TypeScript, Tailwind CSS
- Mobile app: Expo / React Native, TypeScript
- Smart contracts: Solidity, Hardhat
- Database: PostgreSQL or Supabase
- Wallets: MetaMask and WalletConnect
- Identity: facial recognition checks and government ID verification adapters
- Shared code: TypeScript types and constants in `packages/shared`

## Folder Structure

```text
remitsafe/
├── apps/
│   ├── web/              # Next.js sender, merchant, admin dashboards and API routes
│   └── mobile/           # Expo app for sender-first mobile flows
├── contracts/            # Hardhat project and Solidity contracts
├── database/             # PostgreSQL schema and seed data
├── models/               # Local AI model storage, ignored for large weights
├── packages/
│   └── shared/           # Shared constants and TypeScript types
├── docs/                 # Architecture, contract flow, schema, demo guide
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Major Folders

`apps/web` contains the browser dashboard for senders, merchants, and admins. It also includes API route folders for auth, pledge actions, face verification, and ID verification.

`apps/mobile` contains the Expo app for mobile onboarding, pledge tracking, and wallet-driven sender flows.

`contracts` is a standalone Hardhat workspace for the multi-asset pledge contract, mock USDC/USDT contracts, deployment scripts, and tests.

`database` stores SQL that can be run locally in PostgreSQL or copied into Supabase SQL editor.

`models/face-recognition` stores local InsightFace model files for server-side facial verification. Model weights are ignored by git so the repo stays lightweight.

`packages/shared` keeps common asset constants, chain constants, and shared TypeScript models so the web and mobile apps do not drift.

`docs` gives judges a fast review path: architecture, smart contract flow, database schema, and a demo script.

## Why This Structure Works

This monorepo is intentionally small. Each major surface has one obvious home, and the shared package prevents duplicated asset and pledge definitions. A 3-4 person team can divide work cleanly: one person on contracts, one on web, one on mobile, and one across identity/database/demo polish.

For code review, judges can start at the root README, inspect the contract and tests in `contracts`, review app routes in `apps/web/src/app`, then confirm data design in `database/schema.sql` and `docs/database-schema.md`.

## Environment Variables

Copy `.env.example` to `.env.local` for local app development and to `.env` inside `contracts` for contract deployment.

```bash
cp .env.example .env.local
```

Important variables:

- `DATABASE_URL`: PostgreSQL or Supabase connection string
- `NEXT_PUBLIC_CHAIN_ID`: target chain id
- `NEXT_PUBLIC_REMITSAFE_CONTRACT_ADDRESS`: deployed pledge contract address
- `NEXT_PUBLIC_USDC_ADDRESS`: USDC token address
- `NEXT_PUBLIC_USDT_ADDRESS`: USDT token address
- `PRIVATE_KEY`: deployer private key for Hardhat
- `RPC_URL`: chain RPC URL
- `FACE_PROVIDER_API_KEY`: facial verification provider key
- `IDV_PROVIDER_API_KEY`: government ID verification provider key
- `FACE_MODEL_DIR`: local folder for server-side InsightFace models

## Installation Guide

Install dependencies from the root:

```bash
npm install
```

Then install each app workspace if needed:

```bash
npm install --workspace apps/web
npm install --workspace apps/mobile
npm install --workspace contracts
```

## How To Run The Web App

```bash
npm run dev:web
```

The web dashboard runs on `http://localhost:3000`.

## How To Run The Mobile App

```bash
npm run dev:mobile
```

Use Expo Go or an emulator to open the mobile app.

## How To Run Smart Contract Tests

```bash
npm run test:contracts
```

## How To Deploy Contracts

Set `RPC_URL` and `PRIVATE_KEY`, then run:

```bash
npm run deploy:contracts
```

After deployment, copy the contract and token addresses into `.env.local`.

## Supported Assets

- ETH: native coin, pledged through payable functions
- USDC: ERC-20 token, pledged through approval and transfer flow
- USDT: ERC-20 token, pledged through approval and transfer flow

## Demo Accounts Or Test Wallets

Use local Hardhat accounts for development:

- Sender: first Hardhat account
- Merchant: second Hardhat account
- Admin: deployer account

For testnets, create separate wallets with no mainnet funds and fund them only from a faucet.

## Known Limitations

- Facial recognition and ID verification are adapter stubs until a provider is selected.
- Reputation scoring uses a simple starting model for demo purposes.
- Mock USDC and USDT are for local testing only.
- Admin dispute handling is documented but intentionally minimal for hackathon scope.
