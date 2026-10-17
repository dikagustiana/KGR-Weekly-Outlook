import "server-only";
/**
 * K7 (PRD v4 §0.1, §3.1 P3.1/P3.8): "Terkirim" records the delivered kg in `delivery`; the database keeps
 * sales_line.fulfilled_kg = Σ delivery.kg and refuses more than kg − cancelled_kg. The line becomes Aktual (v1 rule)
 * only when nothing is outstanding, so a partial delivery does not close the PO.
 */
import { D, deliveryCheck, toFixedString } from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { applyChanges, WriteError } from "../write";
import { canWriteRow, TABLES } from "../tables";
import { queueRebuild } from "../rebuild";
import { num } from "../fmt";
import { must } from "../loader";

export async function recordDelivery(sb: Supa, viewer: Viewer, x: { id: string; date: string; kg: string | null; documentRef: string | null }): Promise<string> {
  const old = must(await sb.from("sales_line").select("*").eq("id", x.id).maybeSingle(), "delivery.sales_line");
  const o = old as Record<string, unknown> | null;
  if (!o || !canWriteRow(viewer.role, TABLES.sales_line, { ...o, status: "Aktual" })) throw new WriteError("Tidak berwenang");
  if (o.status !== "Order") throw new WriteError("Baris ini bukan order terbuka");
  const chk = deliveryCheck({ kg: String(o.kg), fulfilled_kg: String(o.fulfilled_kg ?? 0), cancelled_kg: String(o.cancelled_kg ?? 0) }, x.kg);
  if (!chk.ok) throw new WriteError(chk.error ?? "kg tidak valid");
  const e = await sb.from("delivery").insert({ sales_line_id: x.id, date: x.date, kg: toFixedString(D(x.kg!), 2), document_ref: x.documentRef, received_by: null });
  if (e.error) throw new WriteError(`delivery: ${e.error.message}`);
  if (chk.closes) await applyChanges(sb, "sales_line", [], [{ id: x.id, status: "Aktual", confirmed_by: viewer.email }]);
  await queueRebuild(sb, [x.date], "terkirim");
  return chk.closes
    ? `Terkirim ${num(x.kg!, 2)} kg; order selesai (Aktual)`
    : `Terkirim ${num(x.kg!, 2)} kg; sisa ${num(chk.after, 2)} kg tetap sebagai order`;
}
