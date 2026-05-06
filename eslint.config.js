import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";

export default ts.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "backend/**"] },
  {
    extends: [js.configs.recommended, ...ts.configs.recommended],
    files: ["frontend/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // TypeScript handles unused-vars via tsconfig strict flags
      "@typescript-eslint/no-unused-vars": "off",
      // Allow explicit any in a few cases (PixiJS / AlphaTab interop)
      "@typescript-eslint/no-explicit-any": "warn",
      // Empty catch blocks are intentional in WebMidi / PixiJS teardown paths
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Control-character regexes are intentional input sanitization
      "no-control-regex": "off",
    },
  },
  prettierConfig
);
