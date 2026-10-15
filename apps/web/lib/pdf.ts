import "server-only";
import PdfPrinter from "pdfmake";
import vfs from "pdfmake/build/vfs_fonts.js";
import type { Decimal, WeekResult } from "@kgr/engine";
import { num, pct, tgl } from "./fmt";

type V = Decimal | null | undefined;

let printer: InstanceType<typeof PdfPrinter> | null = null;
export function getPrinter() {
  if (!printer) {
    const f = (n: string) => Buffer.from(vfs[n], "base64");
    printer = new PdfPrinter({
      Roboto: { normal: f("Roboto-Regular.ttf"), bold: f("Roboto-Medium.ttf"), italics: f("Roboto-Italic.ttf"), bolditalics: f("Roboto-MediumItalic.ttf") },
    });
  }
  return printer;
}

export const n0 = (v: V) => num(v ?? null, 0);
export const p1 = (v: V) => (v === null || v === undefined ? "" : pct(v, 1));
const isNeg = (v: V) => !!v && v.isNegative() && !v.isZero();
export const cellN = (v: V, f: (x: V) => string = n0) => {
  const text = f(v);
  return { text, alignment: "right", color: isNeg(v) && text.startsWith("-") ? "#c62828" : undefined };
};
const TEXT_HEADS = new Set(["Satuan", "Cara hitung", "REKOMENDASI", "Basis", "Tanggal", "Status", "Indikator", "Baris", "Segmen", "SKU (key)"]);
const head = (cols: string[]) => cols.map((c, i) => ({ text: c, bold: true, fillColor: "#eef1f6", alignment: i === 0 || TEXT_HEADS.has(c) ? "left" : "right", fontSize: 7 }));

export function table(widths: (string | number)[], header: string[], body: unknown[][], fontSize = 7.5) {
  return {
    table: { headerRows: 1, widths, body: [head(header), ...body] },
    layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => "#d6dae2", paddingTop: () => 1.5, paddingBottom: () => 1.5 },
    fontSize,
    margin: [0, 2, 0, 8],
  };
}

export const h = (text: string) => ({ text, bold: true, fontSize: 9.5, color: "#12355b", margin: [0, 4, 0, 3] });

