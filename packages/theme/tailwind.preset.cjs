/**
 * Tailwind preset with the A2 Play brand: `bg-splash-600`, `text-ink-muted`,
 * `font-display`, `rounded-card`, `bg-problem-bg text-problem`, ...
 *
 * Next apps in this repo: list it after @platform/config's preset so the
 * shadcn semantic colours stay and these are added on top:
 *   presets: [configPreset, themePreset]
 * and import "@platform/theme/tokens.css" to repoint those semantic colours.
 */
const { colors, fonts, radius } = require("./tokens.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors,
      fontFamily: fonts,
      borderRadius: radius,
    },
  },
};
