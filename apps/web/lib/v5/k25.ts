/**
 * PRD v5 K25 (flag v5_costing): the live-bird price and volume are decided by the Direktur Operasional. Screens show
 * the simulation only — no recommendation, no "TUNDA / BELI / NEGOSIASI" label. This replaces block 2's action text
 * with the same engine figures in plain words; with the flag off the ebe4ad8 text stays (rule 6).
 */
import type { WeekResult } from "@kgr/engine";
import { minus, num } from "../fmt";

export const K25_DECIDER = "Harga dan volume live bird diputuskan Direktur Operasional.";

/** "Harga LB hari ini Rp 24.600 · breakeven rencana Rp 20.726 · margin −3.874 Rp/kg LB" (block 2 fields). */
export function lbSimulationText(b2: WeekResult["block2"]): string {
  return [
    `Harga LB hari ini Rp ${num(b2.lbPriceToday)}`,
    b2.breakevenAtPlanShare === null ? null : `breakeven rencana Rp ${num(b2.breakevenAtPlanShare)}`,
    b2.marginPerKgLb === null ? null : `margin ${minus(num(b2.marginPerKgLb))} Rp/kg LB`,
  ].filter(Boolean).join(" · ");
}
