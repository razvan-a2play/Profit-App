-- Mirror of Helium10 Profits' configured COGS per SKU for the US marketplace.
-- Populated by the Helium10 Profits MCP (list_amazon_cogs). Dashboard reads
-- this to show Helium10's "landed cost" number alongside the calculator's
-- own manufacturing cost.
--
-- One row per SKU (the current effective row — we don't keep history here;
-- re-syncs upsert). If an SKU has multiple by-period rows in Helium10, the
-- sync picks the currently-effective one.

create table if not exists public.helium10_cogs (
  sku             text primary key,
  asin            text,
  seller_id       text,
  marketplace     text,
  product_name    text,
  brand           text,
  fulfillment_type text,
  sku_status      text,
  cogs_id         text,
  cogs_type       text,
  currency        text,
  product_cost    numeric(10,4),
  shipping_cost   numeric(10,4),
  tariffs         numeric(10,4),
  total_cogs      numeric(10,4),
  starts_at       date,
  ends_at         date,
  fetched_at      timestamptz not null default now()
);

create index if not exists helium10_cogs_asin_idx on public.helium10_cogs (asin);

alter table public.helium10_cogs enable row level security;

drop policy if exists "helium10_cogs read for allowlisted users" on public.helium10_cogs;
create policy "helium10_cogs read for allowlisted users"
  on public.helium10_cogs
  for select
  to authenticated
  using (public.is_allowlisted_user());

-- Service-role writes only (sync job uses service_role; the app never writes).
