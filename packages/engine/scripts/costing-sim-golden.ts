/**
 * Writes fixtures/costing-sim-2026-08-24/{inputs,golden}.json (PRD v5 Lampiran B.1): the live-bird simulation of the
 * example week on two bases. Need basis: the PO karkas shipped 27–29 Aug (fresh + n/a, block 2 horizon) over the
 * placeholder karkas yield of fixtures/plan-2026-08-24, by-products from the same yields, reference prices of the
 * week. Batch basis: v1 block 2 (planned kg LB in the horizon, karkas at risk of freezing at the frozen price, the rest
 * of the value per kg LB as other value). Tariff = freight + maklon × (1 − shrink) of the week's parameters.
 * Run: pnpm --filter @kgr/engine exec tsx scripts/costing-sim-golden.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { D } from "../src/decimal";
import { loadFixtureWeek, loadV3Fixture } from "../src/fixtures";
import { prepare } from "../src/prepare";
import { computeWeek } from "../src/week";
import { needBasisOutputs, simulateLivebird, tariffPerKgLb } from "../src/costing";

const week = loadFixtureWeek("2026-08-24", "2026-08-27");
const r = computeWeek(week);
const p = prepare(week);
const plan = loadV3Fixture<{ yields: { pattern: string; key: string; yield_pct: string }[] }>("plan-2026-08-24", "inputs.json");
const price = (key: string) => week.sku_keys.find((k) => k.key === key)?.ref_sell_price ?? null;
const y = (k: string) => plan.yields.find((x) => x.pattern === "karkas" && x.key === k)!.yield_pct;

const from = r.block2.horizonFrom, to = r.block2.horizonTo;
const naKg = p.sales.filter((s) => s.counted && s.status === "Order" && s.key === "RPA|Karkas|n/a" && s.date && s.date >= from && s.date <= to).reduce((a, s) => a.plus(D(s.kg)), D(0));
const freshKg = D(r.block2.freshOrdersInHorizon);
const karkasYield = D(y("Karkas"));
const kgLbNeed = freshKg.plus(naKg).div(karkasYield);
const bp = (sku: string) => ({ key: `RPA|${sku}|Fresh`, yield: y(sku), priceRef: price(`RPA|${sku}|Fresh`) });
const params = week.parameters as unknown as Record<string, string>;
const tariff = tariffPerKgLb({ freightPerKgLb: params.freight_plan_per_kg_lb, maklonPerKgProcessed: params.maklon_per_kg_processed, shrink: params.target_shrink });

const inputs = {
  source: "fixtures/week-2026-08-24 (block 2, sales lines, sku_keys, parameters) + fixtures/plan-2026-08-24 yields (placeholder)",
  placeholder: true,
  tariff_per_kg_lb: tariff.toFixed(4),
  prices: [20000, 21000, 22000, 23000, 24000, 24600, 25000, 26000],
  need: {
    horizon: { from, to }, karkas_yield: karkasYield.toFixed(6), kg_lb: kgLbNeed.toFixed(4),
    demand: [{ key: "RPA|Karkas|Fresh", kg: freshKg.toFixed(2), priceRef: price("RPA|Karkas|Fresh") }, { key: "RPA|Karkas|n/a", kg: naKg.toFixed(2), priceRef: price("RPA|Karkas|n/a") }],
    by_products: ["HJA (Hati/Jantung/Ampela)", "Usus", "Kepala", "Ceker", "Lemak"].map(bp),
  },
  batch: {
    kg_lb: D(r.block2.lbPlannedInHorizon).toFixed(4),
    outputs: [{ key: "RPA|Karkas|Frozen", kg: D(r.block2.karkasAtRiskOfFreezing).toFixed(4), priceRef: price("RPA|Karkas|Frozen") }],
    extra_value: D(r.block2.valuePerKgLbAtPlanShare).times(D(r.block2.lbPlannedInHorizon)).minus(D(r.block2.karkasAtRiskOfFreezing).times(D(price("RPA|Karkas|Frozen")!))).toFixed(2),
  },
};
const sim = (basis: "need" | "batch") => {
  const b = inputs[basis];
  const outputs = basis === "need" ? needBasisOutputs({ kgLb: inputs.need.kg_lb, demand: inputs.need.demand, byProducts: inputs.need.by_products }) : inputs.batch.outputs;
  return simulateLivebird({ basis, kgLb: b.kg_lb, outputs, extraValue: basis === "batch" ? inputs.batch.extra_value : null, tariffPerKgLb: inputs.tariff_per_kg_lb, prices: inputs.prices });
};
const out = (s: ReturnType<typeof sim>) => ({
  kg_lb: s.kgLb.toFixed(2), value: s.value.toFixed(2), breakeven: s.breakeven?.toFixed(2) ?? null,
  rows: s.rows.map((r) => ({ price: r.price.toFixed(0), cogs: r.cogs.toFixed(2), gp: r.gp.toFixed(2), k: r.k?.toFixed(6) ?? null, margin_per_kg_lb: r.marginPerKgLb?.toFixed(2) ?? null,
    skus: r.skus.map((k) => ({ key: k.key, kg: k.kg.toFixed(2), price_ref: k.priceRef?.toFixed(0) ?? null, cost_per_kg: k.costPerKg?.toFixed(2) ?? null })) })),
});
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/costing-sim-2026-08-24");
writeFileSync(join(dir, "inputs.json"), JSON.stringify(inputs, null, 1) + "\n");
writeFileSync(join(dir, "golden.json"), JSON.stringify({ status: "diusulkan", placeholder: true, need: out(sim("need")), batch: out(sim("batch")) }, null, 1) + "\n");
console.log("need kg LB", kgLbNeed.toFixed(1), "value", sim("need").value.div(1e6).toFixed(1), "breakeven", sim("need").breakeven?.toFixed(0));
for (const row of sim("need").rows) console.log(" need", row.price.toFixed(0), "COGS", row.cogs.div(1e6).toFixed(1), "GP", row.gp.div(1e6).toFixed(1), "k", row.k?.toFixed(4));
const b = sim("batch");
console.log("batch kg LB", b.kgLb.toFixed(1), "value", b.value.div(1e6).toFixed(1), "breakeven", b.breakeven?.toFixed(0), "@24600", b.rows[5].cogs.div(1e6).toFixed(2), b.rows[5].gp.div(1e6).toFixed(2));