/** A4 landscape outlook: page 1 blocks 1–2, page 2 blocks 3–7, page 3 statement summary (PRD §6). */
export async function outlookPdf(r: WeekResult, meta: { releasedBy?: string; generatedAt: string }): Promise<Buffer> {
  const b2 = r.block2;
  const title = `KGR — Weekly Outlook · Minggu ${tgl(r.week.weekStart)} – ${tgl(r.week.weekEnd)} · Update ${tgl(r.week.today, true)}`;
  const def = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [24, 34, 24, 26],
    defaultStyle: { font: "Roboto", fontSize: 8 },
    header: { columns: [{ text: title, bold: true, fontSize: 9 }, { text: `Kontrol: ${r.controls.overall}`, alignment: "right", fontSize: 8 }], margin: [24, 14, 24, 0] },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `PT Karya Gudang Rabat · engine v${r.engineVersion} · ${meta.releasedBy ? `dirilis oleh ${meta.releasedBy} · ` : ""}${meta.generatedAt}`, fontSize: 6.5, color: "#7a8396" },
        { text: `${page} / ${pages}`, alignment: "right", fontSize: 6.5, color: "#7a8396" },
      ],
      margin: [24, 6, 24, 0],
    }),
    content: [
      h("1. Ringkasan minggu — GP produk (HPP Accurate; order di biaya rata-rata stok; cost of sales others tidak termasuk)"),
      table(["*", 46, 58, 52, 46, 58, 52, 46, 62, 56, 38, 36, 40, 40],
        ["Segmen", "kg aktual", "Revenue aktual", "GP aktual", "kg order", "Revenue order", "GP order", "kg proyeksi", "Revenue proyeksi", "GP proyeksi", "GP/kg", "GP %", "GP/kg lalu", "Δ GP/kg"],
        r.block1.map((s) => [
          { text: s.segment, bold: s.segment === "TOTAL KGR" }, cellN(s.kgActual), cellN(s.revenueActual), cellN(s.gpActual), cellN(s.kgOrder),
          cellN(s.revenueOrder), cellN(s.gpOrder), cellN(s.kgProjection), cellN(s.revenueProjection), cellN(s.gpProjection), cellN(s.gpPerKg),
          cellN(s.gpPct, p1), cellN(s.gpPerKgLastWeek), cellN(s.deltaGpPerKg),
        ])),
      h("2. Keputusan RPA — potong berapa, beli live bird di harga berapa"),
      table([260, 80, 60, "*"], ["Indikator", "Nilai", "Satuan", "Cara hitung"], [
        ["Harga live bird hari ini (penawaran)", cellN(b2.lbPriceToday), "Rp/kg LB", "I_Parameter"],
        [`Order karkas fresh — ${tgl(b2.horizonFrom)} s.d. ${tgl(b2.horizonTo)}`, cellN(b2.freshOrdersInHorizon), "kg", "T_Penjualan: order RPA|Karkas|Fresh dalam horizon"],
        ["Stok karkas fresh hari ini", cellN(b2.freshStockToday), "kg", "O_Stok"],
        ["Kebutuhan bersih karkas fresh", cellN(b2.netFreshNeed), "kg", "order − stok"],
        ["Live bird maksimum tanpa menambah karkas frozen", cellN(b2.lbMaxWithoutFrozen), "kg LB", "kebutuhan bersih ÷ ((1 − shrink) × yield karkas)"],
        ["Live bird yang sudah direncanakan potong (horizon)", cellN(b2.lbPlannedInHorizon), "kg LB", "T_Batch: Rencana"],
        ["Karkas yang berpotensi jadi frozen", cellN(b2.karkasAtRiskOfFreezing), "kg", "kelebihan potong × (1 − shrink) × yield karkas"],
        ["Porsi karkas fresh dari potong rencana", cellN(b2.freshShareOfPlan, p1), "%", ""],
        ["Nilai output per kg live bird (porsi fresh rencana)", cellN(b2.valuePerKgLbAtPlanShare), "Rp/kg LB", "harga acuan × yield"],
        ["Breakeven live bird — porsi fresh rencana", cellN(b2.breakevenAtPlanShare), "Rp/kg LB", "nilai output − angkut − maklon"],
        ["Breakeven live bird — 100% karkas fresh", cellN(b2.breakevenAt100Fresh), "Rp/kg LB", "batas atas"],
        ["Margin per kg live bird di harga hari ini", cellN(b2.marginPerKgLb), "Rp/kg LB", "breakeven − harga"],
        ["Perkiraan margin potong rencana", cellN(b2.expectedMarginOfPlan), "Rp", "margin/kg × kg LB rencana"],
        ["Potensi selisih harga karkas yang jadi frozen", cellN(b2.frozenPriceGap), "Rp", "kg frozen × (harga fresh − frozen)"],
      ], 8),
      { text: `REKOMENDASI RPA: ${b2.recommendationText}`, bold: true, fontSize: 10, color: b2.recommendation === "LANJUT" ? "#187a3a" : "#c62828", margin: [0, 2, 0, 0] },

      { text: "", pageBreak: "before" },
      h("3. Keputusan Trading — beli apa, berapa, di spread berapa"),
      table(["*", 44, 44, 44, 44, 44, 44, 40, 34, 46, 190],
        ["SKU (key)", "Stok hari ini", "Order sisa", "Rencana terima", "Kebutuhan", "Harga jual", "Harga beli", "Spread", "Spread %", "Biaya stok", "REKOMENDASI"],
        r.block3.map((t) => [t.label, cellN(t.stockToday), cellN(t.ordersRestOfWeek), cellN(t.plannedReceipts), cellN(t.netNeed), cellN(t.sellPrice),
          { text: t.buyPrice === null ? "kosong" : n0(t.buyPrice), alignment: "right" }, cellN(t.spread), cellN(t.spreadPct, p1), cellN(t.avgStockCost),
          { text: t.recommendationText, fontSize: 7 }])),
      {
        columns: [
          [h("4. Stok — yang harus dijual / dibeli"), table(["*", 40, 60, 70], ["Status", "SKU", "kg hari ini", "Nilai Rp"],
            r.block4.map((s) => [s.label, { text: String(s.keys), alignment: "right" }, cellN(s.kgToday), cellN(s.value)]))],
          [h("5. Kas keluar — live bird dan trading (termin)"), table([70, "*", "*", "*", 40], ["Tanggal", "Bayar LB", "Bayar trading", "Total", "Basis"],
            [...r.block5.rows.map((c) => [tgl(c.date, true), cellN(c.liveBird), cellN(c.trading), cellN(c.total), c.basis]),
              [{ text: "Total minggu", bold: true }, cellN(r.block5.total.liveBird), cellN(r.block5.total.trading), cellN(r.block5.total.total), ""]])],
        ],
        columnGap: 16,
      },
      h("6. Batch RPA minggu ini — aktual vs rencana"),
      table(["*", 30, 50, 46, 40, 50, 44, 64, 46, 50, 50, 56],
        ["Status", "Batch", "kg LB", "Harga LB", "Shrink", "Yield karkas", "Fresh %", "Margin Rp", "Margin/kg", "Biaya/kg out", "Nilai/kg out", "Breakeven LB"],
        [...r.block6.rows.map((b) => [b.status, { text: String(b.batches), alignment: "right" }, cellN(b.lbKg), cellN(b.avgLbPrice), cellN(b.shrink, p1),
          cellN(b.karkasYield, p1), cellN(b.freshPct, p1), cellN(b.margin), cellN(b.marginPerKgLb), cellN(b.costPerKgOutput), cellN(b.valuePerKgOutput), cellN(b.breakevenLb)]),
          ["Target / benchmark", "", "", "", cellN(r.block6.target.shrink, p1), cellN(r.block6.target.karkasYield, p1), "", "", "", "", "", cellN(r.block6.target.breakevenLb100Fresh)]]),
      h("7. Peringatan"),
      r.block7.length ? { ul: r.block7.map((a) => ({ text: a.text, color: "#c62828" })), fontSize: 8 } : { text: "Tidak ada peringatan.", fontSize: 8 },

      { text: "", pageBreak: "before" },
      {
        columns: [
          {
            width: "42%",
            stack: [
              h("8. Laporan keuangan minggu ini — ringkasan"),
              table(["*", 62, 62, 56], ["Indikator", "Minggu lalu", "Proyeksi", "Δ"],
                r.block8.map((s) => [s.label, cellN(s.lastWeek), cellN(s.projection), cellN(s.delta)]), 7.5),
            ],
          },
          {
            width: "58%",
            stack: [
              h("Laba rugi — proyeksi minggu ini"),
              table(["*", 62, 62, 62, 62], ["Baris", "Minggu lalu", "Aktual s.d. kemarin", "Sisa minggu", "Proyeksi"],
                r.statements.pnl.lines.filter((l) => l.kind !== "ratio").map((l) => [
                  { text: l.line, bold: l.kind === "total" }, cellN(l.values.lastWeek), cellN(l.values.actual), cellN(l.values.outlook), cellN(l.values.projection),
                ]), 6.5),
            ],
          },
        ],
        columnGap: 14,
      },
      { text: `Kontrol: ${r.controls.counts.LULUS} LULUS · ${r.controls.counts.PERIKSA} PERIKSA · ${r.controls.counts["BELUM DIISI"]} BELUM DIISI · ${r.controls.counts.GAGAL} GAGAL`, fontSize: 8, margin: [0, 4, 0, 0] },
    ],
  };
  const doc = getPrinter().createPdfKitDocument(def);
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
