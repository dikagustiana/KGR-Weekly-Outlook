/**
 * Data September 2026 lewat jalur app (19 Okt, atas permintaan Dika "masukin sekalian semua informasi keuangan untuk
 * september"), dijalankan terhadap SALINAN LOKAL KGR-OS (stack e2e: PG16 + PostgREST 12 + mock auth/storage), bukan
 * KGR-OS: agen tidak memegang kunci servis KGR-OS. Hasilnya diekspor ke SQL (export-delta.py) dan diterapkan lewat
 * connector, lalu dicek md5 per tabel (docs/v6/data-sep.md).
 *
 * Urutan (sama dengan tombol di UI, fungsi app yang sama):
 *   1. Admin → Minggu → "Lanjutkan ke minggu berikutnya" (rolloverWeek) sampai minggu 28 Sep ada;
 *      tiap minggu baru langsung diberi stok awal dari Valuation (upload accurate_stock_balance, saldo Minggu malam);
 *   2. Upload "WP potong per batch" (costing_wp) berkas 202609_Data_COGS_LB_1.xlsx;
 *   3. Input → Costing → "Alokasikan" (allocateWeek, draft) untuk tiap minggu September;
 *   4. Upload kartu stok (stock_card, C26) dari Valuation per 31 Agu dan 30 Sep.
 * Valuation detail adalah laporan Accurate berkelompok per barang yang tidak dikenal parser upload: pembaca SETUP di bawah
 * (sama dengan tests/backtest/fs-2026/sources.ts) menulis tabel datar (.xlsx, sel angka) yang lalu diunggah lewat app.
 *
 * Pakai: E2E_ONLY=none E2E_KEEP=1 E2E_CLOCK_START=… bash tests/e2e/run.sh; source tests/e2e/stack/env.sh;
 *        BACKTEST_DIR=<folder berkas> pnpm tsx --conditions=react-server tests/backtest/sep-2026/load-sep.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { D, addDays, type Decimal } from "../../../packages/engine/src/index";
import { readWorkbook, parseNumber, parseDate, type Sheet } from "../../../packages/parsers/src/index";

const require_ = createRequire(join(__dirname, "../../../apps/web/package.json"));
const { createClient } = require_("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const XLSX = createRequire(join(__dirname, "../../../packages/parsers/package.json"))("xlsx") as typeof import("xlsx");

const DIR = process.env.BACKTEST_DIR ?? "/home/user/backtest-data";
const COGS = process.env.COGS_FILE ?? "202609_Data_COGS_LB_1.xlsx";
const VAL = process.env.VALUATION_FILE ?? "Valuation detail.xls";
const LAST_WEEK = "2026-09-28";
const URL_ = process.env.E2E_SUPA_URL ?? "";
const ANON = process.env.E2E_ANON_KEY ?? "";
if (!URL_ || !ANON) throw new Error("E2E_SUPA_URL / E2E_ANON_KEY kosong: source tests/e2e/stack/env.sh dulu (salinan lokal, bukan KGR-OS)");
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_)) throw new Error(`hanya untuk salinan lokal; ${URL_} bukan localhost`);

// a signed-in Admin session (RLS and the created_by stamps as when Dika clicks in the UI), not the service key
const viewer = { email: process.env.VIEWER_EMAIL ?? "dika.g.irawan@gmail.com", role: "admin" as const, fullName: "Dika" };
const sb = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } }) as never;

// ------------------------------------------------------------------ Valuation detail (SETUP reader)
const n = (v: unknown): Decimal => { const s = parseNumber(v as never); return s === null ? D(0) : D(s); }; // missing-ok: sel kosong laporan Accurate = 0
const dateOr = (v: unknown): string | null => { try { const d = parseDate(v as never); return d && d.startsWith("2026-") ? d : null; } catch { return null; } };
type ValItem = { code: string; name: string; openQty: Decimal; openVal: Decimal; rows: { date: string; qty: Decimal; val: Decimal }[] };
function readValuation(s: Sheet): ValItem[] {
  const items: ValItem[] = []; let cur: ValItem | null = null;
  for (const r of s.rows) {
    const c0 = r[0] === null || r[0] === undefined ? "" : String(r[0]).trim();
    // a block cut by a page break repeats its header (same code, same opening balance): it continues the same item
    if (c0 === "No. Barang") { const code = String(r[4] ?? "").trim(); const seen = items.find((x) => x.code === code); if (seen) { cur = seen; continue; } cur = { code, name: "", openQty: n(r[19]), openVal: D(0), rows: [] }; items.push(cur); continue; }
    if (c0 === "Deskripsi Barang" && cur) { if (!cur.name) { cur.name = String(r[4] ?? "").trim(); cur.openVal = n(r[19]); } continue; }
    const d = c0 ? dateOr(r[0]) : null;
    if (d && cur) cur.rows.push({ date: d, qty: n(r[23]), val: n(r[25]) });
  }
  return items;
}
/** Balance at the end of `day` (after every movement dated ≤ day); the report's opening balance before its first row. */
const closeAt = (it: ValItem, day: string) => { const rs = it.rows.filter((x) => x.date <= day); return rs.length ? rs[rs.length - 1] : { qty: it.openQty, val: it.openVal }; };

