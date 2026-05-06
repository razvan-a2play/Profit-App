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
  // Use implicit flow so admin-initiated magic links + password-recovery
  // emails (sent from Supabase Studio) work. PKCE — the default — requires a
  // code_verifier stored in the same browser that originated the auth
  // request, which doesn't exist when an admin clicks "Send magic link" on
  // behalf of another user. Implicit puts the access_token in the URL hash
  // and is detected client-side without a verifier.
  // detectSessionInUrl: false — the auto-detect was racing with component
  // mount and silently failing in production. AuthPage parses the URL
  // explicitly and calls setSession, which is more reliable.
  _client = createBrowserClient<Database>(url, key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return _client;
}
