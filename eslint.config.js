import globals from "globals";
import pluginJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";

export default [
  pluginJs.configs.recommended,
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/quotes": ["error", "double"],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/no-multiple-empty-lines": ["error", { "max": 2, "maxEOF": 0 }],
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    },
    languageOptions: { globals: globals.node }
  },
];
