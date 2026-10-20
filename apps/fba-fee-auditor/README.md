# FBA Fee Auditor

Finds where Amazon overcharges your FBA fulfilment fees because it **mis-measured
your product** into a higher size tier than your real box warrants.

## How it works

```
Product Library (Supabase) ──real dims/weight──┐
                                               ▼
seller-central-api ──GET_FBA_ESTIMATED_FBA_FEES──►  auditCatalog()  ──►  ranked overcharges
  Amazon's measured dims, tier, charged fee          (@platform/calc)      with $ recoverable
```

1. **Amazon's side** — pulled via `seller-central-api` from the
   `GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA` report: the dimensions Amazon *measured*,
   the size tier they assigned, and the fee they actually charge per unit.
2. **Your side** — your real box measurements, read **read-only** from the
   Product Library (the `supply-chain-app` Supabase project): the customer-facing
   `unit` row in `packaging_specs`, joined to `products` by SKU. Dimensions are
   already metric (cm / kg). Reads use the project's service_role key because the
   tables are RLS-gated to authenticated roles.
3. **Compare** — the shared `@platform/calc` fee engine recomputes the *correct*
   size tier and fee from your real dims. Any SKU where Amazon's tier/fee is
   higher than reality is flagged, ranked by recoverable dollars.

The comparison logic lives in `@platform/calc/feeAudit` (pure + unit-tested);
this app only handles I/O and the dashboard.

## Run

```bash
cp .env.example .env.local   # fill in the two connections
pnpm --filter @platform/fba-fee-auditor dev   # http://localhost:3002
```

No connections yet? Click **Run demo audit** — it audits a built-in sample
catalogue so you can see the output immediately.

## Scope

v1 is **read-only**: it audits and flags overcharges. Generating/submitting
reimbursement cases is a later phase (the `fba-reconciliation` app is the
natural home for that).
