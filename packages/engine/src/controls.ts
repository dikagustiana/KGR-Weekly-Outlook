/** PRD §8 — Z_Kontrol (controls 1–19) plus control 20 (Ops vs Accurate). */
import { D, Decimal, ZERO } from "./decimal";
import { AKUN_BARU, KODE_BARU, UNKNOWN, type Prepared } from "./prepare";
import type { Statements } from "./statements";
import type { StockResult } from "./stock";
import type { ReceiptLine, SalesLine } from "./types";

export type ControlStatus = "LULUS" | "GAGAL" | "PERIKSA" | "BELUM DIISI";

export interface Control {
  no: number;
  name: string;
  value: Decimal;
  comparator: Decimal | null;
  difference: Decimal | null;
  status: ControlStatus;
  action: string;
  /** Milestone scope: operational (1–11, 20) or statements (12–19). */
  scope: "operasional" | "laporan";
}

export interface ControlSummary {
  controls: Control[];
  /** Z_Kontrol F25: ADA GAGAL / PERIKSA / LULUS */
  overall: "ADA GAGAL" | "PERIKSA" | "LULUS";
  counts: Record<ControlStatus, number>;
  /** Release allowed when no control is GAGAL (PERIKSA / BELUM DIISI release with a warning). */
  releasable: boolean;
}

const N = (n: number) => new Decimal(n);

export interface Control20Input {
  /** Active rows (Accurate replaced Ops) and the superseded Ops shadow rows. */
  sales: SalesLine[];
  receipts: ReceiptLine[];
  supersededSales: SalesLine[];
  supersededReceipts: ReceiptLine[];
}

/** Control 20: a document present from both sources must match within 0,5% kg and 1% value. */
export function control20(x: Control20Input): { mismatches: { document_ref: string; kgDiffPct: Decimal; valueDiffPct: Decimal }[]; opsRowsActive: number } {
  const mismatches: { document_ref: string; kgDiffPct: Decimal; valueDiffPct: Decimal }[] = [];
  const agg = (rows: { document_ref?: string | null; kg: unknown; v: Decimal }[]) => {
    const m = new Map<string, { kg: Decimal; value: Decimal }>();
    for (const r of rows) {
      if (!r.document_ref) continue;
      const a = m.get(r.document_ref) ?? { kg: ZERO, value: ZERO };
      a.kg = a.kg.plus(D(r.kg as string));
      a.value = a.value.plus(r.v);
      m.set(r.document_ref, a);
    }
    return m;
  };
  const sv = (r: SalesLine) => D(r.kg).times(D(r.price));
  const rv = (r: ReceiptLine) => D(r.kg).times(D(r.unit_cost));
  const pairs: [Map<string, { kg: Decimal; value: Decimal }>, Map<string, { kg: Decimal; value: Decimal }>][] = [
    [
      agg(x.sales.filter((r) => r.source === "Accurate").map((r) => ({ document_ref: r.document_ref, kg: r.kg, v: sv(r) }))),
      agg(x.supersededSales.map((r) => ({ document_ref: r.document_ref, kg: r.kg, v: sv(r) }))),
    ],
    [
      agg(x.receipts.filter((r) => r.source === "Accurate").map((r) => ({ document_ref: r.document_ref, kg: r.kg, v: rv(r) }))),
      agg(x.supersededReceipts.map((r) => ({ document_ref: r.document_ref, kg: r.kg, v: rv(r) }))),
    ],
  ];
  for (const [acc, ops] of pairs) {
    for (const [doc, o] of ops) {
      const a = acc.get(doc);
      if (!a) continue;
      const kgDiffPct = a.kg.isZero() ? (o.kg.isZero() ? ZERO : N(1)) : a.kg.minus(o.kg).abs().div(a.kg.abs());
      const valueDiffPct = a.value.isZero() ? (o.value.isZero() ? ZERO : N(1)) : a.value.minus(o.value).abs().div(a.value.abs());
      if (kgDiffPct.greaterThan(0.005) || valueDiffPct.greaterThan(0.01)) mismatches.push({ document_ref: doc, kgDiffPct, valueDiffPct });
    }
  }
  const opsRowsActive = x.sales.filter((r) => r.source === "Ops").length + x.receipts.filter((r) => r.source === "Ops").length;
  return { mismatches, opsRowsActive };
}

