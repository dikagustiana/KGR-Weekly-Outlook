/** Management View v2 (PRD §5): numbers stay identical before and after the view refactor. */
import { describe, expect, it } from "vitest";
import { computeWeek } from "../src/week";
import { loadFixtureWeek } from "../src/fixtures";
import { toSnapshot } from "../src/snapshot";
import { readBaseline, withoutAllowedFields } from "../scripts/snapshot-baseline";

describe("engine snapshot vs Management View v2 baseline", () => {
  it("week 2026-08-24 is byte-identical except for the allowed new fields", () => {
    const snap = toSnapshot(computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27")));
    expect(withoutAllowedFields(snap)).toBe(readBaseline());
  });
});

import { snapshotJson, snapshotJsonV3, toSnapshotV3 } from "../src/snapshot";

describe("v3 snapshot keys (PRD v3 rule 2)", () => {
  const r = computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27"));
  it("no v3 output → byte-identical to snapshotJson", () => {
    expect(snapshotJsonV3(r, {})).toBe(snapshotJson(r));
  });
  it("v3 output is appended under new keys; without them the snapshot equals the baseline", () => {
    const s = toSnapshotV3(r, { controls_v3: [{ code: "C21" }], costing: { batches: [] } });
    const keys = Object.keys(s);
    expect(keys.slice(-2)).toEqual(["controls_v3", "costing"]);
    expect(withoutAllowedFields(s)).toBe(readBaseline());
  });
});
