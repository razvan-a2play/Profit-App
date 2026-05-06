"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@platform/ui";
import { supabase } from "@/lib/supabase";

export function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setEmail(session?.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut({ scope: "global" });
      // Belt-and-suspenders: clear any stale Supabase tokens that might be
      // hanging around in localStorage so the next visit starts cleanly.
      try {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("sb-") || key.startsWith("supabase.auth.")) {
            localStorage.removeItem(key);
          }
        });
      } catch {}
      router.replace("/auth");
    } catch {
      setSigningOut(false);
    }
  };

  if (!email) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className="text-muted-foreground hidden sm:inline truncate max-w-[180px]"
        title={email}
      >
        {email}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onSignOut}
        disabled={signingOut}
        className="text-muted-foreground hover:text-foreground"
      >
        <LogOut className="w-4 h-4 mr-1.5" />
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
