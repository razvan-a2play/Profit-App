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
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setCheckingAuth(false);
    });

    return () => subscription.unsubscribe();
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
