import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// "@/…" as in tsconfig paths; JSX for the component render tests
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts", "components/**/*.test.tsx"] },
});
