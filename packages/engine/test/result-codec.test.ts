/** PRD v6 T29 (K77): week_snapshot.result read back equals computeWeek(fixture) — snapshot JSON byte-identical. */
import { describe, expect, it } from "vitest";
import { computeWeek } from "../src/week";
import { loadFixtureWeek } from "../src/fixtures";
import { snapshotJson } from "../src/snapshot";
import { decodeResult, encodeResult } from "../src/result-codec";
import { Decimal } from "../src/decimal";

describe("result codec (week_snapshot.result)", () => {
  const r = computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27"));
  // what jsonb stores: plain JSON text, parsed back
  const back = decodeResult(JSON.parse(JSON.stringify(encodeResult(r))));

  it("snapshot JSON of the decoded result is byte-identical to the computed one (T29)", () => {
    expect(snapshotJson(back)).toBe(snapshotJson(r));
  });

  it("keeps every digit of a Decimal, Maps and undefined fields", () => {
    expect(back.prepared.masterByKey).toBeInstanceOf(Map);
    expect([...back.prepared.masterByKey.keys()]).toEqual([...r.prepared.masterByKey.keys()]);
    expect(back.prepared.coa.size).toBe(r.prepared.coa.size);
    expect(back.statements.pnl.lines[0]).toEqual(r.statements.pnl.lines[0]);
    expect(back.statements.pnl.get("GROSS PROFIT")).toEqual(r.statements.pnl.get("GROSS PROFIT"));
    expect(() => back.statements.bs.get("x")).toThrow();
    expect(JSON.stringify(encodeResult(back))).toBe(JSON.stringify(encodeResult(r)));
  });

  it("round-trips edge values", () => {
    const tricky = { a: new Decimal("-0"), b: new Decimal("1.234567890123456789012345678901234567e-30"), c: [undefined, 1], $k: "x", d: NaN, s: new Set(["p"]) };
    const t = decodeResult(JSON.parse(JSON.stringify(encodeResult(tricky as never)))) as unknown as typeof tricky;
    expect(t.a.isNeg() && t.a.isZero()).toBe(true);
    expect(t.b.equals(tricky.b)).toBe(true);
    expect(t.c).toEqual([undefined, 1]);
    expect(t.$k).toBe("x");
    expect(Number.isNaN(t.d)).toBe(true);
    expect(t.s).toEqual(new Set(["p"]));
  });

  it("fits a jsonb row (size of the example week)", () => {
    const bytes = JSON.stringify(encodeResult(r)).length;
    console.log(`week_snapshot.result 2026-08-24: ${(bytes / 1024).toFixed(0)} kB`);
    expect(bytes).toBeLessThan(20 * 1024 * 1024);
  });
});
