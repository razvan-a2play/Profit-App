"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@platform/ui";
import type { Session } from "@supabase/supabase-js";

type AllowlistState =
  | { kind: "idle" }       // no session yet → don't check
  | { kind: "loading" }    // RPC in flight
  | { kind: "allowed" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);

  // True while we believe the URL is mid-auth (magic link / recovery / etc.)
  // Used for the loading UI so the user doesn't see a flash of "Sign In".
  const [authCallbackInFlight, setAuthCallbackInFlight] = useState(false);

  useEffect(() => {
    let resolved = false;

    // Detect any Supabase auth callback markers in the URL — both hash-based
    // (implicit flow: #access_token=...) and query-based (PKCE: ?code=...).
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hasAuthCallback =
      /access_token=|refresh_token=|type=(magiclink|recovery|signup|invite)|error=/.test(hash) ||
      /[?&](code|token_hash|error|error_description)=/.test(search);

    if (hasAuthCallback) setAuthCallbackInFlight(true);

    // If the URL has ?code=..., explicitly exchange it. Supabase's admin-sent
    // magic links can use PKCE format even when the browser client is
    // configured for implicit flow.
    if (typeof window !== "undefined") {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        supabase.auth.exchangeCodeForSession(code).catch(() => {
          // If exchange fails (e.g., no verifier stored), fall through —
          // INITIAL_SESSION will still fire with a null session and we'll
          // surface the sign-in page.
        });
      }
    }

    const stripAuthParams = () => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      let changed = false;
      ["code", "token_hash", "error", "error_description", "error_code", "type"].forEach((p) => {
        if (url.searchParams.has(p)) {
          url.searchParams.delete(p);
          changed = true;
        }
      });
      if (url.hash) {
        url.hash = "";
        changed = true;
      }
      if (changed) window.history.replaceState({}, document.title, url.toString());
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      // INITIAL_SESSION fires once after URL processing is complete (the
      // canonical "we know if you're signed in" event). SIGNED_IN can fire
      // later if exchangeCodeForSession completes.
      if (event === "INITIAL_SESSION" || (event === "SIGNED_IN" && hasAuthCallback)) {
        if (!resolved) {
          resolved = true;
          setCheckingAuth(false);
        }
        if (hasAuthCallback) {
          setAuthCallbackInFlight(false);
          stripAuthParams();
        }
      }
    });

    // Belt-and-suspenders fallback: if INITIAL_SESSION never arrives, fall
    // back to a direct getSession so we don't hang indefinitely.
    const fallback = setTimeout(() => {
      if (resolved) return;
      supabase.auth.getSession().then(({ data: { session: current } }) => {
        if (resolved) return;
        resolved = true;
        setSession(current);
        setCheckingAuth(false);
        setAuthCallbackInFlight(false);
      });
    }, 2500);

    return () => {
      clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  // Run the allowlist check whenever we have a session
  useEffect(() => {
    if (!session) {
      setAllowlist({ kind: "idle" });
      return;
    }
    setAllowlist({ kind: "loading" });
    let cancelled = false;
    // Defer to avoid potential deadlock inside the auth callback.
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("is_allowlisted_user");
        if (cancelled) return;
        if (error) {
          setAllowlist({ kind: "error", message: error.message ?? "Allowlist check failed" });
        } else {
          setAllowlist({ kind: data === true ? "allowed" : "denied" });
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Allowlist check failed";
        setAllowlist({ kind: "error", message });
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [session, retryNonce]);

  // Redirects: not authenticated → /auth, authenticated but denied → sign out + /auth
  useEffect(() => {
    if (checkingAuth) return;
    if (!session) {
      const target = `/auth?from=${encodeURIComponent(pathname || "/")}`;
      router.replace(target);
      return;
    }
    if (allowlist.kind === "denied") {
      supabase.auth.signOut({ scope: "global" }).catch(() => {});
      router.replace(`/auth?reason=not_allowlisted`);
    }
  }, [checkingAuth, session, allowlist.kind, pathname, router]);

  if (checkingAuth && authCallbackInFlight) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center space-y-2">
          <div className="text-sm font-medium">Signing you in…</div>
          <div className="text-xs text-muted-foreground">Verifying your magic link.</div>
        </div>
      </main>
    );
  }

  if (checkingAuth || (session && allowlist.kind === "loading")) {
    return null;
  }

  if (session && allowlist.kind === "error") {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Couldn't verify your access</h1>
          <p className="text-sm text-muted-foreground">
            {allowlist.message}
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <Button onClick={() => setRetryNonce((n) => n + 1)}>
              Retry
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await supabase.auth.signOut({ scope: "global" }).catch(() => {});
                router.replace("/auth");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Not signed in or denied → render nothing while the redirect effect runs
  if (!session || allowlist.kind !== "allowed") return null;

  return <>{children}</>;
};

export default RequireAuth;
