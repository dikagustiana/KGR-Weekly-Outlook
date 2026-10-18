/** K7 in the M2 ledger (PRD v4 irisan 3, QUESTIONS Q9): pure, so the rule is tested without a database. */
import { D, type LedgerSale } from "@kgr/engine";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Sales as ledger outflows with K7: an Order line that has deliveries goes out once per delivery (actual, on the
 * delivery date, with its DO number) and keeps only what is still open as a planned outflow. A delivery whose DO number
 * already arrived as an Aktual line of the same item (the Accurate posting) is that line, not a second outflow. A line
 * that is Aktual is the shipment itself; its deliveries are not added again.
 */
export function salesWithDeliveries(rows: Row[], deliveries: Row[], keyOf: (km: string | null, ic: string | null) => string): LedgerSale[] {
  const byLine = new Map<string, Row[]>();
  for (const d of deliveries) byLine.set(String(d.sales_line_id), [...(byLine.get(String(d.sales_line_id)) ?? []), d]);
  const actualDocs = new Set(rows.filter((r) => r.status === "Aktual" && s(r.document_ref)).map((r) => `${s(r.document_ref)}|${(s(r.item_code) ?? "").toUpperCase()}`));
  const out: LedgerSale[] = [];
  for (const r of rows) {
    const base = { item_code: s(r.item_code), key: keyOf(s(r.key_manual), s(r.item_code)), hpp_actual: s(r.hpp_actual) };
    const ds = r.status === "Order" ? byLine.get(String(r.id)) ?? [] : [];
    if (!ds.length) { out.push({ ref: String(r.id), date: s(r.date), status: s(r.status), kg: s(r.kg), document_ref: s(r.document_ref), ...base }); continue; }
    let delivered = D(0);
    for (const d of ds) {
      delivered = delivered.plus(D(String(d.kg)));
      if (s(d.document_ref) && actualDocs.has(`${s(d.document_ref)}|${(s(r.item_code) ?? "").toUpperCase()}`)) continue;
      out.push({ ref: String(r.id), date: s(d.date), status: "Aktual", kg: String(d.kg), document_ref: s(d.document_ref), ...base, hpp_actual: null });
    }
    // an order line without kg has no known open balance: it stays one outflow with kg null (the ledger reports it), never 0 kg
    if (s(r.kg) === null) { out.push({ ref: String(r.id), date: s(r.date), status: s(r.status), kg: null, document_ref: s(r.document_ref), ...base }); continue; }
    const open = D(String(r.kg)).minus(delivered).minus(D(String(r.cancelled_kg))); // cancelled_kg NOT NULL default 0
    if (open.gt(0)) out.push({ ref: String(r.id), date: s(r.date), status: s(r.status), kg: open.toFixed(2), document_ref: s(r.document_ref), ...base });
  }
  return out;
}

