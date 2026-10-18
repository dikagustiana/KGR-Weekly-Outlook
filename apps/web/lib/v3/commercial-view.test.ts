import { describe, expect, it } from "vitest";
import { assignedKeysFor, commercialView } from "./commercial-view";

const row = { date: "2026-08-26", key: "RPA|Karkas|Fresh", group_code: "KARKAS", form: "fresh", free_fresh_kg: "7327", free_frozen_kg: "0", oldest_age_days: 19, hours_to_cutoff: 0,
  cost_per_kg_ma: "37411.0000", cost_per_kg_si: "36123.4567", price_floor: "37761", price_list: "36705", margin_per_kg_list: "-706", realized_price_7d: null, margin_per_kg_realized: null,
  holding_loss_per_day: "0", downgrade_risk_rp: "36977249", urgency: "jual_hari_ini", priority_score: "36977249", rank: 1, ordered_today_kg: "0",
  // fields a careless loader could pass through: never rendered for sales
  batch_ref: "Pot_ISA (3)", cost_pool_id: "pool-1" };

describe("commercial view model (PRD v3 §8 M7)", () => {
  it("sales: MA cost per kg yes, specific cost per lot / cost pool / batch ref no", () => {
    const v = commercialView([row], { role: "sales", salesSeesCost: true, assignedKeys: "all" });
    const dom = JSON.stringify(v);
    expect(v[0].cost_per_kg_ma).toBe("37411.0000");
    expect(v[0].cost_per_kg_si).toBeNull();
    expect(dom).not.toContain("36123.4567");
    expect(dom).not.toContain("Pot_ISA");
    expect(dom).not.toContain("pool-1");
    expect(dom).not.toContain("cost_pool");
    expect(dom).not.toContain("batch_ref");
  });
  it("sales_sees_cost = false hides the MA cost; floor and margin stay; assignment filters the keys", () => {
    const v = commercialView([row, { ...row, key: "X", rank: 2 }], { role: "sales", salesSeesCost: false, assignedKeys: new Set(["RPA|Karkas|Fresh"]) });
    expect(v.map((r) => [r.key, r.cost_per_kg_ma, r.price_floor, r.margin_per_kg_list])).toEqual([["RPA|Karkas|Fresh", null, "37761", "-706"]]);
  });
  it("sales without an assignment see no key (PRD v4 S2); a keyless assignment row = every key", () => {
    expect(assignedKeysFor("sales", [])).toEqual(new Set());
    expect(commercialView([row], { role: "sales", salesSeesCost: true, assignedKeys: assignedKeysFor("sales", []) })).toEqual([]);
    expect(assignedKeysFor("sales", [{ key: "RPA|Karkas|Fresh" }, { key: null }])).toBe("all");
    expect(assignedKeysFor("commercial_lead", [])).toBe("all");
    expect(assignedKeysFor("sales", [{ key: "RPA|Karkas|Fresh" }])).toEqual(new Set(["RPA|Karkas|Fresh"]));
  });
  it("commercial lead / management see every key and the SI cost", () => {
    const v = commercialView([row], { role: "commercial_lead", salesSeesCost: false, assignedKeys: new Set() });
    expect(v[0].cost_per_kg_si).toBe("36123.4567");
    expect(v[0].cost_per_kg_ma).toBe("37411.0000");
  });
});

describe("A7: assigned keys are read as the database cover (O21(b), assignment_covers)", () => {
  const forms = ["RPA|Karkas|Fresh", "RPA|Karkas|Frozen", "RPA|Karkas|n/a", "RPA|Sayap|Fresh", "RPA|Sayap|Frozen"].map((key, i) => ({ ...row, key, rank: i + 1 }));
  const seen = (assigned: string[]) => commercialView(forms, { role: "sales", salesSeesCost: true, assignedKeys: assignedKeysFor("sales", assigned.map((key) => ({ key }))) }).map((r) => r.key);
  it("a base key (no form suffix) shows every form of its SKU, and nothing of another SKU", () => {
    expect(seen(["RPA|Karkas"])).toEqual(["RPA|Karkas|Fresh", "RPA|Karkas|Frozen", "RPA|Karkas|n/a"]);
  });
  it("a key with a form shows only that form", () => {
    expect(seen(["RPA|Sayap|Fresh"])).toEqual(["RPA|Sayap|Fresh"]);
    expect(seen(["RPA|Karkas|n/a"])).toEqual(["RPA|Karkas|n/a"]);
  });
  it("several assignments add up; a key the SKU list does not have shows nothing", () => {
    expect(seen(["RPA|Sayap|Frozen", "RPA|Karkas"])).toEqual(["RPA|Karkas|Fresh", "RPA|Karkas|Frozen", "RPA|Karkas|n/a", "RPA|Sayap|Frozen"]);
    expect(seen(["RPA|Nope"])).toEqual([]);
  });
});