function xlsx(rows: (string | number)[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ------------------------------------------------------------------ app path
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let web: any;
const log = (s: string) => console.log(s);

async function weeks() { web.memo.forget(sb, "weeks"); return web.data.listWeeks(sb); }
async function uploadVia(week: { week_start: string }, kind: string, fileName: string, bytes: Uint8Array) {
  const w = (await weeks()).find((x) => x.week_start === week.week_start)!;
  const path = `${w.week_start}/${randomUUID()}/${fileName.replace(/[^\w.\- ]+/g, "_")}`;
  const up = await (sb as ReturnType<typeof createClient>).storage.from("uploads").upload(path, bytes, { contentType: "application/octet-stream" });
  if (up.error) throw new Error(`storage: ${up.error.message}`);
  const st = await web.upload.stageUpload(sb, viewer as never, w, kind as never, path, fileName, {});
  const issues = (st.parse?.issues ?? []).length ? ` · issues: ${st.parse!.issues.join(" | ")}` : "";
  const unm = st.unmappedItems.length ? ` · kode belum dipetakan: ${st.unmappedItems.map((u) => u.code).join(", ")}` : "";
  const settings = await web.memo.appSettingsOf(sb);
  const msg = await web.upload.commitUpload(sb, viewer as never, st.uploadId, settings as never);
  log(`  ${kind} ${fileName} (minggu ${w.week_start}, sha ${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}): ${msg}${issues}${unm}`);
  return st;
}

async function main() {
  web = {
    upload: await import("../../../apps/web/lib/upload.ts"),
    rollover: await import("../../../apps/web/lib/rollover.ts"),
    costing: await import("../../../apps/web/lib/v3/costing.ts"),
    data: await import("../../../apps/web/lib/data.ts"),
    memo: await import("../../../apps/web/lib/request-memo.ts"),
  };
  const login = await (sb as ReturnType<typeof createClient>).auth.signInWithPassword({ email: viewer.email, password: process.env.LOGIN_PASSWORD ?? "" });
  if (login.error) throw new Error(`login ${viewer.email}: ${login.error.message}`);
  if (process.argv[2] === "mirror-gl") {
    // SETUP of the local copy only: the Accurate GL of August and September as KGR-OS holds it (backtest-fs §9: the
    // sheets "Agt 26" and "Sep 26" of the newer FS v2 copy, uploaded into week 24 Aug), through the same upload
    const fs = readWorkbook(readFileSync(join(DIR, process.env.FS_FILE ?? "09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx")), "fs.xlsx");
    for (const name of ["Agt 26", "Sep 26"]) {
      const sh = fs.find((x) => x.name === name)!;
      await uploadVia({ week_start: "2026-08-24" }, "accurate_journal", `GL ${name}.xlsx`, xlsx(sh.rows as (string | number)[][]));
    }
    return;
  }
  const val = readValuation(readWorkbook(readFileSync(join(DIR, VAL)), VAL)[0]);
  log(`Valuation: ${val.length} barang, ${val.reduce((a, i) => a + i.rows.length, 0)} mutasi`);
  const balanceRows = (day: string) => val.map((it) => ({ it, b: closeAt(it, day) })).filter((x) => !x.b.qty.isZero() || !x.b.val.isZero());

  // 1. weeks up to 28 Sep, each with the Monday opening stock (balance at the end of the Sunday before)
  for (;;) {
    const ws = await weeks();
    const latest = ws[0];
    if (latest.week_start >= LAST_WEEK) break;
    const r = await web.rollover.rolloverWeek(sb, latest);
    log(`rollover ${latest.week_start} → ${r.weekStart}: stok dibawa ${r.carried} key, ${r.moved} baris pindah`);
    const day = addDays(r.weekStart, -1);
    const rows = balanceRows(day);
    await uploadVia({ week_start: r.weekStart }, "accurate_stock_balance", `Valuation saldo ${day}.xlsx`,
      xlsx([["Kode Barang", "Nama Barang", "Kuantitas", "Nilai"], ...rows.map(({ it, b }) => [it.code, it.name, Number(b.qty.toFixed(2)), Number(b.val.toFixed(2))])]));
  }

  // 2. COGS LB September (costing_wp), uploaded from the first September week as in the UI
  const cogs = readFileSync(join(DIR, COGS));
  await uploadVia({ week_start: "2026-08-31" }, "costing_wp", COGS, new Uint8Array(cogs));

  // 3. allocation (draft) per September week
  for (const w of (await weeks()).filter((x) => x.week_start >= "2026-08-31").reverse()) {
    const msg = await web.costing.allocateWeek(sb, viewer as never, w);
    log(`alokasi ${w.week_start}: ${msg}`);
  }

  // 4. stock cards (C26) at the month ends
  for (const day of ["2026-08-31", "2026-09-30"]) {
    const rows = balanceRows(day);
    const wk = (await weeks()).find((w) => w.week_start <= day && addDays(w.week_start, 6) >= day)!;
    await uploadVia(wk, "stock_card", `Valuation kartu stok ${day}.xlsx`,
      xlsx([["Tanggal", "Kode Barang", "Nama Barang", "Saldo Kts", "Saldo Nilai"], ...rows.map(({ it, b }) => [day, it.code, it.name, Number(b.qty.toFixed(2)), Number(b.val.toFixed(2))])]));
    const tot = rows.reduce((a, x) => a.plus(x.b.val), D(0));
    log(`  kartu stok ${day}: ${rows.length} barang, Σ nilai ${tot.toFixed(2)}`);
  }
  log("selesai");
}

main().catch((e) => { console.error(e); process.exit(1); });
