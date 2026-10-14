/**
 * Maps every formula cell of the reference Excel (cached values in fixtures/<week>/golden.json)
 * to the engine's output. Used by the golden tests and by scripts/parity.ts (docs/parity.md).
 */
import { Decimal } from "../src/decimal";
import type { WeekResult } from "../src/week";

export type Kind = "rp" | "kg" | "ratio" | "count" | "text" | "date" | "key";

export interface Check {
  cell: string;
  label: string;
  kind: Kind;
  expected: string | null;
  actual: string | null;
}

type Val = Decimal | string | number | boolean | null | undefined;

const COLS = (from: string, to: string) => {
  const a = from.charCodeAt(0), b = to.charCodeAt(0);
  return Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i));
};

function str(v: Val): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Decimal) return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

/** I_Item rows in sheet order (fixtures keep the order; row = 6 + index). */
function itemRows(r: WeekResult): { row: number; group: string }[] {
  return r.prepared.items.map((it, i) => ({ row: 6 + i, group: it.group }));
}

export function buildChecks(r: WeekResult, golden: Record<string, string | null>): Check[] {
  const checks: Check[] = [];
  const add = (cell: string, label: string, kind: Kind, actual: Val, opts: { optional?: boolean } = {}) => {
    if (!(cell in golden)) {
      if (opts.optional) return;
      throw new Error(`golden cell missing: ${cell}`);
    }
    checks.push({ cell, label, kind, expected: golden[cell], actual: str(actual) });
  };
  const p = r.prepared;

  /* ---------------- headers */
  add("O_Outlook!B2", "Awal minggu", "date", r.week.weekStart);
  add("O_Outlook!C2", "Akhir minggu", "date", r.week.weekEnd);
  add("O_Outlook!F2", "Tanggal update", "date", r.week.today);
  /* ---------------- I_Item D: Kelompok */
  itemRows(r).forEach(({ row, group }) => add(`I_Item!D${row}`, "Kelompok", "key", group));

  /* ---------------- I_Parameter */
  add("I_Parameter!C5", "Awal minggu (Senin)", "date", p.weekStart);
  add("I_Parameter!C6", "Akhir minggu (Minggu)", "date", p.weekEnd);
  const yk = ["karkas", "kepala", "ceker", "usus", "hja", "lemak"] as const;
  yk.forEach((k, i) => {
    add(`I_Parameter!C${19 + i}`, `Yield dipakai ${k}`, "ratio", p.yields[k]);
    add(`I_Parameter!E${19 + i}`, `Yield aktual ${k}`, "ratio", p.yieldsActual ? p.yieldsActual[k] : null);
  });
  (["karkasFresh", "karkasFrozen", "kepala", "ceker", "usus", "hja", "lemak"] as const).forEach((k, i) =>
    add(`I_Parameter!C${28 + i}`, `Harga acuan ${k}`, "rp", p.prices[k]),
  );

  /* ---------------- T_Penjualan derived columns */
  for (const s of r.sales) {
    const row = s.src.row as number;
    add(`T_Penjualan!G${row}`, "Key dipakai", "key", s.key);
    add(`T_Penjualan!J${row}`, "Nilai Rp", "rp", s.hasKg ? s.value : null);
    add(`T_Penjualan!L${row}`, "HPP dipakai Rp", "rp", s.hasKg ? s.hpp : null);
    add(`T_Penjualan!M${row}`, "GP Rp", "rp", s.hasKg ? s.gp : null);
    add(`T_Penjualan!N${row}`, "Segmen", "key", s.segment);
    add(`T_Penjualan!O${row}`, "Kelompok", "key", s.group);
    add(`T_Penjualan!P${row}`, "Dihitung", "count", s.hasKg ? (s.counted ? 1 : 0) : null);
  }
  /* ---------------- T_Penerimaan */
  for (const x of p.receipts) {
    const row = x.src.row as number;
    add(`T_Penerimaan!H${row}`, "Key dipakai", "key", x.key);
    add(`T_Penerimaan!K${row}`, "Nilai Rp", "rp", x.hasKg ? x.value : null);
    add(`T_Penerimaan!L${row}`, "Segmen", "key", x.segment);
    add(`T_Penerimaan!M${row}`, "Dihitung", "count", x.hasKg ? (x.counted ? 1 : 0) : null);
  }
  /* ---------------- T_Batch */
  for (const b of p.batches) {
    const row = b.src.row as number;
    const m: [string, string, Kind, Val][] = [
      ["R", "Nilai LB Rp", "rp", b.lbValue], ["S", "Total biaya Rp", "rp", b.totalCost], ["T", "Shrink", "ratio", b.shrink],
      ["U", "Output kg", "kg", b.outputKg], ["V", "Yield output", "ratio", b.yieldOutput], ["W", "Yield karkas", "ratio", b.yieldKarkas],
      ["X", "Karkas fresh %", "ratio", b.freshShare], ["Y", "Nilai output Rp", "rp", b.outputValue], ["Z", "Margin batch Rp", "rp", b.margin],
      ["AA", "Margin per kg LB", "rp", b.marginPerKgLb], ["AB", "Breakeven LB Rp/kg", "rp", b.breakevenLb],
      ["AC", "Biaya per kg output", "rp", b.costPerKgOutput], ["AD", "Nilai per kg output", "rp", b.valuePerKgOutput],
    ];
    for (const [c, l, k, v] of m) add(`T_Batch!${c}${row}`, l, k, v);
  }
  /* ---------------- I_Stok_Awal */
  for (const o of p.opening) add(`I_Stok_Awal!C${o.src.row}`, "Key", "key", o.key);
  add("I_Stok_Awal!D306", "Total kg stok awal", "kg", p.opening.reduce((a, o) => a.plus(o.kg), new Decimal(0)));
  add("I_Stok_Awal!E306", "Total nilai stok awal", "rp", p.opening.reduce((a, o) => a.plus(o.value), new Decimal(0)));
  add("I_Stok_Awal!G306", "Total kg di atas batas umur", "kg", p.opening.reduce((a, o) => a.plus(o.kgOverAge), new Decimal(0)));
  /* ---------------- T_GL */
  for (const g of p.gl) {
    const row = g.src.row as number;
    add(`T_GL!J${row}`, "Dr − Cr", "rp", g.drCr);
    add(`T_GL!K${row}`, "Tipe akun", "key", g.type);
    add(`T_GL!L${row}`, "Baris laba rugi", "key", g.plLine);
    add(`T_GL!M${row}`, "Baris neraca", "key", g.bsLine);
    add(`T_GL!N${row}`, "Kas?", "key", g.isCash ? "Y" : "N");
    if (!g.isCash) {
      add(`T_GL!O${row}`, "|Nilai| non-kas", "rp", g.drCr.abs());
      add(`T_GL!P${row}`, "Kunci", "key", `${g.voucher}|${g.drCr.abs().toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()}`);
    }
    if (g.isCash) {
      add(`T_GL!Q${row}`, "Akun lawan", "key", g.counterAccount);
      add(`T_GL!S${row}`, "Kategori arus kas", "key", g.cfCategory);
    }
  }
  /* ---------------- I_TB */
  for (const t of p.tb) {
    const row = t.src.row as number;
    add(`I_TB!D${row}`, "Tipe", "key", t.type);
    add(`I_TB!E${row}`, "Baris neraca", "key", t.bsLine);
    add(`I_TB!F${row}`, "Baris laba rugi", "key", t.plLine);
  }
  add("I_TB!C266", "Total TB (harus 0)", "rp", p.tb.reduce((a, t) => a.plus(t.balance), new Decimal(0)));
  /* ---------------- T_Kas_Rencana */
  for (const c of p.cashPlan) add(`T_Kas_Rencana!F${c.src.row}`, "Dihitung", "count", c.hasAmount ? (c.counted ? 1 : 0) : null);

  /* ---------------- O_Stok */
  r.stock.days.forEach((d, i) => add(`O_Stok!${String.fromCharCode(72 + i)}4`, `Hari ${i + 1}`, "date", d));
  r.stock.rows.forEach((s, i) => {
    const row = 6 + i;
    add(`O_Stok!A${row}`, "Key", "key", s.key);
    add(`O_Stok!B${row}`, "Kelompok", "key", s.group);
    add(`O_Stok!C${row}`, "Segmen", "key", s.segment);
    add(`O_Stok!D${row}`, `Stok awal ${s.key}`, "kg", s.openingKg);
    add(`O_Stok!E${row}`, `Nilai stok awal ${s.key}`, "rp", s.openingValue);
    add(`O_Stok!F${row}`, `Umur rata-rata ${s.key}`, "ratio", s.avgAgeDays);
    add(`O_Stok!G${row}`, `kg di atas batas umur ${s.key}`, "kg", s.kgOverAgeLimit);
    s.closing.forEach((c, j) => add(`O_Stok!${String.fromCharCode(72 + j)}${row}`, `Stok akhir hari ${j + 1} ${s.key}`, "kg", c));
    add(`O_Stok!O${row}`, `Terima minggu ini ${s.key}`, "kg", s.receiptsKg);
    add(`O_Stok!P${row}`, `Nilai terima ${s.key}`, "rp", s.receiptsValue);
    add(`O_Stok!Q${row}`, `Biaya rata-rata ${s.key}`, "rp", s.avgCost);
    add(`O_Stok!R${row}`, `Jual + order ${s.key}`, "kg", s.salesAndOrdersKg);
    add(`O_Stok!S${row}`, `Stok hari ini ${s.key}`, "kg", s.stockToday);
    add(`O_Stok!T${row}`, `Order sisa minggu ${s.key}`, "kg", s.ordersRestOfWeek);
    add(`O_Stok!U${row}`, `Stok − order ${s.key}`, "kg", s.stockMinusOrders);
    add(`O_Stok!V${row}`, `Stok terendah ${s.key}`, "kg", s.lowest);
    add(`O_Stok!W${row}`, `Harga acuan ${s.key}`, "rp", s.refPrice ?? new Decimal(0));
    add(`O_Stok!X${row}`, `Margin/kg ${s.key}`, "rp", s.marginAtRef);
    add(`O_Stok!Y${row}`, `Nilai stok hari ini ${s.key}`, "rp", s.valueToday);
    add(`O_Stok!Z${row}`, `Status ${s.key}`, "text", s.statusText);
  });

  /* ---------------- O_Outlook block 1 */
  r.block1.forEach((s, i) => {
    const row = 6 + i;
    const v: [string, Kind, Val][] = [
      ["B", "kg", s.kgActual], ["C", "rp", s.revenueActual], ["D", "rp", s.gpActual], ["E", "kg", s.kgOrder],
      ["F", "rp", s.revenueOrder], ["G", "rp", s.gpOrder], ["H", "kg", s.kgProjection], ["I", "rp", s.revenueProjection],
      ["J", "rp", s.gpProjection], ["K", "rp", s.gpPerKg], ["L", "ratio", s.gpPct], ["M", "rp", s.gpPerKgLastWeek], ["N", "rp", s.deltaGpPerKg],
    ];
    for (const [c, k, x] of v) add(`O_Outlook!${c}${row}`, `Blok 1 ${s.segment} ${c}`, k, x);
  });
  /* block 2 */
  const b2 = r.block2;
  const b2m: [number, string, Kind, Val][] = [
    [12, "Harga live bird hari ini", "rp", b2.lbPriceToday], [13, "Order karkas fresh dalam horizon", "kg", b2.freshOrdersInHorizon],
    [14, "Stok karkas fresh hari ini", "kg", b2.freshStockToday], [15, "Kebutuhan bersih karkas fresh", "kg", b2.netFreshNeed],
    [16, "LB maksimum tanpa frozen", "kg", b2.lbMaxWithoutFrozen], [17, "LB rencana potong (horizon)", "kg", b2.lbPlannedInHorizon],
    [18, "Karkas berpotensi frozen", "kg", b2.karkasAtRiskOfFreezing], [19, "Porsi fresh rencana", "ratio", b2.freshShareOfPlan],
    [20, "Nilai output per kg LB", "rp", b2.valuePerKgLbAtPlanShare], [21, "Breakeven porsi rencana", "rp", b2.breakevenAtPlanShare],
    [22, "Breakeven 100% fresh", "rp", b2.breakevenAt100Fresh], [23, "Margin per kg LB", "rp", b2.marginPerKgLb],
    [24, "Perkiraan margin potong rencana", "rp", b2.expectedMarginOfPlan], [25, "Selisih harga karkas frozen", "rp", b2.frozenPriceGap],
    [26, "REKOMENDASI RPA", "text", b2.recommendationText],
  ];
  for (const [row, l, k, v] of b2m) add(`O_Outlook!B${row}`, l, k, v);
  /* block 3 */
  r.block3.forEach((t, i) => {
    const row = 30 + i;
    const v: [string, Kind, Val][] = [
      ["B", "kg", t.stockToday], ["C", "kg", t.ordersRestOfWeek], ["D", "kg", t.plannedReceipts], ["E", "kg", t.netNeed],
      ["F", "rp", t.sellPrice], ["G", "rp", t.buyPrice ?? new Decimal(0)], ["H", "rp", t.spread], ["I", "ratio", t.spreadPct],
      ["J", "rp", t.avgStockCost], ["K", "text", t.recommendationText],
    ];
    for (const [c, k, x] of v) add(`O_Outlook!${c}${row}`, `Trading ${t.label} ${c}`, k, x);
  });
  /* block 4 */
  r.block4.forEach((s, i) => {
    const row = 44 + i;
    add(`O_Outlook!B${row}`, `${s.status} jumlah SKU`, "count", s.keys);
    add(`O_Outlook!C${row}`, `${s.status} kg hari ini`, "kg", s.kgToday);
    add(`O_Outlook!D${row}`, `${s.status} nilai`, "rp", s.value);
  });
  /* block 5 */
  r.block5.rows.forEach((c, i) => {
    const row = 50 + i;
    add(`O_Outlook!A${row}`, "Tanggal", "date", c.date);
    add(`O_Outlook!B${row}`, `Bayar LB ${c.date}`, "rp", c.liveBird);
    add(`O_Outlook!C${row}`, `Bayar trading ${c.date}`, "rp", c.trading);
    add(`O_Outlook!D${row}`, `Total kas keluar ${c.date}`, "rp", c.total);
    add(`O_Outlook!E${row}`, "Basis", "key", c.basis);
  });
  add("O_Outlook!B57", "Total bayar LB", "rp", r.block5.total.liveBird);
  add("O_Outlook!C57", "Total bayar trading", "rp", r.block5.total.trading);
  add("O_Outlook!D57", "Total kas keluar", "rp", r.block5.total.total);
  /* block 6 */
  r.block6.rows.forEach((b, i) => {
    const row = 61 + i;
    const v: [string, Kind, Val][] = [
      ["B", "count", b.batches], ["C", "kg", b.lbKg], ["D", "rp", b.avgLbPrice], ["E", "ratio", b.shrink], ["F", "ratio", b.karkasYield],
      ["G", "ratio", b.freshPct], ["H", "rp", b.margin], ["I", "rp", b.marginPerKgLb], ["J", "rp", b.costPerKgOutput],
      ["K", "rp", b.valuePerKgOutput], ["L", "rp", b.breakevenLb],
    ];
    for (const [c, k, x] of v) add(`O_Outlook!${c}${row}`, `Batch ${b.status} ${c}`, k, x);
  });
  add("O_Outlook!E63", "Target shrink", "ratio", r.block6.target.shrink);
  add("O_Outlook!F63", "Target yield karkas", "ratio", r.block6.target.karkasYield);
  add("O_Outlook!L63", "Breakeven 100% fresh", "rp", r.block6.target.breakevenLb100Fresh);
  /* block 7 — rows 66..72 in fixed order */
  const alertRow: Record<string, number> = {
    ORDER_LEWAT: 66, KODE_BARU: 67, STOK_MINUS: 68, HARGA_KOSONG: 69, SHRINK: 70, LB_DI_ATAS_BREAKEVEN: 71, TAHAN: 72,
  };
  for (const [code, row] of Object.entries(alertRow)) {
    const a = r.block7.find((x) => x.code === code);
    add(`O_Outlook!A${row}`, `Peringatan ${code}`, "text", a ? a.text : null);
  }
  /* block 8 */
  r.block8.forEach((s, i) => {
    const row = 76 + i;
    if (s.lastWeek !== null) add(`O_Outlook!B${row}`, `${s.label} minggu lalu`, "rp", s.lastWeek);
    add(`O_Outlook!C${row}`, `${s.label} proyeksi`, "rp", s.projection);
    if (s.delta !== null) add(`O_Outlook!D${row}`, `${s.label} Δ`, "rp", s.delta);
  });

  /* ---------------- O_PnL */
  const pnlCols: [string, keyof WeekResult["statements"]["pnl"]["lines"][number]["values"]][] = [
    ["B", "lastWeek"], ["C", "actual"], ["D", "outlook"], ["E", "projection"], ["F", "delta"], ["G", "mtd"], ["H", "mtdPlusOutlook"],
  ];
  r.statements.pnl.lines.forEach((l, i) => {
    const row = 6 + i;
    for (const [c, k] of pnlCols) add(`O_PnL!${c}${row}`, `${l.line} ${k}`, l.kind === "ratio" ? "ratio" : "rp", l.values[k], { optional: true });
  });

  /* ---------------- O_BS */
  const bs = r.statements.bs;
  add("O_BS!B4", "Tanggal saldo awal", "date", bs.dates.tb);
  add("O_BS!C4", "Akhir minggu lalu", "date", bs.dates.lastWeekEnd);
  add("O_BS!D4", "Kemarin", "date", bs.dates.yesterday);
  add("O_BS!E4", "Proyeksi akhir minggu", "date", bs.dates.projection);
  const bsRow: Record<string, number> = {};
  [
    "Cash and cash equivalents", "Trade Receivables - Third Parties", "Trade Receivables - Related Parties",
    "Other Receivable - Third Party", "Other Receivable - Affiliated Party", "Advance Payment", "Inventory - Product",
    "Inventory - Trading", "Prepaid Tax", "Prepaid Expenses", "Other assets", "Fixed assets - cost", "Accumulated depreciation",
    "TOTAL ASSETS",
  ].forEach((l, i) => (bsRow[l] = 7 + i));
  [
    "Trade Payables - Third Parties", "Trade Payables - Affiliates", "Other Payable - Third Parties", "Other Payable - Related Parties",
    "Accrued Expenses - Third Parties", "Unearned Revenue", "Taxes Payable", "Temporary account (to reclassify)", "TOTAL LIABILITIES",
  ].forEach((l, i) => (bsRow[l] = 23 + i));
  ["Shareholder Equity", "Retained earnings", "Current year profit", "TOTAL EQUITY", "TOTAL LIABILITIES AND EQUITY"].forEach(
    (l, i) => (bsRow[l] = 34 + i),
  );
  bsRow["Kontrol: aset − (liabilitas + ekuitas) (harus 0)"] = 39;
  const bsCols: [string, "tb" | "lastWeekEnd" | "yesterday" | "projection" | "delta" | "plannedFlow"][] = [
    ["B", "tb"], ["C", "lastWeekEnd"], ["D", "yesterday"], ["E", "projection"], ["F", "delta"], ["G", "plannedFlow"],
  ];
  for (const l of bs.lines) {
    const row = bsRow[l.line];
    for (const [c, k] of bsCols) add(`O_BS!${c}${row}`, `${l.line} ${k}`, "rp", l.values[k], { optional: true });
  }
  const pf = bs.planned;
  const pfm: [number, string, Decimal][] = [
    [60, "Biaya produksi rencana", pf.batchTotalCost], [61, "Pembelian LB rencana", pf.lbValue], [62, "Angkut + maklon rencana", pf.freightMaklon],
    [63, "Pembelian trading rencana", pf.tradingReceipts], [64, "Bayar LB jatuh tempo", pf.lbDue], [65, "Bayar trading jatuh tempo", pf.tradingDue],
    [66, "Bayar angkut + maklon jatuh tempo", pf.freightMaklonDue], [67, "Revenue sisa minggu", pf.revenueOutlook],
    [68, "COGS LB sisa minggu", pf.cogsLbOutlook], [69, "COGS trading sisa minggu", pf.cogsTradingOutlook],
    [70, "Biaya run-rate net", pf.runRateCostsNet], [71, "D&A sisa minggu", pf.daOutlook], [72, "Laba bersih sisa minggu", pf.netIncomeOutlook],
    [73, "Arus kas bersih sisa minggu", pf.netCashFlowOutlook],
  ];
  for (const [row, l, v] of pfm) add(`O_BS!B${row}`, l, "rp", v);

  /* ---------------- O_CF */
  const cf = r.statements.cf;
  cf.lines.forEach((l, i) => {
    const row = 6 + i;
    add(`O_CF!B${row}`, `${l.category} minggu lalu`, "rp", l.values.lastWeek);
    add(`O_CF!C${row}`, `${l.category} aktual`, "rp", l.values.actual);
    add(`O_CF!D${row}`, `${l.category} sisa minggu`, "rp", l.values.outlook);
    add(`O_CF!E${row}`, `${l.category} proyeksi`, "rp", l.values.projection);
  });
  const cfc: [string, "lastWeek" | "actual" | "outlook" | "projection"][] = [["B", "lastWeek"], ["C", "actual"], ["D", "outlook"], ["E", "projection"]];
  for (const [c, k] of cfc) {
    add(`O_CF!${c}18`, `Arus kas bersih ${k}`, "rp", cf.net[k]);
    add(`O_CF!${c}20`, `Saldo kas awal ${k}`, "rp", cf.opening[k]);
    add(`O_CF!${c}21`, `Arus kas bersih ${k}`, "rp", cf.net[k]);
    add(`O_CF!${c}22`, `Saldo kas akhir ${k}`, "rp", cf.closing[k]);
  }
  add("O_CF!B23", "Kontrol kas minggu lalu", "rp", cf.tieOut.lastWeek);
  add("O_CF!C23", "Kontrol kas kemarin", "rp", cf.tieOut.actual);
  add("O_CF!E23", "Kontrol kas proyeksi", "rp", cf.tieOut.projection);
  cf.daily.forEach((d, i) => {
    const row = 28 + i;
    add(`O_CF!A${row}`, "Tanggal", "date", d.date);
    add(`O_CF!B${row}`, `Arus kas bersih ${d.date}`, "rp", d.netFlow);
    add(`O_CF!C${row}`, `Saldo akhir hari ${d.date}`, "rp", d.closing);
    add(`O_CF!D${row}`, "Basis", "key", d.basis);
  });
  add("O_CF!C35", "Saldo kas terendah minggu ini", "rp", cf.lowest.balance);

  /* ---------------- Z_Kontrol */
  for (const c of r.controls.controls.filter((x) => x.no <= 19)) {
    const row = 4 + c.no;
    add(`Z_Kontrol!C${row}`, `Kontrol ${c.no} nilai`, c.no === 8 || c.no === 10 ? "kg" : "rp", c.value);
    if (c.no === 8 || c.no === 9) add(`Z_Kontrol!D${row}`, `Kontrol ${c.no} pembanding`, "rp", c.comparator ?? new Decimal(0));
    if (c.no === 10) add(`Z_Kontrol!D${row}`, `Kontrol ${c.no} pembanding`, "kg", c.comparator);
    add(`Z_Kontrol!E${row}`, `Kontrol ${c.no} selisih`, "rp", c.difference, { optional: true });
    add(`Z_Kontrol!F${row}`, `Kontrol ${c.no} status`, "key", c.status);
  }
  add("Z_Kontrol!F25", "Ringkasan kontrol", "key", r.controls.overall);
  return checks;
}

