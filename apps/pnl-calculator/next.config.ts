import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@platform/calc",
    "@platform/db-types",
    "@platform/supabase-client",
    "@platform/ui",
  ],
  typedRoutes: false,
};

export default config;
