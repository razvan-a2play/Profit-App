// Where A2 Play's AWD inventory goes and which Amazon rate tier applies. The
// Fees Configuration panel sets it on every product; products saved before
// the choice existed use the default.
import type { AwdLocation, AwdRateTier, AwdSetup } from "@platform/calc";
import type { Product } from "@/types/product";

/** Owner, 2026-11-24: AWD stock ships to the West Coast Palletizable region. */
export const DEFAULT_AWD_SETUP: AwdSetup = { location: "wcp-carton", tier: "base" };

export function awdSetupOf(p: Pick<Product, "awdLocation" | "awdRateTier"> | undefined): AwdSetup {
  return {
    location: (p?.awdLocation as AwdLocation | undefined) ?? DEFAULT_AWD_SETUP.location,
    tier: (p?.awdRateTier as AwdRateTier | undefined) ?? DEFAULT_AWD_SETUP.tier,
  };
}
