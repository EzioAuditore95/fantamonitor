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
