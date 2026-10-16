/**
 * Writes fixtures/pl-2026-08/golden.json (PRD v5 §9.2, Lampiran B.2) from test/pl-golden.ts.
 * Run: pnpm --filter @kgr/engine exec tsx scripts/pl-golden.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plGolden } from "../test/pl-golden";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/pl-2026-08");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "golden.json"), JSON.stringify(plGolden(), null, 1) + "\n");
console.log("fixtures/pl-2026-08/golden.json");
