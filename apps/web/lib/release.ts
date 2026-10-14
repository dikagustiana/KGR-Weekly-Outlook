import "server-only";
import { createHash } from "node:crypto";
import { computeWeek, snapshotJson, toSnapshot } from "@kgr/engine";
import type { Supa } from "./supabase";
import { loadWeek } from "./data";
import { outlookPdf } from "./pdf";
import { WriteError } from "./write";

/** Release = frozen snapshot (JSON + PDF) of the computed outlook; blocked when any control is GAGAL (PRD §8). */
export async function releaseWeek(sb: Supa, weekStart: string, releasedBy: string) {
  const loaded = await loadWeek(sb, weekStart);
  if (!loaded) throw new WriteError("Minggu tidak ada");
  const result = computeWeek(loaded.inputs);
  if (!result.controls.releasable) {
    const bad = result.controls.controls.filter((c) => c.status === "GAGAL").map((c) => `${c.no}. ${c.name}`);
    throw new WriteError(`Tidak bisa dirilis — kontrol GAGAL: ${bad.join("; ")}`);
  }
  const json = snapshotJson(result);
  const sha = createHash("sha256").update(json).digest("hex");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${weekStart}/${loaded.week.update_date}_${stamp}`;
  const now = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const pdf = await outlookPdf(result, { releasedBy, generatedAt: now });
  const up1 = await sb.storage.from("releases").upload(`${base}.json`, new Blob([json], { type: "application/json" }), { contentType: "application/json" });
  if (up1.error) throw new WriteError(`Simpan snapshot: ${up1.error.message}`);
  const up2 = await sb.storage.from("releases").upload(`${base}.pdf`, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (up2.error) throw new WriteError(`Simpan PDF: ${up2.error.message}`);
  const i = loaded.inputs;
  const ops = [
    ...i.sales_lines.filter((r) => r.source === "Ops").map((r) => ({ table: "sales_line", id: r.id, document_ref: r.document_ref })),
    ...i.receipt_lines.filter((r) => r.source === "Ops").map((r) => ({ table: "receipt_line", id: r.id, document_ref: r.document_ref })),
    ...i.batches.filter((r) => r.source === "Ops").map((r) => ({ table: "batch", id: r.id, document_ref: r.document_ref })),
    ...i.opening_stock.filter((r) => r.source === "Ops").map((r) => ({ table: "opening_stock", id: r.id, document_ref: r.document_ref })),
  ];
  const snap = toSnapshot(result);
  const { data, error } = await sb.from("release").insert({
    week_id: loaded.week.id, update_date: loaded.week.update_date, engine_version: result.engineVersion, snapshot: snap, snapshot_sha256: sha,
    pdf_path: `${base}.pdf`, control_status: result.controls.overall, controls: snap.controls, ops_rows: ops, released_by: releasedBy,
  }).select("id").single();
  if (error) throw new WriteError(error.message);
  await sb.from("week").update({ status: "released" }).eq("id", loaded.week.id);
  return { id: (data as { id: string }).id, sha, overall: result.controls.overall, ops: ops.length };
}
