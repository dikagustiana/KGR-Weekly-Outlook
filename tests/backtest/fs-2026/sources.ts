/**
 * Backtest Agustus–September 2026, langkah 1 (docs/v5.2/BACKTEST-SEP-2026.md §3): cek kewajaran sumber SEBELUM app.
 * Sumber dibaca dari BACKTEST_DIR (default /home/user/backtest-data; berkas asli TIDAK di-commit, repo publik):
 *   - "09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx" (FS v2, acuan; sheet TB Accurate, BS/PL - Management Report, Agt 26, Sep 26)
 *   - "GL KGR Rev 1.xls" (Daftar Histori GL September), "Detail Sales September.xls" (Rincian Penjualan per Barang),
 *     "Valuation detail.xls" (Rincian Valuasi Persediaan 1 Agu–30 Sep)
 * GL lewat parser upload app (accurate_journal). Detail Sales dan Valuation detail berformat laporan berkelompok per barang
 * yang tidak dikenal parser upload; dibaca pembaca SETUP di bawah (hanya untuk pembanding). Keluaran: angka agregat saja.
 * Pakai: pnpm tsx tests/backtest/fs-2026/sources.ts [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { D, type Decimal } from "@kgr/engine";
import { readWorkbook, parseUpload, parseNumber, parseDate, type Sheet } from "@kgr/parsers";

const DIR = process.env.BACKTEST_DIR ?? "/home/user/backtest-data";
const FS = "09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx";
const out: Record<string, unknown> = { sources: {} };
const load = (f: string): Sheet[] => {
  const buf = readFileSync(join(DIR, f));
  (out.sources as Record<string, string>)[f] = createHash("sha256").update(buf).digest("hex");
  return readWorkbook(buf, f);
};
// a page number (-6) or a header is not a date: only real 2026 dates of the report count
const dateOr = (v: unknown): string | null => { try { const d = parseDate(v as never); return d && d.startsWith("2026-") ? d : null; } catch { return null; } };
const n = (v: unknown): Decimal => { const s = parseNumber(v as never); return s === null ? D(0) : D(s); }; // missing-ok: sel kosong laporan Accurate = 0 pada baris total
const jt = (d: Decimal) => d.div(1e6).toFixed(1);
const rp = (d: Decimal) => d.toFixed(2);
const sheet = (ss: Sheet[], name: string) => { const s = ss.find((x) => x.name === name); if (!s) throw new Error(`sheet ${name} tidak ada`); return s; };

// ---------------------------------------------------------------- FS: TB Accurate (mutasi per akun), BS, PL
const fs = load(FS);
const tb = sheet(fs, "TB Accurate");
const col = (letter: string) => letter.split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const MONTH = { "2026-08": { open: "Y", dr: "Z", cr: "AA", close: "AB" }, "2026-09": { open: "AB", dr: "AC", cr: "AD", close: "AE" } } as const;
type Acc = { name: string; open: Decimal; dr: Decimal; cr: Decimal; close: Decimal };
const tbOf = (m: keyof typeof MONTH) => {
  const c = MONTH[m]; const map = new Map<string, Acc>();
  for (const r of tb.rows.slice(5)) {
    const acc = r[0] === null || r[0] === undefined ? "" : String(r[0]).trim();
    if (!/^\d{7}$/.test(acc)) continue; // akun detail 7 digit (header 4 digit dilewati)
    map.set(acc, { name: String(r[1] ?? ""), open: n(r[col(c.open)]), dr: n(r[col(c.dr)]), cr: n(r[col(c.cr)]), close: n(r[col(c.close)]) });
  }
  return map;
};
// FS values by real cell, from tests/backtest/sep-2026/expected.py run on the same workbook (BACKTEST_FS) into this file:
// readWorkbook drops the sheet's !ref origin, so row/column offsets of the Management Report sheets are not cell addresses
const EXP = JSON.parse(readFileSync(join(__dirname, "../../../docs/v5.3/backtest-fs/expected.json"), "utf8")) as { source: { sha256: string }; months: Record<string, { pl: Record<string, { value: number }>; bs: Record<string, { value: number }> }> };
if (EXP.source.sha256 !== (out.sources as Record<string, string>)[FS]) throw new Error("expected.json bukan dari FS v2 di BACKTEST_DIR: jalankan ulang expected.py dengan BACKTEST_FS");
const ex = (m: string, k: "pl" | "bs", cell: string) => { const v = EXP.months[m][k][cell]; if (!v) throw new Error(`sel ${cell} tidak ada di expected.json`); return D(v.value); };
const fsv = (m: "2026-08" | "2026-09") => { const L = m === "2026-08" ? "K" : "L"; return {
  revenue: ex(m, "pl", `'PL - Management Report'!${L}12`), cogs: ex(m, "pl", `'PL - Management Report'!${L}13`), nibt: ex(m, "pl", `'PL - Management Report'!${L}51`),
  kas: ex(m, "bs", `'BS - Management Report'!${L}14`), invProduct: ex(m, "bs", `'BS - Management Report'!${L}23`), invTrading: ex(m, "bs", `'BS - Management Report'!${L}24`) }; };
const FSV = { "2026-08": fsv("2026-08"), "2026-09": fsv("2026-09") };

// ---------------------------------------------------------------- GL lewat parser app
type GlRow = { date: string | null; account: string; debit: Decimal; credit: Decimal; voucher_no: string; voucher_type: string };
const glOf = (sheets: Sheet[], label: string) => {
  const r = parseUpload("accurate_journal", sheets);
  const rows: GlRow[] = r.sets.flatMap((s) => s.rows).map((x) => ({ date: x.date ? String(x.date) : null, account: String(x.account ?? ""), debit: D(String(x.debit ?? "0")), credit: D(String(x.credit ?? "0")), voucher_no: String(x.voucher_no ?? ""), voucher_type: String(x.voucher_type ?? "") })); // missing-ok: sisi kosong baris jurnal
  return { label, rows, issues: r.issues };
};
const sumBy = (rows: GlRow[]) => { const m = new Map<string, { dr: Decimal; cr: Decimal; n: number }>(); for (const x of rows) { const a = m.get(x.account) ?? { dr: D(0), cr: D(0), n: 0 }; a.dr = a.dr.plus(x.debit); a.cr = a.cr.plus(x.credit); a.n++; m.set(x.account, a); } return m; };

const rev1 = glOf(load("GL KGR Rev 1.xls"), "GL KGR Rev 1.xls");
const sep26 = glOf(fs.filter((s) => s.name === "Sep 26"), "FS v2!Sep 26");
const agt26 = glOf(fs.filter((s) => s.name === "Agt 26"), "FS v2!Agt 26");

const report: string[] = [];
const say = (s = "") => { report.push(s); console.log(s); };
say(`# Cek sumber Agustus–September 2026 (langkah 1)`);
say(`lingkungan: skrip lokal (pnpm tsx), parser app @kgr/parsers, BACKTEST_DIR=${DIR}`);
for (const [f, h] of Object.entries(out.sources as Record<string, string>)) say(`- ${f}: sha256 ${h}`);

const glSummary = (g: ReturnType<typeof glOf>) => {
  const dated = g.rows.filter((x) => x.date), undated = g.rows.filter((x) => !x.date);
  const s = (xs: GlRow[], k: "debit" | "credit") => xs.reduce((a, x) => a.plus(x[k]), D(0));
  return { label: g.label, rows: g.rows.length, dated: dated.length, undated: undated.length, dr: s(dated, "debit"), cr: s(dated, "credit"), undatedDr: s(undated, "debit"), undatedCr: s(undated, "credit"), undatedTypes: [...new Set(undated.map((x) => x.voucher_type || "-"))], range: [dated.map((x) => x.date!).sort()[0], dated.map((x) => x.date!).sort().pop()] };
};
say(`\n## L1a. GL lewat parser app`);
say(`| Sumber | Baris | Bertanggal | Tanpa tanggal | Rentang | Σ debit | Σ kredit | Σ debit tanpa tanggal |`);
say(`|---|---:|---:|---:|---|---:|---:|---:|`);
const sums: Record<string, ReturnType<typeof glSummary>> = {};
for (const g of [agt26, sep26, rev1]) { const s = glSummary(g); sums[g.label] = s; say(`| ${s.label} | ${s.rows} | ${s.dated} | ${s.undated} | ${s.range.join(" → ")} | ${rp(s.dr)} | ${rp(s.cr)} | ${rp(s.undatedDr)} |`); }

// ---------------------------------------------------------------- GL per akun vs mutasi TB
const vsTb = (g: ReturnType<typeof glOf>, m: keyof typeof MONTH, datedOnly: boolean) => {
  const t = tbOf(m), gl = sumBy(g.rows.filter((x) => !datedOnly || x.date));
  const accs = [...new Set([...t.keys(), ...gl.keys()])].sort();
  const bad = accs.map((a) => {
    const tt = t.get(a), gg = gl.get(a);
    const tbNet = tt ? tt.dr.minus(tt.cr) : D(0), glNet = gg ? gg.dr.minus(gg.cr) : D(0);
    return { a, name: tt?.name ?? "(tidak di TB)", tbNet, glNet, diff: glNet.minus(tbNet) };
  }).filter((x) => x.diff.abs().gt(1));
  return { accounts: accs.length, bad };
};
say(`\n## L1b. Σ GL per akun (debit − kredit) vs mutasi TB Accurate (debit − kredit bulan itu), toleransi Rp 1`);
for (const [g, m, dOnly] of [[agt26, "2026-08", true], [sep26, "2026-09", true], [rev1, "2026-09", true], [rev1, "2026-09", false]] as const) {
  const v = vsTb(g, m, dOnly);
  say(`- ${g.label}${dOnly ? "" : " (termasuk baris tanpa tanggal)"} vs TB ${m}: ${v.accounts} akun, ${v.bad.length} akun selisih${v.bad.length ? `; Σ|selisih| ${rp(v.bad.reduce((a, x) => a.plus(x.diff.abs()), D(0)))}` : ""}`);
  for (const b of v.bad.slice(0, 12)) say(`  - ${b.a} ${b.name}: GL ${rp(b.glNet)} · TB ${rp(b.tbNet)} · selisih ${rp(b.diff)}`);
  if (v.bad.length > 12) say(`  - … ${v.bad.length - 12} akun lagi`);
}

// ---------------------------------------------------------------- GL Rev 1 vs Sep 26: baris yang beda (per voucher)
say(`\n## L1c. GL KGR Rev 1.xls vs FS v2!Sep 26 (per No. Sumber, debit − kredit)`);
const byVoucher = (rows: GlRow[]) => { const m = new Map<string, Decimal>(); for (const x of rows) m.set(x.voucher_no, (m.get(x.voucher_no) ?? D(0)).plus(x.debit).minus(x.credit)); return m; };
const byVoucherGross = (rows: GlRow[]) => { const m = new Map<string, Decimal>(); for (const x of rows) m.set(x.voucher_no, (m.get(x.voucher_no) ?? D(0)).plus(x.debit)); return m; };
const vr = byVoucherGross(rev1.rows), vs = byVoucherGross(sep26.rows);
const onlyRev1 = [...vr.keys()].filter((k) => !vs.has(k)), onlySep = [...vs.keys()].filter((k) => !vr.has(k));
const changed = [...vr.keys()].filter((k) => vs.has(k) && vr.get(k)!.minus(vs.get(k)!).abs().gt(0.01));
say(`- voucher hanya di Rev 1: ${onlyRev1.length} (Σ debit ${rp(onlyRev1.reduce((a, k) => a.plus(vr.get(k)!), D(0)))}); hanya di Sep 26: ${onlySep.length} (Σ debit ${rp(onlySep.reduce((a, k) => a.plus(vs.get(k)!), D(0)))}); beda nilai: ${changed.length}`);
const typeOf = (rows: GlRow[], v: string) => rows.find((x) => x.voucher_no === v)?.voucher_type ?? "-";
for (const k of onlyRev1.slice(0, 10)) say(`  - hanya Rev 1: ${typeOf(rev1.rows, k)} Σ debit ${rp(vr.get(k)!)}`);
for (const k of onlySep.slice(0, 10)) say(`  - hanya Sep 26: ${typeOf(sep26.rows, k)} Σ debit ${rp(vs.get(k)!)}`);
for (const k of changed.slice(0, 10)) say(`  - beda: ${typeOf(sep26.rows, k)} Rev 1 ${rp(vr.get(k)!)} · Sep 26 ${rp(vs.get(k)!)}`);
void byVoucher;

// ---------------------------------------------------------------- Detail Sales September (SETUP reader)
const ds = load("Detail Sales September.xls")[0];
type SaleRow = { item: string; doc: string; date: string | null; qty: Decimal; amount: Decimal; unit: string };
const sales: SaleRow[] = []; const subtotals: { item: string; qty: Decimal; amount: Decimal }[] = []; let grand: { qty: Decimal; amount: Decimal } | null = null;
let item = "";
for (const r of ds.rows) {
  const c1 = r[1], c2 = r[2], c9 = r[9], c13 = r[13];
  if (c1 !== null && c1 !== undefined && String(c1).trim() && (c2 === null || c2 === undefined) && (c13 === null || c13 === undefined)) { item = String(c1).trim(); continue; }
  if (c2 !== null && c2 !== undefined && String(c2).trim() && c13 !== null && c13 !== undefined && dateOr(r[4])) { sales.push({ item, doc: String(c2).trim(), date: dateOr(r[4]), qty: n(c9), amount: n(c13), unit: String(r[11] ?? "") }); continue; }
  if ((c2 === null || c2 === undefined) && c9 !== null && c9 !== undefined && c13 !== null && c13 !== undefined && (c1 === null || c1 === undefined)) {
    // subtotal per barang, atau total akhir (baris sesudah subtotal terakhir)
    subtotals.push({ item, qty: n(c9), amount: n(c13) });
  }
}
// total akhir = baris subtotal yang nilainya = Σ semua baris faktur
const sumSales = sales.reduce((a, x) => a.plus(x.amount), D(0)), sumQty = sales.reduce((a, x) => a.plus(x.qty), D(0));
const grandRow = subtotals.find((s) => s.amount.minus(sumSales).abs().lt(0.05));
grand = grandRow ? { qty: grandRow.qty, amount: grandRow.amount } : null;
const itemSubs = subtotals.filter((s) => s !== grandRow);
const subMismatch = [...new Set(sales.map((s) => s.item))].filter((it) => { const st = itemSubs.filter((s) => s.item === it).reduce((a, s) => a.plus(s.amount), D(0)); const sm = sales.filter((s) => s.item === it).reduce((a, s) => a.plus(s.amount), D(0)); return st.minus(sm).abs().gt(0.05); });
const glRevenue = (g: ReturnType<typeof glOf>) => { const m = sumBy(g.rows.filter((x) => x.date)); let cr = D(0); const detail: [string, Decimal][] = []; for (const [a, v] of m) if (a.startsWith("4")) { cr = cr.plus(v.cr.minus(v.dr)); detail.push([a, v.cr.minus(v.dr)]); } return { total: cr, detail: detail.sort((x, y) => x[0].localeCompare(y[0])) }; };
const tbRev = (m: keyof typeof MONTH) => { let s = D(0); const det: [string, string, Decimal][] = []; for (const [a, v] of tbOf(m)) if (a.startsWith("4")) { s = s.plus(v.cr.minus(v.dr)); det.push([a, v.name, v.cr.minus(v.dr)]); } return { total: s, det }; };
say(`\n## L6. Detail Sales September (pembaca SETUP) vs revenue`);
say(`- baris faktur ${sales.length}; barang ${new Set(sales.map((s) => s.item)).size}; faktur unik ${new Set(sales.map((s) => s.doc)).size}; tanggal ${sales.map((s) => s.date).filter(Boolean).sort()[0]} → ${sales.map((s) => s.date).filter(Boolean).sort().pop()}`);
say(`- Σ Jumlah baris faktur ${rp(sumSales)} (${jt(sumSales)} jt); Σ kuantitas ${sumQty.toFixed(2)}; total akhir laporan ${grand ? `${rp(grand.amount)} / ${grand.qty.toFixed(2)}` : "tidak ditemukan"}; subtotal per barang yang tidak cocok: ${subMismatch.length}`);
const rs = glRevenue(sep26), rr = glRevenue(rev1), tr = tbRev("2026-09");
say(`- revenue FS (PL Mgmt L12) ${rp(FSV["2026-09"].revenue)}; TB akun 4xxxxxx (kredit − debit) ${rp(tr.total)}; GL Sep 26 akun 4xxxxxx ${rp(rs.total)}; GL Rev 1 ${rp(rr.total)}`);
for (const [a, nm, v] of tr.det.filter((x) => !x[2].isZero())) say(`  - TB ${a} ${nm}: ${rp(v)}`);
say(`- selisih Detail Sales − revenue FS: ${rp(sumSales.minus(FSV["2026-09"].revenue))} (${jt(sumSales.minus(FSV["2026-09"].revenue))} jt)`);
const shipping = sales.filter((s) => /shipping|ongkos/i.test(s.item)).reduce((a, s) => a.plus(s.amount), D(0));
say(`- di dalamnya "Shipping Fee": ${rp(shipping)}`);
const byMonthDoc = new Map<string, Decimal>(); for (const s of sales) { const k = (s.date ?? "-").slice(0, 7); byMonthDoc.set(k, (byMonthDoc.get(k) ?? D(0)).plus(s.amount)); }
say(`- per bulan tanggal faktur: ${[...byMonthDoc].map(([k, v]) => `${k} ${jt(v)} jt`).join(", ")}`);
// faktur penjualan di GL September (Faktur Penjualan) per nomor, vs Detail Sales per nomor
const glInv = new Map<string, Decimal>(); for (const x of sep26.rows.filter((x) => x.date && /Faktur Penjualan/i.test(x.voucher_type) && x.account.startsWith("4"))) glInv.set(x.voucher_no, (glInv.get(x.voucher_no) ?? D(0)).plus(x.credit).minus(x.debit));
const dsInv = new Map<string, Decimal>(); for (const s of sales) dsInv.set(s.doc, (dsInv.get(s.doc) ?? D(0)).plus(s.amount));
const norm = (d: string) => d.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
const glN = new Map([...glInv].map(([k, v]) => [norm(k), v])), dsN = new Map([...dsInv].map(([k, v]) => [norm(k), v]));
const both = [...dsN.keys()].filter((k) => glN.has(k)), onlyDs = [...dsN.keys()].filter((k) => !glN.has(k)), onlyGl = [...glN.keys()].filter((k) => !dsN.has(k));
const diffBoth = both.filter((k) => dsN.get(k)!.minus(glN.get(k)!).abs().gt(1));
say(`- faktur cocok nomornya dengan GL Sep 26 (Faktur Penjualan, akun 4xxx): ${both.length}; hanya di Detail Sales: ${onlyDs.length} (Σ ${rp(onlyDs.reduce((a, k) => a.plus(dsN.get(k)!), D(0)))}); hanya di GL: ${onlyGl.length} (Σ ${rp(onlyGl.reduce((a, k) => a.plus(glN.get(k)!), D(0)))}); nomor sama nilai beda > Rp 1: ${diffBoth.length} (Σ selisih ${rp(diffBoth.reduce((a, k) => a.plus(dsN.get(k)!.minus(glN.get(k)!)), D(0)))})`);

// ---------------------------------------------------------------- Valuation detail (SETUP reader)
const vd = load("Valuation detail.xls")[0];
type ValItem = { code: string; name: string; openQty: Decimal; openVal: Decimal; rows: { date: string | null; type: string; inQty: Decimal; inVal: Decimal; outQty: Decimal; outVal: Decimal; qty: Decimal; val: Decimal }[] };
const items: ValItem[] = []; let cur: ValItem | null = null;
for (const r of vd.rows) {
  const c0 = r[0] === null || r[0] === undefined ? "" : String(r[0]).trim();
  // a block cut by a page break repeats its header (same code, same opening balance): it continues the same item
  if (c0 === "No. Barang") { const code = String(r[4] ?? "").trim(); const seen = items.find((x) => x.code === code); if (seen) { cur = seen; continue; } cur = { code, name: "", openQty: n(r[19]), openVal: D(0), rows: [] }; items.push(cur); continue; }
  if (c0 === "Deskripsi Barang" && cur) { if (!cur.name) { cur.name = String(r[4] ?? "").trim(); cur.openVal = n(r[19]); } continue; }
  const d = c0 ? dateOr(r[0]) : null;
  if (d && cur) cur.rows.push({ date: d, type: String(r[2] ?? ""), inQty: n(r[8]), inVal: n(r[12]), outQty: n(r[15]), outVal: n(r[21]), qty: n(r[23]), val: n(r[25]) });
}
const closeAt = (it: ValItem, day: string) => { const rs2 = it.rows.filter((x) => x.date! <= day); return rs2.length ? { qty: rs2[rs2.length - 1].qty, val: rs2[rs2.length - 1].val } : { qty: it.openQty, val: it.openVal }; };
const roll = (it: ValItem) => it.openVal.plus(it.rows.reduce((a, x) => a.plus(x.inVal).minus(x.outVal), D(0)));
const rollBad = items.filter((it) => { const c = closeAt(it, "2026-09-30"); return roll(it).minus(c.val).abs().gt(1); });
const group = (code: string) => (code.startsWith("TRD") ? "trading" : "product");
say(`\n## L5. Valuation detail (pembaca SETUP) vs persediaan neraca`);
say(`- barang ${items.length} (kode ${[...new Set(items.map((i) => i.code.replace(/\d+$/, "")))].join(", ")}); baris mutasi ${items.reduce((a, i) => a + i.rows.length, 0)}; saldo berjalan tidak konsisten (saldo awal + masuk − keluar ≠ nilai akhir) > Rp 1: ${rollBad.length}`);
for (const [day, m] of [["2026-08-31", "2026-08"], ["2026-09-30", "2026-09"]] as const) {
  const tot = { product: D(0), trading: D(0) }; const qty = { product: D(0), trading: D(0) };
  for (const it of items) { const c = closeAt(it, day); tot[group(it.code)] = tot[group(it.code)].plus(c.val); qty[group(it.code)] = qty[group(it.code)].plus(c.qty); }
  const f = FSV[m];
  say(`- ${day}: Valuation product ${rp(tot.product)} vs BS b.23 ${rp(f.invProduct)} (selisih ${rp(tot.product.minus(f.invProduct))}); trading ${rp(tot.trading)} vs BS b.24 ${rp(f.invTrading)} (selisih ${rp(tot.trading.minus(f.invTrading))}); total ${jt(tot.product.plus(tot.trading))} jt vs ${jt(f.invProduct.plus(f.invTrading))} jt`);
}
const t9 = tbOf("2026-09"), t8 = tbOf("2026-08");
const invAcc = [...t9].filter(([a]) => a.startsWith("1104") || a.startsWith("1105") || /inventor|persediaan/i.test(t9.get(a)!.name));
for (const [a, v] of invAcc) say(`  - TB ${a} ${v.name}: 31 Agu ${rp(t8.get(a)?.close ?? D(0))} · 30 Sep ${rp(v.close)}`); // missing-ok: akun belum ada di TB Agustus
const outByMonth = new Map<string, Decimal>(); for (const it of items) for (const x of it.rows) { const k = x.date!.slice(0, 7); outByMonth.set(k, (outByMonth.get(k) ?? D(0)).plus(x.outVal)); }
say(`- nilai keluar (HPP stok) per bulan: ${[...outByMonth].sort().map(([k, v]) => `${k} ${jt(v)} jt`).join(", ")}; COGS FS Agu ${jt(FSV["2026-08"].cogs)} jt, Sep ${jt(FSV["2026-09"].cogs)} jt`);

out.summary = {
  gl: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, { rows: v.rows, dated: v.dated, undated: v.undated, debit: rp(v.dr), credit: rp(v.cr), undatedDebit: rp(v.undatedDr) }])),
  sales: { lines: sales.length, amount: rp(sumSales), revenueFs: rp(FSV["2026-09"].revenue) },
  valuation: { items: items.length },
};
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
const m = process.argv.indexOf("--md");
if (m > 0) writeFileSync(process.argv[m + 1], report.join("\n") + "\n");