/** Excel's FIXED() texts are en-US ("24,600", "6.3%"); the engine writes the house format ("24.600", "6,3%"). */
export function enToId(s: string): string {
  return s.replace(/\d[\d,]*(\.\d+)?/g, (m) => m.replace(/,/g, "§").replace(/\./g, ",").replace(/§/g, "."));
}

const TOL: Record<Kind, number> = { rp: 1, kg: 0.01, ratio: 1e-9, count: 0, text: 0, date: 0, key: 0 };

export function compare(c: Check): { ok: boolean; diff: string } {
  const { expected: e, actual: a, kind } = c;
  if (kind === "text" || kind === "key" || kind === "date") {
    const ee = e === null || e === "" ? null : kind === "text" ? enToId(e) : e;
    const aa = a === null || a === "" ? null : a;
    return { ok: ee === aa, diff: ee === aa ? "" : `"${aa}" ≠ "${ee}"` };
  }
  const eBlank = e === null || e === "";
  const aBlank = a === null || a === "";
  if (eBlank || aBlank) return { ok: eBlank === aBlank, diff: eBlank === aBlank ? "" : `${a} ≠ ${e}` };
  const d = new Decimal(a as string).minus(new Decimal(e as string)).abs();
  const tol = kind === "ratio" ? Math.max(TOL.ratio, Math.abs(Number(e)) * 1e-9) : TOL[kind];
  return { ok: d.lessThanOrEqualTo(tol), diff: d.toSignificantDigits(6).toString() };
}

export { COLS };
