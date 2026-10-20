// Centralised, server-only env access. Every value is read lazily so the app
// boots (and the UI renders a helpful "not configured" state) even before the
// connections are filled in.

export interface SellerCentralConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ProductLibraryConfig {
  url: string;
  key: string;
  /** packaging_specs.spec_type identifying the customer-facing unit package. */
  unitSpecType: string;
  /** Prefer an "approved" packaging spec over draft/in_review when both exist. */
  preferApproved: boolean;
  /** Base URL of the supply-chain-app UI, for deep links to a product's specs. */
  appUrl: string | null;
}

export function getSellerCentralConfig(): SellerCentralConfig | null {
  const baseUrl = process.env.SELLER_CENTRAL_API_URL;
  const apiKey = process.env.SELLER_CENTRAL_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function getProductLibraryConfig(): ProductLibraryConfig | null {
  const url = process.env.PRODUCT_LIBRARY_SUPABASE_URL;
  const key = process.env.PRODUCT_LIBRARY_SUPABASE_KEY;
  if (!url || !key) return null;
  return {
    url,
    key,
    unitSpecType: process.env.PRODUCT_LIBRARY_UNIT_SPEC_TYPE || "unit",
    preferApproved: process.env.PRODUCT_LIBRARY_PREFER_APPROVED !== "false",
    appUrl: (process.env.PRODUCT_LIBRARY_APP_URL || "http://localhost:8080").replace(/\/+$/, ""),
  };
}
