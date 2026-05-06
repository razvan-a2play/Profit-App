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

  useEffect(() => {
    let resolved = false;

    // If the URL contains a Supabase auth hash (magic link / recovery / signup
    // confirmation), do NOT redirect to /auth before Supabase has a chance to
    // process it — that would drop the hash mid-flight. Wait for the client's
    // INITIAL_SESSION event, which fires once URL processing is done.
    const hasAuthHash =
      typeof window !== "undefined" &&
      /access_token=|refresh_token=|type=(magiclink|recovery|signup|invite)/.test(
        window.location.hash
      );

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "INITIAL_SESSION") {
        resolved = true;
        setCheckingAuth(false);
        // Strip the auth fragment now that we've consumed it so a refresh
        // doesn't re-trigger the flow.
        if (
          hasAuthHash &&
          typeof window !== "undefined" &&
          window.location.hash
        ) {
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname + window.location.search
          );
        }
      }
    });

    // Belt-and-suspenders fallback: if INITIAL_SESSION never arrives (older
    // supabase versions, weird timing), fall back to a direct getSession.
    const fallback = setTimeout(() => {
      if (resolved) return;
      supabase.auth.getSession().then(({ data: { session: current } }) => {
        if (resolved) return;
        resolved = true;
        setSession(current);
        setCheckingAuth(false);
      });
    }, 1500);

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
