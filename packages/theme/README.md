# @platform/theme

The A2 Play look for every internal app: SplashEZ blues, Baloo 2 for titles, Inter for everything else.
Design canvas: https://claude.ai/artifact/B5PviM2Yu1pRG3V26284dz

| File | What it is |
| --- | --- |
| `tokens.cjs` | Hex colours, font stacks, radii. Source of truth. |
| `tokens.css` | The same colours as CSS variables, including the shadcn ones `@platform/ui` reads. |
| `tailwind.preset.cjs` | `splash-600`, `ink-muted`, `ground`, `line`, `ok` / `watch` / `problem`, `font-display`, `rounded-card` ... |
| `assets/splashez-logo.png` | The logo, transparent background. |

## Use it in a Next app here

```ts
// tailwind.config.ts
import configPreset from "@platform/config/tailwind.preset.cjs";
import themePreset from "@platform/theme/tailwind.preset.cjs";
export default { presets: [configPreset, themePreset], content: [...] };
```

```ts
// app/layout.tsx, after ./globals.css
import "@platform/theme/tokens.css";
```

Add the fonts `<link>` (`fontsHref` in `tokens.cjs`) to the `<head>`.

## Use it outside the monorepo

Apps in their own repo (the app hub) keep a copy in `src/theme/` and refresh it with their
`sync-theme` script. Change the tokens here, then run that script in each of those apps.

## Rules that matter

- Baloo 2 for page and section titles only. Numbers are Inter with `tabular-nums`.
- Splash 600 for actions and links. Splash 400 is decoration and charts, never text on white.
- Sun is one highlight per screen, never text.
- Status colour only where someone needs to act; everything else stays blue or grey.
- Cards: white, 1px `line` border, no shadow. Only menus and dialogs float.
