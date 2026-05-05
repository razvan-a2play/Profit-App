import type { Config } from "tailwindcss";
import preset from "@platform/config/tailwind.preset.cjs";

const config: Config = {
  presets: [preset],
  content: [
    "./src/**/*.{ts,tsx,mdx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
