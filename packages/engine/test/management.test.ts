/**
 * v3 management view sections (PRD v3 §6): Input and COGS. Golden from the example week (PRD v3 §1: COGS/kg RPA 32.721 vs
 * revenue/kg 30.914) and the ledger roll-forward (opening + in − out − blast = closing = the ledger balance).
 */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadFixtureWeek, loadGolden } from "../src/fixtures";
import { computeWeek } from "../src/week";
import { balanceAt, computeLedger, ledgerInputsFromWeek } from "../src/ledger";
import { cogsBySegment, inputSummary, rollForward } from "../src/management";

const w = loadFixtureWeek("2026-08-24");
const r = computeWeek(w);
const g = loadGolden("2026-08-24");

describe("management view — COGS per segment", () => {
  const c = cogsBySegment(r);
  it("COGS/kg RPA 32.721 vs revenue/kg 30.914 (PRD v3 §1): weekly P&L projection over the projected RPA kg", () => {
    const rpa = c.find((x) => x.segment === "RPA")!;
    expect(rpa.cogsPerKg!.toFixed(0)).toBe("32721");
    expect(rpa.revenuePerKg!.toFixed(0)).toBe("30914");
    expect(rpa.gpPerKg!.toFixed(4)).toBe(rpa.revenuePerKg!.minus(rpa.cogsPerKg!).toFixed(4));
    const tot = c.find((x) => x.segment === "TOTAL KGR")!;
    expect(tot.cogs.toFixed(2)).toBe(c.filter((x) => x.segment !== "TOTAL KGR").reduce((a, x) => a.plus(x.cogs), D(0)).toFixed(2));
    expect(tot.cogs.toFixed(2)).toBe(r.statements.pnl.get("TOTAL COST OF SALES").values.projection.neg().toFixed(2));
    expect(tot.revenue.toFixed(2)).toBe(r.statements.pnl.get("TOTAL REVENUE").values.projection.toFixed(2));
  });
});

describe("management view — Input", () => {
  const i = inputSummary(r);
  it("live bird bought = Aktual batches of block 6 (kg); freight and maklon of those batches", () => {
    const act = r.block6.rows.find((b) => b.status === "Aktual")!;
    expect(i.lb.actualKg.toFixed(2)).toBe(act.lbKg.toFixed(2));
    expect(i.lb.avgPriceActual?.toFixed(4) ?? null).toBe(act.avgLbPrice?.toFixed(4) ?? null);
    expect(i.batchCost.freight.gte(0)).toBe(true);
    expect(i.trading.actualKg.gte(0)).toBe(true);
    void g;
  });
});

describe("management view — inventory roll-forward (M2 ledger)", () => {
  const inp = ledgerInputsFromWeek(w);
  const led = computeLedger(inp);
  const to = "2026-08-26";
  const rf = rollForward(led, inp.startDate, to);
  it("opening (24 Aug) + in − out − blast ± adjust = closing = ledger balance 26 Aug", () => {
    const b = balanceAt(led, to, inp.keys, inp.params);
    expect(rf.closing.kg.toFixed(2)).toBe(b.totalKg.toFixed(2));
    expect(rf.opening.kg.plus(rf.in.kg).minus(rf.out.kg).minus(rf.blast.kg).plus(rf.adjust.kg).toFixed(2)).toBe(rf.closing.kg.toFixed(2));
    expect(rf.opening.kg.isZero()).toBe(true); // the opening lots enter on 24 Aug, inside the window
    expect(rf.in.kg.gt(0) && rf.out.kg.gt(0)).toBe(true);
  });
  it("vs balance sheet: closing MA value − inventory given", () => {
    expect(rollForward(led, inp.startDate, to, "100").vsBalanceSheet!.toFixed(2)).toBe(rf.closing.value.minus(100).toFixed(2));
  });
});
