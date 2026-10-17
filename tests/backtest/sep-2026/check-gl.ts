import { readFileSync } from "node:fs";
import { D } from "@kgr/engine";
import { readWorkbook, parseUpload } from "@kgr/parsers";

const dir = process.env.BACKTEST_DIR || "C:\\Users\\USER\\Downloads\\Back test";
const f = `${dir}\\GL KGR Rev 1.xls`;
const buf = readFileSync(f);
const sheets = readWorkbook(buf, "GL KGR Rev 1.xls");
const r = parseUpload("accurate_journal", sheets);

console.log("detected:", r.detected ? `headerRow=${r.detected.headerRow} columns=${r.detected.columns.filter((c) => c).join(", ")}` : "NULL");
console.log("sets:", r.sets.map((s) => `${s.target}: ${s.rows.length} baris`).join("; "));
const rows = r.sets.flatMap((s) => s.rows);
const dates = rows.map((x) => String(x.date ?? "")).filter(Boolean).sort();
const sumD = rows.reduce((a, x) => a.plus(D(x.debit ?? "0")), D(0));
const sumC = rows.reduce((a, x) => a.plus(D(x.credit ?? "0")), D(0));
const net = sumD.minus(sumC);
console.log("rows:", rows.length, "tanggal:", dates[0], "→", dates[dates.length - 1]);
console.log("Σ debit:", sumD.toFixed(2), "Σ kredit:", sumC.toFixed(2), "selisih:", net.toFixed(2));
console.log("issues (sampel 5):", r.issues.slice(0, 5));
const bad = rows.filter((x) => (x.debit == null && x.credit == null) || !x.account).length;
console.log("baris tanpa debit+credit atau tanpa akun:", bad);
