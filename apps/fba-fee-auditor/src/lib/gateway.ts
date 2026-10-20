import { createGateway, type Gateway } from "@platform/supply-chain-data";
import { getSellerCentralConfig } from "./env";

export function getGateway(): Gateway {
  const cfg = getSellerCentralConfig();
  if (!cfg) throw new Error("Seller-central API not configured (SELLER_CENTRAL_API_URL / _API_KEY).");
  return createGateway(cfg);
}
