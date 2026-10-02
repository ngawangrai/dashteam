import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Runs against the local Supabase stack (`pnpm db:start`), never a hosted project.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
