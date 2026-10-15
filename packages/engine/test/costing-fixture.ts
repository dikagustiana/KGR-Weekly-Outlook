/** fixtures/costing-2026-09 (202609_Data_COGS_LB.xlsx) → engine inputs. Shared by the golden test and the parser test. */
import { loadV3Fixture } from "../src/fixtures";
import { D } from "../src/decimal";
import { costComponentOf, poolsOfItemName, type AllocateInput, type CostLine, type CostingOutput } from "../src/costing";

export interface WpRow {
  row: number; product: string | null; price: string | null; unit: string | null; sku_fresh: string | null;
  kg_non_blasting: string | null; item_code: string | null; item_name: string | null; kg: string | null; boneless_pool: boolean;
}
export interface WpBatchFx {
  sheet: string; header_row: number; total_row: number; supplier: string | null; date: string | null;
  lb_kg: string | null; processed_kg: string | null; dead_head: string | null; dead_kg: string | null;
  costs: { label: string; amount: string; document: string | null; pi: string | null }[];
  cost_bl: string | null; total_cost: string | null; rows: WpRow[];
}

export const costingBatches = () => loadV3Fixture<WpBatchFx[]>("costing-2026-09", "batches.json");
export const costingGolden = () => loadV3Fixture<Record<string, string | null>>("costing-2026-09", "golden.json");

export function toAllocateInput(b: WpBatchFx): AllocateInput {
  const outputs: CostingOutput[] = b.rows.map((r) => ({
    ref: `${b.sheet}!${r.row}`, item_code: r.item_code, name: r.item_name ?? r.product,
    // kg = F (non blasting) + I (qty), as in the WP formula (F+I)
    kg: D(r.kg_non_blasting).plus(D(r.kg)),
    price_ref: r.price, pools: poolsOfItemName(r.item_name),
  }));
  const costLines: CostLine[] = b.costs.map((c) => ({ component: costComponentOf(c.label), amount: c.amount, document_ref: c.pi ?? c.document }));
  if (b.cost_bl) costLines.push({ component: "blast", amount: b.cost_bl, pool: "boneless", document_ref: null });
  return { batch: { ref: b.sheet, date: b.date, mode: "maklon", lb_kg: b.lb_kg, processed_kg: b.processed_kg }, outputs, costLines, options: { byProductMethod: "joint" } };
}
