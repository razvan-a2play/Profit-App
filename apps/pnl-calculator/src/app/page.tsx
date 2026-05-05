import RequireAuth from "@/components/auth/RequireAuth";
import IndexPage from "@/components/IndexPage";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function HomePage() {
  return (
    <ErrorBoundary>
      <RequireAuth>
        <IndexPage />
      </RequireAuth>
    </ErrorBoundary>
  );
}
