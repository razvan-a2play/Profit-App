# Platform monorepo

pnpm workspaces + Turborepo. Houses multiple apps that share calc logic, UI, and Supabase types.

## Structure

```
apps/
  pnl-calculator/      Sales Channel P&L Calculator (Next.js)
packages/
  calc/                Pure calc functions (FBA, MCF, 3PL, CBM, dim weight, fees)
  ui/                  Shared shadcn primitives + cross-app components
  db-types/            Generated Supabase types
  supabase-client/     Browser + server Supabase client setup
  config/              Shared eslint, tsconfig base, tailwind preset
```

## Local development

Requires Node 20+ and pnpm 10+.

```sh
pnpm install                                       # install everything
pnpm --filter @platform/pnl-calculator dev         # run the calculator on :3001
pnpm --filter @platform/calc test                  # run the calc test suite
pnpm typecheck                                     # typecheck all packages via Turbo
```

Copy `apps/pnl-calculator/.env.local.example` to `.env.local` and fill in the Supabase URL + anon key.

## Adding a new app

1. `mkdir apps/<name>` and add a `package.json` named `@platform/<name>`.
2. Add workspace deps: `"@platform/calc": "workspace:*"` etc.
3. `pnpm install` from the repo root.

## Deployment (Railway)

Each app deploys as its own Railway service from this repo. Build/start commands at the
**monorepo root** are encoded in [`railway.json`](./railway.json):

```json
{
  "build":  { "buildCommand":  "pnpm install --frozen-lockfile && pnpm --filter @platform/pnl-calculator build" },
  "deploy": { "startCommand":  "pnpm --filter @platform/pnl-calculator start" }
}
```

### Setting up a new Railway service for `pnl-calculator`

1. **Connect** Railway to GitHub, pick this repo.
2. **Root Directory**: leave blank (use the monorepo root so pnpm workspace deps resolve).
3. **Variables** (Service → Variables):
   - `NEXT_PUBLIC_SUPABASE_URL` — the project URL (`https://<id>.supabase.co`).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the publishable anon key from Supabase Project Settings → API.
4. **Networking → Generate Domain** to get a `*.up.railway.app` URL.
5. Push to `main` to trigger a deploy. `railway.json` handles the rest.

### Adding teammates

This app uses Supabase Auth + an email allowlist (`allowlist_emails` table). To grant a new
user access, insert their email into that table from Supabase Studio. They sign up at the
deployed URL and will land directly in the calculator.

## Tests

```sh
pnpm --filter @platform/calc test
```

29 Vitest cases cover the FBA fee schedule, FBT bracket transitions, SIPP eligibility/discount,
referral fee bracketing, and return processing fee logic.
