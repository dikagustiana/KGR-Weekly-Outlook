/**
 * Berkas unggah jurnal Accurate per bulan dari sheet GL di FS v2 ("Agt 26", "Sep 26"): baris header + baris bertanggal, apa adanya
 * (SIAP-PAKAI §4b). Ditulis ke BACKTEST_DIR/out (tidak di-commit) dan dicek ulang lewat parser upload app: Σ debit/kredit per akun = TB.
 * Pakai: pnpm tsx tests/backtest/fs-2026/make-gl-files.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { D } from "@kgr/engine";
import { readWorkbook, parseUpload, parseDate } from "@kgr/parsers";

const DIR = process.env.BACKTEST_DIR ?? "/home/user/backtest-data";
const FS = join(DIR, "09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx");
const OUT = join(DIR, "out"); mkdirSync(OUT, { recursive: true });
const sheets = readWorkbook(readFileSync(FS), "fs.xlsx");
for (const [sheet, name] of [["Agt 26", "GL-Accurate-Agustus-2026.xlsx"], ["Sep 26", "GL-Accurate-September-2026.xlsx"]] as const) {
  const src = sheets.filter((s) => s.name === sheet);
  const r = parseUpload("accurate_journal", src);
  const hdr = (r.detected?.headerRow ?? 1) - 1;
  const dateCol = src[0].rows[hdr].findIndex((c) => /^tanggal( jurnal)?$/i.test(String(c ?? "").trim()));
  const isDate = (v: unknown) => { try { return !!parseDate(v as never); } catch { return false; } };
  const rows = [src[0].rows[hdr], ...src[0].rows.slice(hdr + 1).filter((row) => isDate(row[dateCol]))];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "GL");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(join(OUT, name), buf);
  const back = parseUpload("accurate_journal", readWorkbook(buf, name));
  const lines = back.sets.flatMap((s) => s.rows);
  const dr = lines.reduce((a, x) => a.plus(D(String(x.debit ?? "0"))), D(0)), cr = lines.reduce((a, x) => a.plus(D(String(x.credit ?? "0"))), D(0)); // missing-ok: sisi kosong baris jurnal
  const ds = lines.map((x) => String(x.date)).sort();
  console.log(`${name}: ${lines.length} baris, ${ds[0]} → ${ds[ds.length - 1]}, Σ debit ${dr.toFixed(2)}, Σ kredit ${cr.toFixed(2)}, issues ${back.issues.length}, sha256 ${createHash("sha256").update(buf).digest("hex").slice(0, 16)}`);
}
