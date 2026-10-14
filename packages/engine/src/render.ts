/** Plain-text rendering of the outlook blocks (CLI `pnpm outlook`). House number format. */
import { Decimal } from "./decimal";
import { fixed, pct } from "./format";
import type { WeekResult } from "./week";

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const n0 = (x: Decimal | null) => (x === null ? "" : fixed(x, 0));
const n2 = (x: Decimal | null) => (x === null ? "" : fixed(x, 2));
const p1 = (x: Decimal | null) => (x === null ? "" : pct(x, 1));

function table(head: string[], rows: string[][], widths: number[]): string {
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? pad(c, widths[i]) : lpad(c, widths[i]))).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function renderText(r: WeekResult, blocks: number[] = [1, 2, 3, 4, 5, 6, 7, 8]): string {
  const out: string[] = [];
  out.push(`KGR — WEEKLY OUTLOOK DAN KEPUTUSAN HARIAN`);
  out.push(`Minggu ${r.week.weekStart} s.d. ${r.week.weekEnd} · Update ${r.week.today} · Kontrol: ${r.controls.overall}`);
  out.push("");

  if (blocks.includes(1)) {
    out.push("1.  RINGKASAN MINGGU — GP produk");
    out.push(table(
      ["Segmen", "kg aktual", "Rev aktual", "GP aktual", "kg order", "Rev order", "GP order", "kg proyeksi", "Rev proyeksi", "GP proyeksi", "GP/kg", "GP %", "GP/kg lalu", "Δ GP/kg"],
      r.block1.map((s) => [
        s.segment, n2(s.kgActual), n0(s.revenueActual), n0(s.gpActual), n2(s.kgOrder), n0(s.revenueOrder), n0(s.gpOrder),
        n2(s.kgProjection), n0(s.revenueProjection), n0(s.gpProjection), n0(s.gpPerKg), p1(s.gpPct), n0(s.gpPerKgLastWeek), n0(s.deltaGpPerKg),
      ]),
      [9, 10, 13, 12, 10, 13, 12, 11, 14, 12, 7, 7, 10, 8],
    ));
    out.push("");
  }

  if (blocks.includes(2)) {
    const b = r.block2;
    out.push("2.  KEPUTUSAN RPA — potong berapa, beli live bird di harga berapa");
    const rows: [string, string, string][] = [
      ["Harga live bird hari ini (penawaran)", n0(b.lbPriceToday), "Rp/kg LB"],
      [`Order karkas fresh — ${b.horizonFrom} s.d. ${b.horizonTo}`, n2(b.freshOrdersInHorizon), "kg"],
      ["Stok karkas fresh hari ini", n2(b.freshStockToday), "kg"],
      ["Kebutuhan bersih karkas fresh", n2(b.netFreshNeed), "kg"],
      ["Live bird maksimum tanpa menambah karkas frozen", n2(b.lbMaxWithoutFrozen), "kg LB"],
      ["Live bird yang sudah direncanakan potong (horizon)", n2(b.lbPlannedInHorizon), "kg LB"],
      ["Karkas yang berpotensi jadi frozen", n2(b.karkasAtRiskOfFreezing), "kg"],
      ["Porsi karkas fresh dari potong rencana", p1(b.freshShareOfPlan), "%"],
      ["Nilai output per kg live bird (porsi fresh rencana)", n0(b.valuePerKgLbAtPlanShare), "Rp/kg LB"],
      ["Breakeven live bird — porsi fresh rencana", n0(b.breakevenAtPlanShare), "Rp/kg LB"],
      ["Breakeven live bird — 100% karkas fresh", n0(b.breakevenAt100Fresh), "Rp/kg LB"],
      ["Margin per kg live bird di harga hari ini", n0(b.marginPerKgLb), "Rp/kg LB"],
      ["Perkiraan margin potong rencana", n0(b.expectedMarginOfPlan), "Rp"],
      ["Potensi selisih harga karkas yang jadi frozen", n0(b.frozenPriceGap), "Rp"],
    ];
    out.push(table(["Indikator", "Nilai", "Satuan"], rows, [52, 16, 9]));
    out.push(`REKOMENDASI RPA: ${b.recommendationText}`);
    out.push(`(yield dipakai: ${b.yieldsUsed})`);
    out.push("");
  }

  if (blocks.includes(3)) {
    out.push("3.  KEPUTUSAN TRADING — beli apa, berapa, di spread berapa");
    out.push(table(
      ["SKU (key)", "Stok", "Order", "Rencana", "Butuh", "Hrg jual", "Hrg beli", "Spread", "Spread %", "Biaya stok", "REKOMENDASI"],
      r.block3.map((t) => [
        t.label, n2(t.stockToday), n2(t.ordersRestOfWeek), n2(t.plannedReceipts), n2(t.netNeed), n0(t.sellPrice),
        t.buyPrice === null ? "" : n0(t.buyPrice), n0(t.spread), p1(t.spreadPct), n0(t.avgStockCost), t.recommendationText,
      ]),
      [30, 10, 9, 9, 8, 8, 8, 7, 8, 10, 10],
    ));
    out.push("");
  }

  if (blocks.includes(4)) {
    out.push("4.  STOK — yang harus dijual / dibeli");
    out.push(table(["Status", "Jumlah SKU", "kg hari ini", "Nilai Rp"],
      r.block4.map((s) => [s.label, String(s.keys), n2(s.kgToday), n0(s.value)]), [36, 10, 12, 16]));
    out.push("");
  }

  if (blocks.includes(5)) {
    out.push("5.  KAS KELUAR — live bird dan pembelian trading (sesuai termin)");
    out.push(table(["Tanggal", "Bayar LB", "Bayar trading", "Total", "Basis"],
      [...r.block5.rows.map((c) => [c.date, n0(c.liveBird), n0(c.trading), n0(c.total), c.basis]),
        ["Total minggu", n0(r.block5.total.liveBird), n0(r.block5.total.trading), n0(r.block5.total.total), ""]],
      [12, 14, 14, 14, 8]));
    out.push("");
  }

  if (blocks.includes(6)) {
    const k = r.block6;
    out.push("6.  BATCH RPA MINGGU INI — aktual vs rencana");
    out.push(table(
      ["Status", "Batch", "kg LB", "Hrg LB", "Shrink", "Yield karkas", "Fresh %", "Margin Rp", "Margin/kg", "Biaya/kg out", "Nilai/kg out", "Breakeven LB"],
      [
        ...k.rows.map((b) => [
          b.status, String(b.batches), n2(b.lbKg), n0(b.avgLbPrice), p1(b.shrink), p1(b.karkasYield), p1(b.freshPct), n0(b.margin),
          n0(b.marginPerKgLb), n0(b.costPerKgOutput), n0(b.valuePerKgOutput), n0(b.breakevenLb),
        ]),
        ["Target", "", "", "", p1(k.target.shrink), p1(k.target.karkasYield), "", "", "", "", "", n0(k.target.breakevenLb100Fresh)],
      ],
      [8, 5, 10, 7, 7, 12, 8, 13, 9, 12, 12, 12],
    ));
    out.push("");
  }

  if (blocks.includes(7)) {
    out.push("7.  PERINGATAN");
    if (r.block7.length === 0) out.push("(tidak ada)");
    for (const a of r.block7) out.push(`- ${a.text}`);
    out.push("");
  }

  if (blocks.includes(8)) {
    out.push("8.  LAPORAN KEUANGAN MINGGU INI — ringkasan");
    out.push(table(["Indikator", "Minggu lalu", "Proyeksi", "Δ"],
      r.block8.map((s) => [s.label, n0(s.lastWeek), n0(s.projection), n0(s.delta)]), [50, 16, 16, 16]));
    out.push("");
  }
  return out.join("\n");
}
