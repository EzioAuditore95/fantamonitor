import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Navigation between the glass routes deliberately reloads the page. The tab
    // bridge restores a tab by reading `window.location.search` and clicking the
    // trigger, and the countdown portals into a host that only the dashboard
    // renders; a client-side transition would skip both.
    files: ["app/**/*.tsx"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // The connector is a standalone Node service with its own package.json and
    // deployment. The Next-specific rules of this config do not describe it.
    files: ["connector/**/*.mjs"],
    rules: {
      "@next/next/no-assign-module-variable": "off",
    },
  },
  {
    // `const {id, revision, ...body} = x` is how this codebase drops keys: the named
    // bindings are meant to be unused, the rest is the point. That is exactly what
    // `ignoreRestSiblings` describes; without it the rule asks for worse code.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  {
    // Crests, kits and player faces are small avatars served from Fantacalcio's own CDN, on a private
    // dashboard with a handful of users. `next/image` would need `remotePatterns` for a
    // host we do not control and would route every thumbnail through the paid optimizer,
    // which the rule's own message warns about. The trade does not pay here.
    files: ["app/crest.tsx", "app/team-detail.tsx", "app/fantasy-pitch.tsx", "app/l/**/players/players-view.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
