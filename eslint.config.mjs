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
    rules: {
      // The React Compiler's set-state-in-effect rule is too strict for this
      // app's legitimate patterns: SSR-safe hydration (navigator.onLine,
      // localStorage cache restore that must run client-side only) and
      // reset-on-dependency-change effects (clearing stale per-day / per-meal
      // state). Converting these to lazy initial state would cause hydration
      // mismatches. Keep it as a warning so real cascading-render bugs still
      // surface without failing the lint on the intentional cases.
      "react-hooks/set-state-in-effect": "warn",
      // The React Compiler can't auto-optimize memos that call cross-module
      // functions it can't prove pure (e.g. the TDEE Kalman model memo). When
      // that happens it simply falls back to the hand-written useMemo, which
      // works exactly as intended — so this is advisory, not a real failure.
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
