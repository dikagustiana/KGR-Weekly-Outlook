import { defineConfig } from "vitest/config";
import base from "../vitest.config";

/** Evidence harnesses (scripts/*.test.tsx): `npx vitest run -c scripts/vitest.harness.config.ts`. Not part of `pnpm test`. */
export default defineConfig({ ...base, test: { ...base.test, include: ["scripts/**/*.test.tsx"] } });
