# Airaplay Label & Management Console (ALMC)

Phase 1 MVP for organization accounts (labels, management, distributors, entertainment).

## Contents

- `src/console/` - Console UI
- `src/lib/orgAccess.ts` - Supabase RPC client
- `src/lib/orgUploadContext.ts` - Delegated upload helpers
- `supabase/migrations/` - Organization schema and RPCs
- `integration/` - Airaplay-DB-V2 route wiring reference

## Routes

- `/console/login`
- `/console/onboarding`
- `/console`
- `/console/accept-artist?token=...`
- `/console/accept-team?token=...`

Integrate into [Airaplay-DB-V2](https://github.com/Airaplay/Airaplay-DB-V2) web build (`VITE_APP_TARGET=web`).
