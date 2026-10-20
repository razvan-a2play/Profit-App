import type { NextConfig } from "next";
import path from "node:path";

// Lock the workspace root explicitly. Without this, Next.js walks up from CWD
// and can pick C:\Claude if a stray package-lock.json appears there, which
// breaks .env.local discovery and static-asset paths.
const workspaceRoot = path.resolve(__dirname, "..", "..");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@platform/supply-chain-data", "@platform/ui"],
  typedRoutes: false,
  outputFileTracingRoot: workspaceRoot,
};

export default config;
