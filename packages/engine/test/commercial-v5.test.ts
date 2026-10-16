/** PRD v5 §4.6 (K24, K26, C52): stock to sell, holding loss, commitments, spot. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
import { baseKey, c52, commitmentDeadline, commitmentDemand, filterRows, holdingRate, kgByBaseKey, spotRows, stockSellRows, stockSummary, type StockSellItem } from "../src/commercial-v5";

const fs = loadV3Fixture<{ pl: { line: string; values: Record<string, string> }[]; bs: { line: string; values: Record<string, string> }[] }>("fs-2026-09", "inputs.json");
const fsv = (arr: { line: string; values: Record<string, string> }[], l: string) => arr.find((x) => x.line === l)!.values["2026-08-31"];

describe("holding loss per day (§4.6)", () => {
  it("August: storage 97,5 ÷ inventory 3.532,6 ÷ 31 = 0,089% per day; 2,9 jt per day on 3.233,3 jt", () => {
    const inv = D(fsv(fs.bs, "Inventory - Product")).plus(D(fsv(fs.bs, "Inventory - Trading")));
    expect(inv.div(1e6).toFixed(1)).toBe("3532.6");
    const r = holdingRate({ storageExpense: fsv(fs.pl, "Storage Expenses"), inventoryEnd: inv, days: 31 })!;
    expect(r.times(100).toFixed(3)).toBe("0.089");
    expect(D("3233300000").times(r).div(1e6).toFixed(1)).toBe("2.9");
    expect(holdingRate({ storageExpense: null, inventoryEnd: inv, days: 31 })).toBeNull();
  });
});

// rows of the mockup stock table (ebe4ad8 data, Lampiran C): Ceker fresh below cost, Karkas fresh below cost, Karkas Trading n/a above
const items: StockSellItem[] = [
  { key: "RPA|Ceker|Fresh", form: "fresh", free_kg: "887.2", oldest_age_days: 7, over_age_kg: "0", urgency: "jual_hari_ini", cost_per_kg: "15995.9", cost_status: "sementara", price_ref: "3101" },
  { key: "RPA|Karkas|Fresh", form: "fresh", free_kg: "6461.1", oldest_age_days: 7, over_age_kg: "0", urgency: "jual_hari_ini", cost_per_kg: "37399.8", cost_status: "sementara", price_ref: "36705" },
  { key: "Trading|Karkas|n/a", form: "frozen", free_kg: "39564.7", oldest_age_days: 13, over_age_kg: "829.2", urgency: "aman", cost_per_kg: "30065.5", cost_status: "final", price_ref: "31277" },
  { key: "RPA|Lemak|Fresh", form: "fresh", free_kg: "225.9", oldest_age_days: 43, over_age_kg: "161.5", urgency: "di_atas_umur", cost_per_kg: "10374.9", cost_status: "sementara", price_ref: null },
  { key: "RPA|Sayap|Frozen", form: "frozen", free_kg: "0", oldest_age_days: 55, over_age_kg: "0", urgency: "di_atas_umur", cost_per_kg: "26299", cost_status: "sementara", price_ref: "25736" },
];
const rate = D("97510200").div(D("3532558577.57")).div(31);
const rows = stockSellRows(items, rate);

describe("stock to sell (ranking and cards)", () => {
  it("value at cost, margin, holding, below cost and the loss at the reference price; no free kg = not listed", () => {
    expect(rows.map((r) => r.key)).toEqual(["RPA|Ceker|Fresh", "RPA|Karkas|Fresh", "Trading|Karkas|n/a", "RPA|Lemak|Fresh"]);
    const ceker = rows[0];
    expect(ceker.below_cost).toBe(true);
    expect(ceker.loss_at_ref.div(1e6).toFixed(2)).toBe("11.44");
    expect(ceker.margin_per_kg!.toFixed(1)).toBe("-12894.9");
    expect(rows[2].below_cost).toBe(false);
    expect(rows[3].price_ref).toBeNull();
    expect(rows[3].below_cost).toBe(false);
  });
  it("summary: stock value, fresh to sell today, SKUs below cost and their loss, holding per day", () => {
    const s = stockSummary(rows);
    expect(s.skus).toBe(4);
    expect(s.fresh.skus).toBe(2);
    expect(s.fresh.kg.toFixed(1)).toBe("7348.3");
    expect(s.below.skus).toBe(2);
    expect(s.below.loss.div(1e6).toFixed(1)).toBe("15.9");
    expect(s.holdingPerDay!.gt(0)).toBe(true);
    expect(s.value.toFixed(0)).toBe(rows.reduce((a, r) => a.plus(r.value!), D(0)).toFixed(0));
  });
  it("filters: jual hari ini / di atas batas umur / di bawah biaya", () => {
    expect(filterRows(rows, "hari").map((r) => r.key)).toEqual(["RPA|Ceker|Fresh", "RPA|Karkas|Fresh"]);
    expect(filterRows(rows, "batas").map((r) => r.key)).toEqual(["RPA|Lemak|Fresh"]);
    expect(filterRows(rows, "below").map((r) => r.key)).toEqual(["RPA|Ceker|Fresh", "RPA|Karkas|Fresh"]);
    expect(filterRows(rows, "all").length).toBe(4);
  });
  it("spot: fresh before the cut-off; drop when blasted = (reference − frozen) × kg", () => {
    const sp = spotRows(rows, (k) => (k === "RPA|Karkas|Fresh" ? "31658" : k === "RPA|Ceker|Fresh" ? "5000" : null));
    expect(sp.map((r) => [r.key, r.downgrade?.div(1e6).toFixed(1) ?? null])).toEqual([["RPA|Ceker|Fresh", "0.0"], ["RPA|Karkas|Fresh", "32.6"]]);
  });
});

describe("K26 commitments", () => {
  it("deadline: Friday 17.00 of the week before; C52 N/A before, BELUM DIISI after with drafts or nothing locked, LULUS when locked", () => {
    const dl = commitmentDeadline("2026-08-31", 5, "17:00");
    expect(dl).toBe("2026-08-28T17:00:00+07:00");
    expect(c52({ now: "2026-08-27T10:00:00+07:00", deadline: dl, commitments: [] }).status).toBe("N/A");
    expect(c52({ now: "2026-08-28T17:30:00+07:00", deadline: dl, commitments: [] }).status).toBe("BELUM DIISI");
    expect(c52({ now: "2026-08-28T17:30:00+07:00", deadline: dl, commitments: [{ key: "RPA|Karkas", status: "locked" }, { key: "RPA|HJA (Hati/Jantung/Ampela)", status: "draft" }] }).detail).toEqual(["1 SKU masih draft", "RPA|HJA (Hati/Jantung/Ampela)"]);
    expect(c52({ now: "2026-08-28T17:30:00+07:00", deadline: dl, commitments: [{ key: "RPA|Karkas", status: "locked" }] }).status).toBe("LULUS");
  });
  it("locked commitments become Confirmed demand on Monday for the kg the POs do not cover; drafts do not count", () => {
    const d = commitmentDemand({
      weekStart: "2026-08-31",
      commitments: [
        { key: "RPA|Karkas", fresh_kg: "15000", frozen_kg: "2000", price: "36705", status: "locked", version: 2 },
        { key: "RPA|Usus", fresh_kg: "2000", frozen_kg: "0", price: "1500", status: "draft", version: 1 },
      ],
      orders: [{ key: "RPA|Karkas|Fresh", kg: "12000" }, { key: "RPA|Karkas|Frozen", kg: "2500" }],
    });
    expect(d.map((o) => [o.key, o.kg, o.delivery_date, o.demand_status])).toEqual([["RPA|Karkas|Fresh", "3000.00", "2026-08-31", "Confirmed"]]);
  });
  it("base key and kg of the week per base key", () => {
    expect(baseKey("RPA|Karkas|Fresh")).toBe("RPA|Karkas");
    expect(baseKey("Trading|Karkas|n/a")).toBe("Trading|Karkas");
    const m = kgByBaseKey([{ key: "RPA|Karkas|Fresh", kg: "13118" }, { key: "RPA|Karkas|Frozen", kg: "4228" }]);
    expect(m.get("RPA|Karkas")!.toFixed(0)).toBe("17346");
  });
});
