import { NextResponse } from "next/server";
import { toFixedString } from "@kgr/engine";
import { getViewer } from "@/lib/session";
import { computeForWeek } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  const c = await computeForWeek(week);
  if (!c) return new NextResponse("Minggu tidak ada", { status: 404 });
  const r = c.result;
  const q = (v: unknown) => (v === null || v === undefined ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const d = (x: Parameters<typeof toFixedString>[0], dp = 2) => toFixedString(x, dp) ?? "";
  const head = ["key", "kelompok", "segmen", "stok_awal_kg", "nilai_stok_awal", "umur_rata_rata", "kg_di_atas_batas_umur",
    ...r.stock.days.map((x) => `stok_akhir_${x}`), "terima_kg", "nilai_terima", "biaya_rata_rata", "jual_order_kg", "stok_hari_ini_kg",
    "order_sisa_kg", "stok_minus_order_kg", "stok_terendah_kg", "harga_acuan", "margin_per_kg", "nilai_stok_hari_ini", "status"];
  const lines = [head.join(","), ...r.stock.rows.map((s) => [
    s.key, s.group, s.segment, d(s.openingKg), d(s.openingValue), d(s.avgAgeDays), d(s.kgOverAgeLimit), ...s.closing.map((x) => d(x)),
    d(s.receiptsKg), d(s.receiptsValue), d(s.avgCost, 4), d(s.salesAndOrdersKg), d(s.stockToday), d(s.ordersRestOfWeek), d(s.stockMinusOrders),
    d(s.lowest), d(s.refPrice), d(s.marginAtRef, 4), d(s.valueToday), s.statusText,
  ].map(q).join(","))];
  return new NextResponse("﻿" + lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="KGR_Stok_${week}_update_${r.week.today}.csv"`, "Cache-Control": "private, no-store" },
  });
}
