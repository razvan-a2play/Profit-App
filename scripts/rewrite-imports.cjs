#!/usr/bin/env node
/**
 * One-shot import rewriter for the Lovable -> Next.js port.
 * Rewrites @/-aliased and ../utils-style imports to @platform/* package boundaries,
 * and replaces Vite-only constructs with Next equivalents.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "apps", "pnl-calculator", "src");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rules = [
  // @/components/ui/<X>  ->  @platform/ui
  {
    re: /from\s+(['"])@\/components\/ui\/[^'"]+\1/g,
    rep: 'from "@platform/ui"',
  },
  // @/hooks/use-toast and use-mobile -> @platform/ui
  {
    re: /from\s+(['"])@\/hooks\/use-toast\1/g,
    rep: 'from "@platform/ui"',
  },
  {
    re: /from\s+(['"])@\/hooks\/use-mobile\1/g,
    rep: 'from "@platform/ui"',
  },
  // supabase client + types
  {
    re: /from\s+(['"])@\/integrations\/supabase\/client\1/g,
    rep: 'from "@/lib/supabase"',
  },
  {
    re: /from\s+(['"])@\/integrations\/supabase\/types\1/g,
    rep: 'from "@platform/db-types"',
  },
  // ../utils/*  ->  @platform/calc
  {
    re: /from\s+(['"])\.\.\/utils\/[^'"]+\1/g,
    rep: 'from "@platform/calc"',
  },
  // Vite env -> Next env
  {
    re: /import\.meta\.env\.DEV/g,
    rep: 'process.env.NODE_ENV !== "production"',
  },
];

const NEEDS_USE_CLIENT = (src) =>
  /(\buse(State|Effect|Memo|Callback|Ref|Reducer|Context|Layout|Sync)|useRouter|useToast|useMutation|useQuery|onClick|onChange|"use client")/i.test(
    src
  );

let changed = 0;
for (const file of walk(ROOT)) {
  let src = fs.readFileSync(file, "utf8");
  const before = src;

  for (const r of rules) src = src.replace(r.re, r.rep);

  // Add "use client" to TSX files that look interactive and don't already have it
  if (file.endsWith(".tsx") && NEEDS_USE_CLIENT(src) && !/^"use client"/m.test(src.split("\n").slice(0, 3).join("\n"))) {
    src = `"use client";\n\n` + src;
  }

  if (src !== before) {
    fs.writeFileSync(file, src);
    changed++;
  }
}

console.log(`Rewrote ${changed} files`);
