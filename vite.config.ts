import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spec/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"]
  }
});
