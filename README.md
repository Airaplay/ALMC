# Airaplay Label & Management Console (ALMC)

Primary web app for record labels, management companies, distributors, and entertainment organizations to manage artist rosters on Airaplay.

**Live:** [almc-orcin.vercel.app](https://almc-orcin.vercel.app)

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Environment

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_ALMC_ROUTE_BASE` | Route prefix (empty for standalone) |
| `VITE_AIRAPLAY_CONSUMER_URL` | Listener app URL for artist profile links |

## Deploy (Vercel)

Connect this repo; `vercel.json` sets build and SPA routing. Add Supabase env vars in Vercel project settings.

## Database

Apply `supabase/migrations/20260714140000_almc_organization_console_phase1.sql` to your Supabase project.

## Sync from Airaplay-DB-V2

```bash
node scripts/sync-almc-repo.mjs   # run from Airaplay-DB-V2 monorepo
```
