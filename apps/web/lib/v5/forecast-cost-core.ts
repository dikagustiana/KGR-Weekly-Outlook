/**
 * R67 (pure part): the forecast-cost types, the label text of the page and the re-costing of Order lines. The loader that
 * reads the decisions is forecast-cost.ts (server only).
 */
import type { Decimal } from "@kgr/engine";

/** The key the weekly engine looks SKUs up by (T_Penjualan): trimmed and upper case. */
export const normKey = (k: string) => k.trim().toUpperCase();

export interface ForecastCosts {
  /** date → normalised SKU key → plan cost per kg; only the keys that could be costed. */
  byDate: Map<string, Map<string, Decimal>>;
  /** date → why the date has no plan cost at all (its orders keep the MA cost). */
  reasons: Map<string, string>;
  /** date → a remark on a plan cost that exists (classes averaged without a decided volume). */
  notes: Map<string, string>;
}

/** What the page says about the forecast COGS: how many order lines took the plan cost and how many the MA cost, and why. */
export interface ForecastCostLabel {
  plan: number;
  ma: number;
  /** SKUs whose orders took the MA cost although their date has a plan cost (no reference price). */
  maKeys: string[];
  noPlan: { date: string; reason: string }[];
  notes: string[];
}

export const forecastCostText = (l: ForecastCostLabel | null | undefined): string | null => {
  if (!l || (!l.plan && !l.ma)) return null;
  const why = [
    ...l.noPlan.map((x) => `${x.date}: ${x.reason}`),
    ...(l.maKeys.length ? [`harga acuan kosong atau bukan SKU live bird: ${l.maKeys.join(", ")}`] : []),
  ];
  return `COGS forecast: biaya rencana (planCost kelas, harga LB keputusan) pada ${l.plan} baris order, biaya MA pada ${l.ma} baris${why.length ? ` (${why.join("; ")})` : ""}${l.notes.length ? `. ${l.notes.join("; ")}` : ""}`;
};

/**
 * Re-cost the Order lines of the weekly engine's sales with the plan cost of their date (hpp = cost per kg × kg); every
 * other line (delivered, trading, a date without plan cost, a SKU without cost) is left as it is, the MA cost. The label
 * counts the Order lines in [from, to] — the forecast days of the month — by the cost they took.
 */
export function applyForecastCosts<T extends { status: string; date: string | null; key: string; kg: Decimal; hpp: Decimal }>(
  sales: T[], costs: ForecastCosts, range: { from: string; to: string },
): { sales: T[]; label: ForecastCostLabel } {
  const label: ForecastCostLabel = { plan: 0, ma: 0, maKeys: [], noPlan: [], notes: [] };
  const seen = new Set<string>();
  const next = sales.map((x) => {
    if (x.status !== "Order" || !x.date || x.date < range.from || x.date > range.to) return x;
    const day = costs.byDate.get(x.date);
    const cpg = day?.get(normKey(x.key));
    if (cpg !== undefined) { label.plan++; return { ...x, hpp: cpg.times(x.kg) }; }
    label.ma++;
    if (day === undefined) {
      const reason = costs.reasons.get(x.date) ?? "belum ada keputusan harga LB";
      if (!seen.has(x.date)) { seen.add(x.date); label.noPlan.push({ date: x.date, reason }); }
    } else if (!label.maKeys.includes(x.key)) label.maKeys.push(x.key);
    return x;
  });
  label.notes = [...costs.notes.entries()].filter(([d]) => d >= range.from && d <= range.to).map(([, n]) => n);
  return { sales: next, label };
}
