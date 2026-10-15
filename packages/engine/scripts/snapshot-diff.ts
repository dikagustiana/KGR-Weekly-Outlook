#!/usr/bin/env tsx
/** pnpm snapshot:diff — engine output of week 2026-08-24 vs the Management View v2 baseline. */
import { computeWeek } from "../src/week";
import { loadFixtureWeek } from "../src/fixtures";
import { toSnapshot } from "../src/snapshot";
import { ALLOWED_NEW_FIELDS, BASELINE, diffPaths, readBaseline, withoutAllowedFields } from "./snapshot-baseline";

const snap = toSnapshot(computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27")));
const now = withoutAllowedFields(snap);
const base = readBaseline();
const b2 = snap.block2 as Record<string, unknown>;
const b7 = snap.block7 as Record<string, unknown>[];
console.log(`baseline: ${BASELINE}`);
console.log(`new fields present: block2.action=${"action" in b2 ? JSON.stringify(b2.action) : "—"}; block7[].audience=${b7.map((a) => a.audience ?? "—").join(",")}`);
if (now === base) {
  console.log(`diff vs baseline (without ${ALLOWED_NEW_FIELDS.join(", ")}): EMPTY — byte-identical`);
} else {
  const paths = diffPaths(JSON.parse(now), JSON.parse(base));
  console.log(`diff vs baseline: ${paths.length} path(s) differ`);
  for (const p of paths.slice(0, 50)) console.log(`  ${p}`);
  process.exitCode = 1;
}
