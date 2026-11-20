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
  // Supabase can go quiet for minutes at a time; after a few seconds of
  // waiting, say so instead of showing a blank page.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);

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

    // Explicitly handle Supabase auth callbacks. We do this rather than
    // relying on detectSessionInUrl because that has been racing with mount.
    if (typeof window !== "undefined") {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).catch(() => {});
      } else {
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          supabase.auth.exchangeCodeForSession(code).catch(() => {});
        }
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
        // A request to a stalled Supabase never settles on its own; give up
        // after 20 s so the user gets the Retry screen, not an endless wait.
        const { data, error } = await Promise.race([
          supabase.rpc("is_allowlisted_user"),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "The database (Supabase) didn't answer within 20 seconds. It usually comes back within a few minutes.",
                  ),
                ),
              20000,
            ),
          ),
        ]);
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
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="max-w-sm text-center space-y-3">
          <div className="text-sm font-medium">
            {slow ? "Still connecting to the database…" : "Loading…"}
          </div>
          {slow && (
            <>
              <p className="text-xs text-muted-foreground">
                The calculator&apos;s data lives in Supabase, which isn&apos;t answering yet. This
                usually clears within a few minutes.
              </p>
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </>
          )}
        </div>
      </main>
    );
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
