/**
 * Management View v2 (PRD §5): the engine snapshot of the reference week must stay byte-identical to the
 * baseline taken before the change, except for the new fields the PRD allows (block2.action, block7[].audience).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/fixtures";
import type { Snapshot } from "../src/snapshot";

export const BASELINE = join(repoRoot(), "tests/snapshots/outlook-2026-08-24.before.json");
export const ALLOWED_NEW_FIELDS = ["block2.action", "block7[].audience"];

/** The snapshot JSON with the allowed new fields removed, in the same serialisation as snapshotJson. */
export function withoutAllowedFields(s: Snapshot): string {
  const c = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  delete (c.block2 as Record<string, unknown>).action;
  for (const a of c.block7 as Record<string, unknown>[]) delete a.audience;
  return JSON.stringify(c, null, 1) + "\n";
}

export function readBaseline(): string {
  return readFileSync(BASELINE, "utf8");
}

/** Paths whose values differ between two JSON trees (for the report; empty when identical). */
export function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return [path || "(root)"];
}
