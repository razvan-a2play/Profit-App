// The seller-central-api gateway is the only thing in this package that talks
// to Amazon. Each app supplies its own address and key, so nothing here reads
// the environment.

export interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
}

export type Gateway = (path: string, init?: RequestInit) => Promise<any>;

// Report generation can take a couple of minutes; nothing here waits longer,
// because the fee scan now answers immediately and finishes in the background.
const SLOW_CALL_MS = 4 * 60 * 1000;

export function createGateway(cfg: GatewayConfig): Gateway {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  return async (path, init) => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { "X-API-Key": cfg.apiKey, ...(init?.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(SLOW_CALL_MS),
      });
    } catch (e) {
      // Node reports a refused connection as a bare "fetch failed", which tells
      // nobody anything. The usual cause is simply that the gateway isn't
      // running, so say that and say where it should be.
      const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "could not be reached";
      throw new Error(
        `The seller-central-api gateway at ${baseUrl} ${why}. ` +
          `Start it (python run_dev.py in seller-central-api) and try again.`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`seller-central-api ${path} → ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  };
}
