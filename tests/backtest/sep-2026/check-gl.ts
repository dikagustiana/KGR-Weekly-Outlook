/**
 * Backtest langkah 1 (PRD v5.2, BT-1): the Accurate GL of a month as the app's upload parser reads it.
 * Source (named, in the repo): reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx, sheet "Agt 26" or "Sep 26"
 * (Accurate "Daftar Histori GL" export inside the FS workbook). Usage: pnpm tsx tests/backtest/sep-2026/check-gl.ts "Sep 26"
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { D } from "@kgr/engine";
import { readWorkbook, parseUpload } from "@kgr/parsers";

const file = join(__dirname, "../../../reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx");
const sheet = process.argv[2] ?? "Sep 26";
const buf = readFileSync(file);
const sheets = readWorkbook(buf, "09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx").filter((s) => s.name === sheet);
if (!sheets.length) throw new Error(`sheet ${sheet} tidak ada`);
const r = parseUpload("accurate_journal", sheets);
const rows = r.sets.flatMap((s) => s.rows);
const dates = rows.map((x) => String(x.date ?? "")).filter(Boolean).sort();
const sumD = rows.reduce((a, x) => a.plus(D(x.debit ?? "0")), D(0)); // missing-ok: blank side of a journal line
const sumC = rows.reduce((a, x) => a.plus(D(x.credit ?? "0")), D(0)); // missing-ok: blank side of a journal line
const byType = new Map<string, number>();
for (const x of rows) byType.set(String(x.voucher_type ?? "-"), (byType.get(String(x.voucher_type ?? "-")) ?? 0) + 1);
console.log(`sumber: ${file.split("/").pop()} sha256 ${createHash("sha256").update(buf).digest("hex")} sheet "${sheet}"`);
console.log(`header baris ${r.detected?.headerRow}: ${r.detected?.columns.filter((c) => c).join(" | ")}`);
console.log(`baris gl_line: ${rows.length}; tanggal ${dates[0]} → ${dates[dates.length - 1]}`);
console.log(`Σ debit ${sumD.toFixed(2)}; Σ kredit ${sumC.toFixed(2)}; selisih ${sumD.minus(sumC).toFixed(2)}`);
console.log(`tipe: ${[...byType].map(([k, n]) => `${k} ${n}`).join(", ")}`);
for (const i of r.issues) console.log(`issue: ${i}`);
