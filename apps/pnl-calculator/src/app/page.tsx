import RequireAuth from "@/components/auth/RequireAuth";
import IndexPage from "@/components/IndexPage";
import ErrorBoundary from "@/components/ErrorBoundary";

// Skip static prerendering. The page is auth-gated and the supabase browser
// client throws server-side during static export — there's nothing to cache
// statically anyway since RequireAuth's auth check runs purely client-side.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <ErrorBoundary>
      <RequireAuth>
        <IndexPage />
      </RequireAuth>
    </ErrorBoundary>
  );
}
