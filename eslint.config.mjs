import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import docusaurusPlugin from "@docusaurus/eslint-plugin";
import { importX } from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import promisePlugin from "eslint-plugin-promise";
import securityPlugin from "eslint-plugin-security";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

const reactConfig = eslintReact.configs["recommended-typescript"];

/** @type {import('eslint').Linter.FlatConfig[]} */
const eslintConfig = [
  // Legacy directory: ignored entirely.
  {
    ignores: [
      "legacy/**",
      "spike/**",
      "node_modules/**",
      ".docusaurus/**",
      "build/**",
      "coverage/**",
    ],
  },

  // Global configurations for all files
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...prettierConfig.rules,
      "prettier/prettier": "warn",
    },
  },

  // Docusaurus configurations (src/ only)
  {
    files: ["src/**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: {
      ...reactConfig.plugins,
      "@docusaurus": docusaurusPlugin,
    },
    settings: reactConfig.settings,
    rules: {
      ...reactConfig.rules,
      ...docusaurusPlugin.configs.recommended.rules,
      "@docusaurus/no-untranslated-text": [
        "warn",
        { ignoredStrings: ["·", "—", "×"] },
      ],
    },
  },

  // TypeScript configurations
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Pipeline scripts get import/promise/security rules
  {
    files: ["scripts/**/*.{js,mjs,cjs,ts}"],
    plugins: {
      "import-x": importX,
      promise: promisePlugin,
      security: securityPlugin,
    },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      ...importX.flatConfigs.recommended.rules,
      ...promisePlugin.configs.recommended.rules,
      ...securityPlugin.configs.recommended.rules,
      // Pipeline tooling intentionally uses dynamic file paths
      "security/detect-non-literal-fs-filename": "off",
    },
  },
];

export default eslintConfig;
