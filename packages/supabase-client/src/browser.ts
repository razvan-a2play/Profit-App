import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@platform/db-types";

let _client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env var"
    );
  }
  _client = createBrowserClient<Database>(url, key);
  return _client;
}
