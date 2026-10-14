import { describe, expect, it } from "vitest";
import { computeWeek } from "../src/week";
import { loadFixtureWeek, loadGolden } from "../src/fixtures";
import { buildChecks, compare } from "./golden-map";

const WEEK = "2026-08-24";
const result = computeWeek(loadFixtureWeek(WEEK));
const golden = loadGolden(WEEK);
const checks = buildChecks(result, golden);

describe(`golden — every formula cell of the reference Excel (week ${WEEK}, update 2026-08-27)`, () => {
  const bySheet = new Map<string, typeof checks>();
  for (const c of checks) {
    const s = c.cell.split("!")[0];
    bySheet.set(s, [...(bySheet.get(s) ?? []), c]);
  }
  for (const [sheet, list] of bySheet) {
    it(`${sheet}: ${list.length} cells within Rp 1 / 0,01 kg`, () => {
      const bad = list.map((c) => ({ c, r: compare(c) })).filter((x) => !x.r.ok);
      expect(bad.map((x) => `${x.c.cell} ${x.c.label}: ${x.r.diff}`)).toEqual([]);
    });
  }
});
