import { defineConfig } from "vitest/config";

// The dashboard is Next.js; these tests cover the plain TypeScript libraries (DKIM canonicalizer, relay).
export default defineConfig({
  test: { environment: "node", include: ["src/lib/**/*.test.ts", "worker/src/**/*.test.ts"] },
});
