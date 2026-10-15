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
