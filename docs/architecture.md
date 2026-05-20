# Architecture

RemitSafe is split into four reviewable layers:

1. Web and mobile clients collect user intent, wallet signatures, identity checks, and pledge actions.
2. API routes coordinate authentication, identity provider callbacks, and database writes.
3. Smart contracts custody locked ETH, USDC, or USDT until pledges are fully funded and released.
4. PostgreSQL or Supabase stores user profiles, merchant records, pledge metadata, reputation events, and audit-friendly status history.

The blockchain is the source of truth for locked funds. The database is the source of truth for off-chain identity, dashboard views, reputation scores, and demo metadata.

## Face Verification Architecture

RemitSafe keeps face recognition server-side so low-spec phones stay fast and usable.

```text
Mobile/web camera capture
        ↓
User guidance and basic image quality checks
        ↓
API upload to server
        ↓
InsightFace model runs on backend
        ↓
Verified / retry response
```

Recommended model storage lives in `models/face-recognition`. The default backend recommendation is InsightFace `buffalo_l` for accuracy. If the server machine is weak, use `buffalo_s` for a faster demo.

## Team Ownership

- Web: sender, merchant, and admin dashboards in `apps/web`
- Mobile: onboarding and pledge status in `apps/mobile`
- Contracts: pledge custody and release flow in `contracts`
- Platform: database, docs, identity provider adapters, and demo flow
