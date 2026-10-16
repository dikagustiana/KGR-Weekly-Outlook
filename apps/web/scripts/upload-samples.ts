/**
 * Writes fixtures/upload-samples/{po,wp,yield}_sample.xlsx and samples.json from lib/v5/upload-samples.ts (the mockup
 * examples, PRD §9.2). Run once from apps/web: `pnpm exec tsx scripts/upload-samples.ts`. The .xlsx bytes carry a
 * timestamp, so the files are committed and not rewritten by tests; expected.json is checked by lib/v5/upload-samples.test.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { UPLOAD_SAMPLES } from "../lib/v5/upload-samples";

const dir = join(__dirname, "../../../fixtures/upload-samples");
mkdirSync(dir, { recursive: true });
for (const [kind, s] of Object.entries(UPLOAD_SAMPLES)) {
  if (!s) continue;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.grid), "data");
  writeFileSync(join(dir, s.file), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
  console.log(`${kind}: ${s.file} · ${s.grid.length - 1} baris`);
}
writeFileSync(join(dir, "samples.json"), JSON.stringify(UPLOAD_SAMPLES, null, 1) + "\n");
