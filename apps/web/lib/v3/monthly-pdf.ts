import "server-only";
/** Monthly release PDF (PLAN Fase 7): 2 pages A4 landscape from the month's data mart rows or a locked version. */
import { D, cumulative, monthSummary, versionDays, type PlDailyRow } from "@kgr/engine";
import { cellN, getPrinter, h, p1, table } from "../pdf";
import { tgl } from "../fmt";
import type { MonthView } from "./monthly";

const KIND: Record<string, string> = { actual: "aktual", po: "PO", runrate: "run-rate", none: "—" };

export async function monthlyPdf(x: { first: string; rows: PlDailyRow[]; view: MonthView; version: string | null; sha: string | null; budget: { revenue: string | null; gp: string | null; nibt: string | null } | null; generatedAt: string }): Promise<Buffer> {
  const sm = monthSummary(x.rows, x.first, x.budget, "0.10");
  const days = versionDays(x.rows, x.first);
  const cum = cumulative(days);
  const jt = (v: ReturnType<typeof D>) => cellN(v.div(1e6), (q) => (q === null || q === undefined ? "" : q.toFixed(1)));
  // R64: a figure the version or the accuracy table does not carry reads "belum ada", never 0
  const NONE = "belum ada";
  const jtOrNone = (v: unknown) => (v === null || v === undefined || v === "" ? NONE : jt(D(String(v))));
  const title = `KGR — Outlook bulanan ${x.first.slice(0, 7)}${x.version ? ` · versi ${x.version}` : " · belum dikunci"}`;
  const def = {
    pageSize: "A4", pageOrientation: "landscape", pageMargins: [24, 34, 24, 26],
    defaultStyle: { font: "Roboto", fontSize: 8 },
    header: { columns: [{ text: title, bold: true, fontSize: 9 }, { text: x.sha ? `SHA-256 ${x.sha.slice(0, 16)}…` : "", alignment: "right", fontSize: 7 }], margin: [24, 14, 24, 0] },
    footer: (page: number, pages: number) => ({ columns: [{ text: `PT Karya Gudang Rabat · ${x.generatedAt}`, fontSize: 6.5, color: "#7a8396" }, { text: `${page} / ${pages}`, alignment: "right", fontSize: 6.5, color: "#7a8396" }], margin: [24, 6, 24, 0] }),
    content: [
      h(`Ringkasan (jt Rp) — aktual s.d. ${tgl(sm.lastActual)}, ${sm.remainingDays} hari forecast`),
      table(["*", 70, 70, 70, 70, 70], ["Baris", "Aktual", "Forecast", "Outlook", "Rentang bawah", "Rentang atas"], [
        ["Penjualan", jt(sm.actual.revenue), jt(sm.forecast.revenue), jt(sm.outlook.revenue), jt(sm.range.revenueLow), jt(sm.range.revenueHigh)],
        ["Harga pokok", jt(sm.actual.cogs), jt(sm.forecast.cogs), jt(sm.outlook.cogs), "", ""],
        ["Laba kotor", jt(sm.actual.gp), jt(sm.forecast.gp), jt(sm.outlook.gp), jt(sm.range.gpLow), jt(sm.range.gpHigh)],
        ["Biaya", jt(sm.actual.opex), jt(sm.forecast.opex), jt(sm.outlook.opex), "", ""],
        ["Laba sebelum pajak", jt(sm.actual.nibt), jt(sm.forecast.nibt), jt(sm.outlook.nibt), "", ""],
      ], 8),
      { text: `Forecast dari PO: ${p1(sm.sharePo)}${sm.budget.revenue ? ` · budget penjualan ${sm.budget.revenue.div(1e6).toFixed(1)} jt, butuh per hari ${sm.budget.needPerDay ? sm.budget.needPerDay.div(1e6).toFixed(1) : "—"} jt` : ""}`, fontSize: 8, margin: [0, 0, 0, 6] },
      h("Penjualan per hari (jt Rp)"),
      table([70, 60, 70, 80], ["Tanggal", "Dasar", "Penjualan", "Kumulatif"], cum.map((c, i) => [tgl(c.date), KIND[days[i].kind], jt(c.value), jt(c.cumulative)]), 6.5),
      { text: "", pageBreak: "before" },
      h("Versi"),
      table([50, 70, 80, 80, 80, "*"], ["Versi", "Cut-off", "Penjualan", "Laba kotor", "Laba sebelum pajak", "SHA-256"],
        x.view.versions.map((v) => [String(v.version), tgl(String(v.cut_off_date ?? "")), jtOrNone(v.revenue), jtOrNone(v.gp), jtOrNone(v.nibt), { text: String(v.snapshot_sha256).slice(0, 24), fontSize: 6 }])),
      ...(x.view.bridge ? [h("Bridge penjualan V1 → V2 (jt Rp)"), table(["*", 80], ["Komponen", "Rp"], [
        ["V1", jt(x.view.bridge.from)], ["Δ aktual", jt(x.view.bridge.dActual)], ["Δ volume", jt(x.view.bridge.dVolume)], ["Δ harga", jt(x.view.bridge.dPrice)],
        ["Δ event", jt(x.view.bridge.dEvent)], ["V2", jt(x.view.bridge.to)], ["Selisih (harus 0)", jt(x.view.bridge.check)],
      ])] : []),
      ...(x.view.accuracy.length ? [h("Akurasi vs FINAL"), table([50, 70, 70, 70, 90, 90], ["Versi", "Lingkup", "Bias", "APE", "Bias sebelum peny.", "APE sebelum peny."],
        [...new Set(x.view.accuracy.map((a) => `${a.version}|${a.scope}`))].map((k) => {
          const [v, sc] = k.split("|");
          const g = (m: string) => x.view.accuracy.find((a) => a.version === v && a.scope === sc && a.metric === m)?.value as string | undefined;
          return [v, sc, jtOrNone(g("bias")), g("MAPE") === undefined ? NONE : cellN(D(g("MAPE")!), p1), jtOrNone(g("bias_pre")), g("MAPE_pre") === undefined ? NONE : cellN(D(g("MAPE_pre")!), p1)];
        }))] : []),
      ...(x.view.adjustments.length ? [h("Penyesuaian tutup buku"), table([50, "*", 120, 80, 50], ["Kode", "Keterangan", "Pos", "Jumlah (jt)", "Posting"],
        x.view.adjustments.map((a) => [String(a.code), String(a.description), String(a.pl_line), jt(D(String(a.amount))), a.posted ? "ya" : "belum"]))] : []),
      ...(x.view.assumptions.length ? [h("Asumsi"), table(["*", 140], ["Asumsi", "Nilai"], x.view.assumptions.map((a) => [String(a.description ?? a.code), String(a.value_text ?? a.value_num ?? "—")]))] : []),
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
