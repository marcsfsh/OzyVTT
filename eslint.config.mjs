import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "data/**",
      "packages/content-srd-5.2.1/bundles/**",
      "e2e/test-results/**",
      "e2e/playwright-report/**",
      // The Light rail handoff's mockup: script fragments that build.sh stitches into one page.
      "docs/design/light-rail/**",
      // The polish handoff's mockups, kept as written.
      "docs/design/polish/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Sanitizers strip control characters on purpose.
      "no-control-regex": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" }
  },
  {
    files: ["apps/client/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" }
  }
);
