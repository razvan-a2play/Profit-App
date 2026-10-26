/**
 * A2 Play brand tokens — the SplashEZ look shared by every internal app.
 * Design canvas: https://claude.ai/artifact/B5PviM2Yu1pRG3V26284dz
 *
 * This file is the source of truth for hex values. tokens.css carries the
 * same colours as HSL CSS variables for the shadcn components in @platform/ui;
 * change both together.
 */
const colors = {
  splash: {
    100: "#E3F2FB", // selected rows, icon chips, soft fills
    400: "#2FA6E0", // logo blue: charts and decoration, never text on white
    600: "#0F6FAE", // primary: buttons, links, actual-value lines
    700: "#0B5E96", // hover, pressed
  },
  sun: "#FFC23D", // one highlight per screen, never text
  deep: {
    DEFAULT: "#0E2A47", // body text, sidebar
    raised: "#1B3D61", // active item on the sidebar
    soft: "#D6E3EE", // sidebar text
  },
  ink: {
    DEFAULT: "#0E2A47",
    muted: "#4A6178", // secondary text, 6:1 on white
  },
  ground: "#F4F8FB", // page background
  surface: "#FFFFFF", // cards
  line: {
    DEFAULT: "#D9E4EE", // card borders, dividers
    strong: "#C5D5E3", // input and secondary-button borders
    faint: "#EEF2F6", // table row dividers, neutral badge fill
  },
  ok: { DEFAULT: "#1E6B45", bg: "#E4F4EC" },
  watch: { DEFAULT: "#7A4F00", bg: "#FFF3D6", line: "#C98A00" },
  problem: { DEFAULT: "#A8231B", bg: "#FDE7E5" },
};

const fonts = {
  display: ['"Baloo 2"', "ui-rounded", "system-ui", "sans-serif"], // titles only
  sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
};

const radius = {
  control: "8px", // buttons, inputs
  card: "14px",
  tile: "22px", // app tiles, sign-in card
};

/** Google Fonts stylesheet for the two families; add it as a <link> in each app's <head>. */
const fontsHref =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap";

module.exports = { colors, fonts, radius, fontsHref };
