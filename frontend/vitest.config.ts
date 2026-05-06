import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@bach-to-basics/shared": resolve(__dirname, "../shared/types/index.ts"),
    },
  },
});
