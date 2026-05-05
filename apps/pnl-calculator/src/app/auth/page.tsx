import { Suspense } from "react";
import AuthPage from "@/components/AuthPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AuthPage />
    </Suspense>
  );
}
