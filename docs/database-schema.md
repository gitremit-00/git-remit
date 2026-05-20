# Database Schema

The database keeps off-chain records that are useful for onboarding, dashboards, and judging the demo.

## Core Tables

- `users`: sender, merchant, and admin accounts with wallet address, KYC flags, and reputation score
- `merchants`: merchant profile and payout wallet
- `pledges`: pledge metadata linked to the on-chain pledge id
- `reputation_events`: point changes caused by successful payments, late completions, cancellations, or disputes

The SQL source lives in `database/schema.sql`.
