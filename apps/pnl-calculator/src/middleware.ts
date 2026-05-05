import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@platform/supabase-client/middleware";

export async function middleware(request: NextRequest) {
  return updateSupabaseSession(request);
}

// Run on all routes except static assets, image optimizer, and the Next.js
// internal endpoints. The Supabase docs explicitly recommend this matcher.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|placeholder\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
