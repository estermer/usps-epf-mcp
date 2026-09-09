import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["basic"],
    include: ["tests/**/*.test.ts"],
  },
});