export function computeControls(
  p: Prepared,
  stock: StockResult,
  st: Statements,
  c20?: Control20Input,
): ControlSummary {
  const list: Control[] = [];
  const add = (
    no: number, name: string, value: Decimal, comparator: Decimal | null, status: ControlStatus, action: string,
    difference: Decimal | null = comparator === null ? null : value.minus(comparator),
  ) => list.push({ no, name, value, comparator, difference, status, action, scope: no >= 12 && no <= 19 ? "laporan" : "operasional" });
  const zeroIs = (v: Decimal, fail: ControlStatus): ControlStatus => (v.isZero() ? "LULUS" : fail);
  const absLe1 = (v: Decimal, fail: ControlStatus): ControlStatus => (v.abs().lessThanOrEqualTo(1) ? "LULUS" : fail);

  // 1–3: keys registered (COUNTIF "KODE BARU" + COUNTIF segment "?")
  const c1 = N(p.sales.filter((s) => s.key === KODE_BARU).length + p.sales.filter((s) => s.segment === UNKNOWN).length);
  add(1, "Semua baris penjualan punya key yang terdaftar", c1, ZERO, zeroIs(c1, "GAGAL"), "Tambah kode di I_Item / key di I_Master");
  const c2 = N(p.receipts.filter((s) => s.key === KODE_BARU).length + p.receipts.filter((s) => s.segment === UNKNOWN).length);
  add(2, "Semua baris penerimaan punya key yang terdaftar", c2, ZERO, zeroIs(c2, "GAGAL"), "Tambah kode di I_Item / key di I_Master");
  const c3 = N(p.opening.filter((o) => o.key === KODE_BARU).length);
  add(3, "Semua baris stok awal punya key yang terdaftar", c3, ZERO, zeroIs(c3, "GAGAL"), "Tambah kode di I_Item");

  // 4–5: status filled on rows with kg > 0
  const c4 = N(p.sales.filter((s) => s.kg.greaterThan(0) && s.status === "").length);
  add(4, "Status penjualan terisi (Aktual/Order)", c4, ZERO, zeroIs(c4, "GAGAL"), "Isi kolom Status");
  const c5 = N(p.receipts.filter((s) => s.kg.greaterThan(0) && s.status === "").length);
  add(5, "Status penerimaan terisi (Aktual/Rencana)", c5, ZERO, zeroIs(c5, "GAGAL"), "Isi kolom Status");

  // 6: sales rows outside the week
  const c6 = N(p.sales.filter((s) => s.kg.greaterThan(0) && s.date !== null && (s.date < p.weekStart || s.date > p.weekEnd)).length);
  add(6, "Baris di luar minggu berjalan (tidak dihitung)", c6, ZERO, zeroIs(c6, "PERIKSA"), "Hapus atau pindahkan ke file minggu yang benar");

  // 7: past-dated orders
  const c7 = N(p.sales.filter((s) => s.status === "Order" && s.kg.greaterThan(0) && s.date !== null && s.date < p.today).length);
  add(7, "Order lewat tanggal belum terkirim", c7, ZERO, zeroIs(c7, "PERIKSA"), "Ubah jadi Aktual atau geser tanggal kirim");

  // 8: actual sales kg vs Accurate report
  const c8 = p.sales.filter((s) => s.status === "Aktual" && s.counted).reduce((a, s) => a.plus(s.kg), ZERO);
  const d8 = p.params.accurateSalesKg;
  add(
    8, "kg penjualan aktual minggu ini = laporan Accurate", c8, d8,
    d8 === null ? "BELUM DIISI" : c8.minus(d8).abs().lessThanOrEqualTo(1) ? "LULUS" : "GAGAL",
    "Cek baris yang belum ditempel",
  );

  // 9: opening stock value vs Inventory Valuation
  const c9 = p.opening.reduce((a, o) => a.plus(o.value), ZERO);
  const d9 = p.params.accurateOpeningValue;
  add(
    9, "Nilai stok awal = Inventory Valuation Accurate", c9, d9,
    d9 === null ? "BELUM DIISI" : c9.minus(d9).abs().lessThanOrEqualTo(1) ? "LULUS" : "GAGAL",
    "Cek stok awal per item",
  );

  // 10: batch output vs production receipts
  const c10 = p.batches
    .filter((b) => b.status === "Aktual" && b.date !== null && b.date >= p.weekStart && b.date <= p.weekEnd)
    .reduce((a, b) => a.plus(b.outputKg), ZERO);
  const d10 = p.receipts.filter((r) => r.source === "Produksi RPA" && r.status === "Aktual" && r.counted).reduce((a, r) => a.plus(r.kg), ZERO);
  const e10 = c10.minus(d10);
  let s10: ControlStatus;
  if (d10.isZero()) s10 = c10.isZero() ? "LULUS" : "GAGAL";
  else {
    const r = e10.abs().div(d10);
    s10 = r.lessThanOrEqualTo(0.02) ? "LULUS" : r.lessThanOrEqualTo(0.6) ? "PERIKSA" : "GAGAL";
  }
  add(10, "Output batch aktual = penerimaan produksi aktual (kg)", c10, d10, s10,
    "Beda tanggal GRN vs tanggal potong wajar 1 hari; selisih besar = GRN belum diinput", e10);

  // 11: keys with projected negative stock
  const c11 = N(stock.rows.filter((r) => r.lowest.lessThan(-0.5)).length);
  add(11, "SKU dengan stok proyeksi minus", c11, ZERO, zeroIs(c11, "PERIKSA"), "Peringatan — keputusan beli/potong/geser order");

  // 12: opening TB sums to zero
  const c12 = p.tb.reduce((a, t) => a.plus(t.balance), ZERO);
  add(12, "Neraca saldo awal seimbang (I_TB total)", c12, ZERO, absLe1(c12, "GAGAL"), "Cek tempelan TB");

  // 13: journal balanced
  const c13 = p.gl.reduce((a, g) => a.plus(g.drCr), ZERO);
  add(13, "Jurnal seimbang (total debit − kredit)", c13, ZERO, absLe1(c13, "GAGAL"), "Ada voucher yang terpotong saat ditempel");

  // 14: accounts without mapping (Excel passes with ≤ 1 — see docs/open-questions.md)
  const c14 = N(p.gl.filter((g) => g.type === AKUN_BARU).length + p.tb.filter((t) => t.type === AKUN_BARU).length);
  add(14, "Akun di jurnal / TB tanpa mapping", c14, ZERO, absLe1(c14, "GAGAL"), "Tambah akun di I_COA");

  // 15: balance sheet balances (end last week, yesterday, projection)
  const ctl = st.bs.totals.control.values;
  const c15 = ctl.lastWeekEnd.abs().plus(ctl.yesterday.abs()).plus(ctl.projection.abs());
  add(15, "Neraca seimbang — akhir minggu lalu, kemarin, proyeksi", c15, ZERO, absLe1(c15, "GAGAL"), "Cek mapping I_COA dan pos lawan T_Kas_Rencana");

  // 16: cash-flow closing cash = balance-sheet cash
  const t = st.cf.tieOut;
  const c16 = t.lastWeek.abs().plus(t.actual.abs()).plus(t.projection.abs());
  add(16, "Saldo kas akhir arus kas = neraca", c16, ZERO, absLe1(c16, "GAGAL"), "Cek kategori arus kas / akun kas");

  // 17: cash lines without a category ("?" = counter account not in I_COA)
  const c17 = N(p.gl.filter((g) => g.isCash && g.cfCategory === UNKNOWN).length);
  add(17, "Baris kas tanpa kategori arus kas", c17, ZERO, absLe1(c17, "GAGAL"), "Isi kategori di I_COA atau override di T_GL");

  // 18: cash-plan rows without a balance-sheet counter line
  const c18 = N(p.cashPlan.filter((c) => c.hasAmount && c.counterLine === null).length);
  add(18, "Pos lawan T_Kas_Rencana kosong", c18, ZERO, absLe1(c18, "GAGAL"), "Isi pos neraca lawan");

  // 19: temporary accounts carry a balance (at yesterday)
  const c19 = st.bs.get("Temporary account (to reclassify)").values.yesterday.abs();
  add(19, "Akun sementara terpakai (910004 / 1102008)", c19, ZERO, absLe1(c19, "PERIKSA"), "Minta accounting reklas ke akun yang benar");

  // 20: Ops vs Accurate (not in the Excel; PRD §8)
  if (c20) {
    const r = control20(c20);
    const v = N(r.mismatches.length);
    add(20, "Data Ops vs Accurate (dokumen sama: kg ≤ 0,5%, nilai ≤ 1%)", v, ZERO, zeroIs(v, "PERIKSA"),
      "Baris Accurate dipakai; cek selisih dengan dokumen ops");
  }

  const counts: Record<ControlStatus, number> = { LULUS: 0, GAGAL: 0, PERIKSA: 0, "BELUM DIISI": 0 };
  for (const c of list) counts[c.status]++;
  const overall = counts.GAGAL > 0 ? "ADA GAGAL" : counts.PERIKSA + counts["BELUM DIISI"] > 0 ? "PERIKSA" : "LULUS";
  return { controls: list, overall, counts, releasable: counts.GAGAL === 0 };
}
