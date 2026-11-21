/**
 * Browser half of the Product Library read: calls /api/library-products with
 * the signed-in user's token. One request is shared by every caller for a
 * minute (each calculator card and the dashboard ask for the list).
 */
import { supabase } from "@/lib/supabase";
import type { LibraryLoad } from "@/lib/product-library";

const TTL_MS = 60_000;
let cached: { at: number; promise: Promise<LibraryLoad> } | null = null;

async function request(): Promise<LibraryLoad> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { state: "error", message: "Not signed in." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch("/api/library-products", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as LibraryLoad | null;
    if (!body) return { state: "error", message: `The server answered ${res.status}.` };
    return body;
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return {
      state: "error",
      message: aborted
        ? "The Product Library didn't answer within 20 seconds."
        : e instanceof Error
          ? e.message
          : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function fetchLibraryProducts(): Promise<LibraryLoad> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = request().then((r) => {
    // Don't keep a failure: the next caller tries again.
    if (r.state === "error") cached = null;
    return r;
  });
  cached = { at: Date.now(), promise };
  return promise;
}
