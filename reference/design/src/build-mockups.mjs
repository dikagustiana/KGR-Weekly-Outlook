// Writes the mockups of PRD v4 §5.5 (reference/design/*.html) — the HTML files are the spec; this script is only the
// pen. Every number is typed in by hand from the PRD text (its section is named next to it) or, where the PRD gives
// no number, from the golden fixture of that page (marked "fixture"). Nothing is computed by the engine, so the
// screenshot comparison (apps/web/scripts/v4-screens.mjs) compares the spec with the implementation.
//   node reference/design/src/build-mockups.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = "−";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function frame(title, nav, active, body) {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · mockup</title>
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="grammar.css">
<style>html,body{margin:0;padding:0}</style></head>
<body><div class="v4">
<header class="v4-top"><a class="v4-brand" href="#">KGR</a>
<nav class="v4-nav" aria-label="Ruang kerja">${nav.map(([id, l]) => `<a href="#"${id === active ? ' aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>
<span class="note">${esc(title === "Minggu ini" ? "24–30 Agu 2026" : title === "PPIC Rencana" ? "24–30 Agu 2026" : title === "Outlook bulan" ? "Agustus 2026" : "September 2026")}</span>
<div class="v4-user"><span>Direksi · Management</span></div></header>
<main class="v4-main"><h1 class="sr-only">${esc(title)}</h1><div class="tg" role="region" aria-label="${esc(title)}">
${body.join("\n")}
</div></main></div></body></html>
`;
}

// Inner size of a tile at 1366 px: what the chart gets after padding/border 26, header 26 and the note (one line 24, two 40).
const box = (w, h, note = "") => ({ W: Math.round(w * ((1366 - 48 - 132) / 12) + (w - 1) * 12 - 32), H: Math.max(60, h * 76 + (h - 1) * 12 - 52 - (note ? (note.length > 78 ? 42 : 26) : 0)) });

function tile(id, [x, y, w, h], o, inner) {
  const x2 = o.legend || o.cara ? `<span class="tile-x">${o.legend ? legend(o.legend) : ""}${o.cara ? '<button type="button" class="v4b link">cara hitung</button>' : ""}</span>` : "";
  const head = o.title || x2 ? `<div class="tile-h">${o.title ? `<h2 class="tile-t" data-tile-title="">${esc(o.title)}</h2>` : "<span></span>"}${x2}</div>` : "";
  return `<section class="tile${o.kind ? ` ${o.kind}` : ""}" data-tile="${id}" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}" style="grid-column:${x + 1} / span ${w};grid-row:${y + 1} / span ${h}"${o.src ? ` data-src="${o.src}"` : ""}>${head}<div class="tile-b">${inner}</div>${o.note ? `<p class="note" data-tile-note="">${esc(o.note)}</p>` : ""}</section>`;
}

// value "Rp 1.639,0 jt" → number 1.639,0 in --fs-value with the unit "Rp jt" beside it (K16; the card is 2 columns wide)
const card = (value, rows = []) => {
  const m = /^Rp (.+) jt$/.exec(value);
  const num = m ? m[1] : value;
  const v = `<div class="card-n"><div class="card-v${num.startsWith(M) ? " neg" : ""}" data-tile-value="">${esc(num)}</div>${m ? '<span class="card-u">Rp jt</span>' : ""}</div>`;
  return `${v}${rows.length ? `<dl class="card-c">${rows.map(([l, v, t]) => `<div style="display:contents"><dt>${esc(l)}</dt><dd class="${t ?? ""}" data-tile-value="">${esc(v)}</dd></div>`).join("")}</dl>` : ""}`;
};
const missingCard = (text) => `<div class="card-v missing" data-tile-value="">${esc(text)}</div>`;
const seg = (label, opts, cur, hide) => `<nav class="seg${hide ? " nowrap" : ""}" aria-label="${esc(label)}">${hide ? "" : `<span class="seg-l">${esc(label)}</span>`}${opts.map((o) => `<a href="#"${o === cur ? ' aria-current="true"' : ""}>${esc(o)}</a>`).join("")}</nav>`;
const table = (cols, rows, opts = {}) => `<table class="v4t"><thead><tr>${cols.map((c) => `<th${c.n ? ' class="n"' : ""}>${esc(c.l)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => r.span ? `<tr class="sub"><td colspan="${cols.length}">${esc(r.span)}</td></tr>` : `<tr${r.total ? ' class="total"' : ""}>${r.cells.map((v, i) => `<td class="${[cols[i].n ? "n" : "", cols[i].k ? "key" : "", cols[i].s ? "sup" : ""].filter(Boolean).join(" ")}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>${opts.after ?? ""}`;
const list = (items, ordered) => `<${ordered ? "ol" : "ul"} class="note" data-tile-value="">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
const legend = (items) => `<div class="legend">${items.map(([t, l]) => `<span><i class="${t}"></i>${esc(l)}</span>`).join("")}</div>`;

/** Columns (+ optional line) as plain SVG; values in Rp jt. */
function columns(W, H, pts, line) {
  const vals = pts.flatMap((p) => [p.v ?? 0, p.l ?? 0]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
  const min = lo < 0 ? lo - span * 0.12 : lo, max = hi + span * 0.12;
  const t = 20, b = H - 26, y = (v) => t + ((max - v) / (max - min)) * (b - t);
  const slot = (W - 16) / pts.length, bw = Math.min(56, slot * 0.58), cx = (i) => 8 + slot * i + slot / 2;
  const fmt = (v) => (v < 0 ? M : "") + Math.abs(v).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"><line class="axis" x1="8" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}"/>`;
  pts.forEach((p, i) => {
    if (p.v !== null) s += `<rect class="${p.tone ?? "s1"}" x="${cx(i) - bw / 2}" y="${Math.min(y(0), y(p.v))}" width="${bw}" height="${Math.max(1, Math.abs(y(p.v) - y(0)))}" rx="3"/><text class="v${p.v < 0 ? " neg" : ""}" x="${cx(i)}" y="${p.v < 0 ? y(p.v) + 13 : y(p.v) - 5}" text-anchor="middle">${fmt(p.v)}</text>`;
    s += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(p.x)}</text>`;
  });
  if (line) {
    const pl = pts.map((p, i) => (p.l === null || p.l === undefined ? null : `${cx(i)},${y(p.l)}`)).filter(Boolean);
    s += `<polyline class="ln" points="${pl.join(" ")}"/>`;
    pts.forEach((p, i) => { if (p.l !== null && p.l !== undefined) s += `<circle class="dot" cx="${cx(i)}" cy="${y(p.l)}" r="3.5"/><text class="v${p.l < 0 ? " neg" : ""}" x="${cx(i) + 6}" y="${y(p.l) + 15}">${fmt(p.l)}</text>`; });
  }
  return s + "</svg>";
}

function waterfall(W, H, steps) {
  let run = 0;
  const bars = steps.map(([label, v, total]) => { if (total) { run = v; return { label, v, from: 0, to: v, total }; } const from = run; run += v; return { label, v, from, to: run }; });
  const vals = bars.flatMap((b) => [b.from, b.to]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
  const min = lo - span * 0.12, max = hi + span * 0.12, t = 20, b = H - 38, y = (v) => t + ((max - v) / (max - min)) * (b - t);
  const slot = (W - 16) / steps.length, bw = Math.min(54, slot * 0.6), cx = (i) => 8 + slot * i + slot / 2;
  const fmt = (v) => (v < 0 ? M : "") + Math.abs(v).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"><line class="axis" x1="8" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}"/>`;
  bars.forEach((r, i) => {
    const words = r.label.split(" "), mid = Math.ceil(words.length / 2);
    s += `<rect class="${r.total ? "s3" : r.v >= 0 ? "up" : "down"}" x="${cx(i) - bw / 2}" y="${Math.min(y(r.from), y(r.to))}" width="${bw}" height="${Math.max(1, Math.abs(y(r.to) - y(r.from)))}" rx="3"/><text class="v${r.v < 0 ? " neg" : ""}" x="${cx(i)}" y="${Math.min(y(r.from), y(r.to)) - 5}" text-anchor="middle">${fmt(r.v)}</text><text x="${cx(i)}" y="${H - 22}" text-anchor="middle">${esc(words.slice(0, mid).join(" "))}</text><text x="${cx(i)}" y="${H - 9}" text-anchor="middle">${esc(words.slice(mid).join(" "))}</text>`;
  });
  return s + "</svg>";
}

/** Horizontal stacked bars (stock per age bucket), 12 px rows, total at the end of each bar. */
function stacked(W, rows) {
  const lw = Math.min(150, W * 0.32), rw = 70, max = Math.max(...rows.map((r) => r.p.reduce((a, b) => a + b, 0)));
  const x = (v) => (v / max) * (W - lw - rw - 8), rh = 12, H = rows.length * rh + 6, tones = ["s1", "s2", "s3"];
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  rows.forEach((r, i) => {
    const yy = 4 + i * rh; let acc = 0;
    s += `<text x="${lw - 6}" y="${yy + rh / 2 + 4}" text-anchor="end">${esc(r.l)}</text>`;
    r.p.forEach((v, j) => { s += `<rect class="${tones[j]}" x="${lw + x(acc)}" y="${yy + 2}" width="${Math.max(0, x(v))}" height="${Math.max(6, rh - 5)}"/>`; acc += v; });
    s += `<text class="v" x="${lw + x(acc) + 6}" y="${yy + rh / 2 + 4}">${esc(r.t)}</text>`;
  });
  return s + "</svg>";
}
function paired(W, H, groups) {
  const vals = groups.flatMap((g) => [g.a, g.b]), hi = Math.max(0, ...vals) * 1.12, lo = 0, top = 20, bot = H - 26, y = (v) => top + ((hi - v) / (hi - lo)) * (bot - top);
  const slot = (W - 16) / groups.length, bw = Math.min(44, slot * 0.3), cx = (i) => 8 + slot * i + slot / 2;
  const fmt = (v) => v.toLocaleString("id-ID");
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><line class="axis" x1="8" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}"/>`;
  groups.forEach((g, i) => {
    s += `<rect class="s1" x="${cx(i) - bw / 2 - 3 - bw / 2}" y="${y(g.a)}" width="${bw}" height="${y(0) - y(g.a)}" rx="3"/><text class="v" x="${cx(i) - bw - 3}" y="${y(g.a) - 5}" text-anchor="middle">${fmt(g.a)}</text>`;
    s += `<rect class="s3" x="${cx(i) + 3}" y="${y(g.b)}" width="${bw}" height="${y(0) - y(g.b)}" rx="3"/><text class="v" x="${cx(i) + 3 + bw / 2}" y="${y(g.b) - 5}" text-anchor="middle">${fmt(g.b)}</text>`;
    s += `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(g.l)}</text>`;
  });
  return s + "</svg>";
}

const MGMT_NAV = [["minggu-ini", "Minggu ini"], ["outlook-bulan", "Outlook bulan"], ["kas", "Kas & solvabilitas"], ["stok", "Stok"], ["komersial", "Komersial"], ["rilis", "Rilis"]];
const PPIC_NAV = [["rencana", "Rencana"], ["alokasi", "Alokasi hari ini"], ["stok", "Stok"], ["batch", "Batch"], ["upload", "Upload"]];

// ------------------------------------------------------------------------------------------------ §6.1 Minggu ini
const mi = [
  tile("slicer-minggu", [0, 0, 6, 1], { kind: "bare" }, seg("Minggu", ["24–30 Agu", "17–23 Agu"], "24–30 Agu")),
  tile("mode", [6, 0, 3, 1], { kind: "bare" }, seg("Tampilan", ["Aktual s.d. kemarin", "Proyeksi minggu"], "Proyeksi minggu", true)),
  tile("rilis", [9, 0, 3, 1], { kind: "bare" }, `<div class="release"><span data-tile-value="">Belum dirilis, angka draft · 18/20 kontrol lulus · 2 belum diisi</span><a class="v4b" href="#">Unduh PDF</a></div>`),
  // §6.1 headline example (stock and cash numbers as written in the PRD)
  tile("headline", [0, 1, 12, 1], { kind: "bare", src: "prd §6.1" }, `<p class="headline" data-headline="" data-tile-value="">GP P&amp;L minggu ini diproyeksikan Rp ${M}67,5 jt (${M}4,1%); RPA menyumbang Rp ${M}62,6 jt. Stok di atas batas umur Rp 2.782,2 jt, kas Jumat turun ke Rp 289,7 jt.</p>`),
  // §3.4: revenue proyeksi 1.639,0 jt, GP P&L −67,5 jt; Δ vs last week from the weekly P&L (fixture)
  tile("c-outlook", [0, 2, 3, 2], { kind: "card", title: "Outlook minggu", cara: true, src: "prd §3.4" }, card("Rp 1.639,0 jt", [["GP P&L", `${M}67,5 jt (${M}4,1%)`, "neg"], ["Sisa minggu ber-PO", "100%"], ["Δ GP vs minggu lalu", `${M}63,3 jt`, "worse"]])),
  tile("c-stok", [3, 2, 2, 2], { kind: "card", title: "Stok di atas batas umur", cara: true, src: "prd §6.1 + fixture blok 4" }, card("Rp 2.782,2 jt", [["kg", "116.289,8"], ["SKU", "7"]])),
  tile("c-kas", [5, 2, 2, 2], { kind: "card", title: "Kas terendah minggu ini", cara: true, src: "prd §3.7" }, card("Rp 289,7 jt", [["hari", "Jumat 28 Agu"], ["tanpa afiliasi", `${M}910,3 jt`, "neg"]])),
  // Lampiran B.2 (K3): outlook 7.764,1 jt, GP 296,2 jt (3,8%); budget empty
  tile("c-bulan", [7, 2, 2, 2], { kind: "card", title: "Outlook Agustus", src: "prd B.2" }, card("Rp 7.764,1 jt", [["GP P&L", "296,2 jt (3,8%)"], ["vs budget", "belum diisi"]])),
  // FS Aug 2026 (BS K77, K68, K51; PL K51): fixture fs-2026-09
  tile("c-solvabilitas", [9, 2, 3, 2], { kind: "card", title: "Solvabilitas", src: "fixture fs-2026-09 Agu" }, card("Rp 1.612,6 jt", [["ekuitas / modal disetor", "32%"], ["utang pihak berelasi", "5.627,1 jt"], ["bulan sampai ekuitas negatif", "60,8"]])),
  // B.1 journal 24–26 Aug, P2 PO 27–29 Aug; GP per day: fixture
  tile("ch-harian", [0, 4, 7, 4], { kind: "tall", title: "Revenue dan GP P&L per hari Sen–Min", note: "Selasa 25 Agu tanpa jurnal penjualan; dibaca sebagai data hilang, bukan nol, sampai Sales dan Finance memastikan.", src: "prd B.1, P2", legend: [["s1", "aktual (jurnal)"], ["s2", "PO / run-rate"], ["ln", "GP P&L"]] },
    columns(box(7, 4, "x".repeat(100)).W, box(7, 4, "x".repeat(100)).H, [{ x: "Sen 24", v: 226.7, l: 7.7 }, { x: "Sel 25", v: 0, l: -30.4 }, { x: "Rab 26", v: 362.3, l: 23.1 }, { x: "Kam 27", v: 457.8, tone: "s2", l: -7.6 }, { x: "Jum 28", v: 232.1, tone: "s2", l: -0.4 }, { x: "Sab 29", v: 378.0, tone: "s2", l: -56.1 }, { x: "Min 30", v: 0, tone: "s2", l: -3.9 }], true)),
  // §3.4 bridge: −47,6 (blok 1) + 17,8 (B.1) … = −67,5; expedition / blasting / COGS vs HPP: fixture
  tile("ch-bridge", [7, 4, 5, 4], { kind: "tall", title: "Dari GP produk ke GP P&L", cara: true, note: "Selisih 17,8 jt dari timing faktur; ekspedisi dan blasting tidak ada di HPP per key.", src: "prd §3.4, B.1" },
    waterfall(box(5, 4, "x".repeat(80)).W, box(5, 4, "x".repeat(80)).H, [["GP produk", -47.6, true], ["Timing faktur", 17.8], ["COGS vs HPP", -0.8], ["Ekspedisi", -20.6], ["Blasting", -16.4], ["GP P&L", -67.5, true]])),
  // block 1 + block 6 (fixture); trigger line as written in §6.1
  tile("t-segmen", [0, 8, 7, 4], { kind: "tall", title: "GP produk per segmen, proyeksi minggu (Rp jt)", note: `RPA menanggung GP produk Rp ${M}62,6 jt; GP order ${M}52,3 jt dari sisa minggu.`, src: "prd §6.1, fixture blok 1" },
    table([{ l: "Segmen", k: 1 }, { l: "kg", n: 1 }, { l: "Revenue", n: 1 }, { l: "GP aktual", n: 1, s: 1 }, { l: "GP order", n: 1, s: 1 }, { l: "GP produk", n: 1, k: 1 }, { l: "GP %", n: 1 }, { l: "GP/kg lalu", n: 1, s: 1 }, { l: "Δ GP/kg", n: 1 }], [
      { cells: ["RPA", "31.726", "855,6", `${M}10,3`, `${M}52,3`, `${M}62,6`, `${M}7,3%`, `${M}155`, `${M}1.818`] },
      { span: "harga LB rata-rata 23.903 vs breakeven 21.539 Rp/kg" },
      { cells: ["Trading", "32.299", "783,3", "15,2", `${M}0,2`, "15,0", "1,9%", "1.973", `${M}1.508`] },
      { cells: ["Total", "64.025", "1.639,0", "5,0", `${M}52,5`, `${M}47,6`, `${M}2,9%`, "883", `${M}1.626`], total: true },
    ])),
  // PRD v3 §1: COGS/kg 32.721 vs revenue/kg 30.914 (RPA); Trading: fixture
  tile("ch-cogs", [7, 8, 5, 4], { kind: "tall", title: "COGS/kg vs revenue/kg per segmen (Rp/kg)", note: "RPA: COGS/kg 32.721 di atas revenue/kg 30.914.", src: "prd v3 §1, fixture", legend: [["s1", "revenue/kg"], ["s3", "COGS/kg"]] },
    paired(box(5, 4, "x".repeat(40)).W, box(5, 4, "x".repeat(40)).H, [{ l: "RPA", a: 30914, b: 32721 }, { l: "Trading", a: 20930, b: 20101 }])),
  tile("t-input", [0, 12, 6, 4], { kind: "tall", title: "Input minggu ini", src: "fixture" },
    table([{ l: "Input", k: 1 }, { l: "kg", n: 1 }, { l: "Rp/kg", n: 1 }, { l: "Rp jt", n: 1 }, { l: "Catatan", s: 1 }], [
      { cells: ["Live bird aktual", "24.301", "23.903", "580,9", "di atas breakeven"] }, { cells: ["Live bird rencana", "27.219", "25.064", "682,2", ""] },
      { cells: ["Trading Sayap n/a", "6.985", "28.633", "200,0", ""] }, { cells: ["Trading BLP Frozen", "4.002", "49.577", "198,4", "di atas harga jual"] },
      { cells: ["Trading Kulit Frozen", "2.973", "29.577", "87,9", "di atas harga jual"] }, { cells: ["Ekspedisi LB", "", "", "39,0", ""] },
      { cells: ["Maklon / TKL", "", "", "40,4", ""] }, { cells: ["Overhead", "", "", "belum diisi", ""] },
    ])),
  tile("t-cogs", [6, 12, 6, 4], { kind: "tall", title: "COGS dan mutasi persediaan (Rp jt)", src: "fixture" },
    table([{ l: "Baris", k: 1 }, { l: "Minggu lalu", n: 1, s: 1 }, { l: "Aktual", n: 1 }, { l: "Sisa", n: 1 }, { l: "Proyeksi", n: 1, k: 1 }, { l: "Δ", n: 1 }, { l: "Basis sisa", s: 1 }], [
      { cells: ["COGS live bird", `${M}710,7`, `${M}354,2`, `${M}683,9`, `${M}1.038,1`, `${M}327,4`, "order × biaya rata-rata"] },
      { cells: ["COGS trading", `${M}825,9`, `${M}212,8`, `${M}436,5`, `${M}649,2`, "176,7", "order × biaya rata-rata"] },
      { cells: ["Ekspedisi", `${M}29,0`, `${M}17,0`, `${M}3,6`, `${M}20,6`, "8,4", "run-rate"] },
      { cells: ["Blasting", `${M}10,9`, `${M}4,5`, `${M}11,8`, `${M}16,4`, `${M}5,5`, "run-rate"] },
      { cells: ["Total COGS", `${M}1.576,5`, `${M}588,5`, `${M}1.135,8`, `${M}1.724,3`, `${M}147,8`, ""], total: true },
    ])),
  tile("ch-stok-umur", [0, 16, 6, 4], { kind: "tall", title: "Stok per umur, 7 SKU dengan nilai terbesar", src: "fixture ledger", legend: [["s1", "0–7 hari"], ["s2", "8–30 hari"], ["s3", "> 30 hari"]] },
    stacked(box(6, 1).W, [
      { l: "Karkas n/a", p: [0, 46777, 53], t: "46.830 kg" }, { l: "Karkas Frozen", p: [8348, 14121, 4020], t: "26.490 kg" }, { l: "Karkas Fresh", p: [13810, 4959, 0], t: "18.768 kg" },
      { l: "BLP Frozen", p: [10141, 0, 0], t: "10.141 kg" }, { l: "KRK (Kerangka) n/a", p: [0, 25815, 0], t: "25.815 kg" }, { l: "BLD Frozen", p: [0, 4848, 0], t: "4.848 kg" }, { l: "Kulit Frozen", p: [2973, 0, 1095], t: "4.067 kg" },
    ])
    + table([{ l: "SKU", k: 1 }, { l: "kg", n: 1 }, { l: "Rp jt", n: 1 }, { l: "Umur", n: 1 }, { l: "Order sisa kg", n: 1 }, { l: "Biaya/kg", n: 1, s: 1 }, { l: "Harga acuan", n: 1, s: 1 }], [
      { cells: ["Karkas n/a", "46.830", "1.407,4", "56", "7.008", "30.053", "31.277"] }, { cells: ["Karkas Frozen", "26.490", "921,3", "57", "4.228", "34.781", "31.658"] },
      { cells: ["Karkas Fresh", "18.768", "702,1", "19", "12.307", "37.411", "36.705"] }, { cells: ["BLP Frozen", "10.141", "478,6", "6", "3.229", "47.199", "43.086"] },
      { cells: ["KRK (Kerangka) n/a", "25.815", "266,2", "12", "6.011", "10.311", "10.903"] }, { cells: ["BLD Frozen", "4.848", "189,6", "11", "0", "39.097", "42.083"] },
      { cells: ["Kulit Frozen", "4.067", "107,3", "53", "105", "26.381", "29.000"] },
    ])),
  tile("kas", [6, 16, 6, 4], { kind: "tall", title: "Kas harian aktual vs rencana (Rp jt)", note: "Saldo awal minggu Rp 379,1 jt.", src: "fixture arus kas", legend: [["s1", "aktual"], ["s2", "rencana"]] },
    columns(box(6, 1).W, 84, [{ x: "Sen 24", v: 555.0 }, { x: "Sel 25", v: 652.0 }, { x: "Rab 26", v: 1289.3 }, { x: "Kam 27", v: 1348.9, tone: "s2" }, { x: "Jum 28", v: 289.7, tone: "s2" }, { x: "Sab 29", v: 818.2, tone: "s2" }, { x: "Min 30", v: 818.2, tone: "s2" }])
    + table([{ l: "Arus kas", k: 1 }, { l: "Minggu lalu", n: 1, s: 1 }, { l: "Proyeksi", n: 1 }], [
      { cells: ["Penerimaan pelanggan", "1.602,9", "1.872,9"] }, { cells: ["Bayar pemasok", `${M}2.131,3`, `${M}1.325,0`] }, { cells: ["Bayar jasa", `${M}231,0`, `${M}1.229,0`] },
      { cells: ["Karyawan dan lain-lain", `${M}25,9`, `${M}79,9`] }, { cells: ["Pinjaman afiliasi net", "0,0", "1.200,0"] }, { cells: ["Arus kas bersih", `${M}785,3`, "439,1"], total: true },
    ])),
  tile("t-trading", [0, 20, 6, 3], { title: "Spread trading per SKU dengan order sisa minggu", note: "23 SKU tanpa order minggu ini sebaiknya dijual (stok Rp 333,3 jt).", src: "fixture blok 3" },
    table([{ l: "SKU", k: 1 }, { l: "Harga jual", n: 1 }, { l: "Biaya stok", n: 1, s: 1 }, { l: "Selisih/kg", n: 1 }, { l: "GP order Rp jt", n: 1, k: 1 }], [
      { cells: ["BLP Frozen", "43.086", "47.199", `${M}4.113`, `${M}13,3`] }, { cells: ["KRK (Kerangka) n/a", "10.903", "10.311", "592", "3,6"] },
      { cells: ["Karkas n/a", "31.277", "30.065", "1.212", "8,5"] }, { cells: ["Kulit Frozen", "29.000", "26.381", "2.619", "0,3"] }, { cells: ["Sayap n/a", "31.000", "28.633", "2.367", "0,7"] },
    ])),
  tile("demand", [6, 20, 3, 3], { title: "Demand dan rencana potong", src: "prd B.3" },
    table([{ l: "", k: 1 }, { l: "kg / ekor", n: 1 }], [
      { cells: ["PO pasti", "40.437"] }, { cells: ["PO tentatif", "0"] }, { cells: ["Forecast", "0"] }, { cells: ["Kebutuhan potong", "13.118"] },
      { cells: ["Rencana potong (ekor)", "9.179"], total: true },
    ])),
  tile("peringatan", [9, 20, 3, 3], { title: "Peringatan", src: "fixture blok 7" }, list(["Peringatan: Shrink aktual minggu ini 6,3% di atas target 3,0%", "Kontrol 8 belum diisi: kg penjualan aktual minggu ini = laporan Accurate", "Kontrol 9 belum diisi: Nilai stok awal = Inventory Valuation Accurate"])),
  tile("catatan", [0, 23, 12, 1], { kind: "bare" }, list(["GP produk = revenue DO dan order dikurangi HPP per key. GP P&L = revenue jurnal dikurangi semua akun COGS yang dipetakan, termasuk ekspedisi dan blasting.", "Stok di atas batas umur memakai batas umur per SKU; nilai pada biaya rata-rata.", "Kas rencana mengikuti termin pembayaran di parameter minggu ini."], true)),
];
writeFileSync(join(dir, "minggu-ini.html"), frame("Minggu ini", MGMT_NAV, "minggu-ini", mi));

// ------------------------------------------------------------------------------------------------ §6.2 Outlook bulan
// Lampiran B.2 / §3.2 (K3): actual 1–26 Agu 6.385,9 / GP 347,4; PO 27–29 1.067,8 (40.437 kg); run-rate 31 Agu 310,4;
// forecast 1.378,2; GP forecast ≈ −51,2; outlook 7.764,1 (7.626,3–7.902,0), GP 296,2 (3,8%). P13: V1 7.712,4 vs
// final 8.361,8. Solvency: FS Sep 2026 (§1.1).
const ob = [
  tile("slicer-bulan", [0, 0, 6, 1], { kind: "bare" }, seg("Bulan", ["Agustus 2026", "September 2026"], "Agustus 2026") + `<span class="note" data-tile-value="">belum ada versi terkunci · cut-off 26 Agu</span>`),
  tile("rilis", [9, 0, 3, 1], { kind: "bare" }, `<div class="release"><span data-tile-value="">versi aktif: draft</span><a class="v4b" href="#">Unduh PDF</a></div>`),
  tile("headline", [0, 1, 12, 1], { kind: "bare", src: "prd §6.2, B.2" }, `<p class="headline" data-tile-value="">Revenue Agustus diproyeksikan Rp 7.764,1 jt, GP P&amp;L Rp 296,2 jt (3,8%); sisa bulan 77% ber-PO.</p>`),
  tile("c-actual", [0, 2, 2, 2], { kind: "card", title: "Actual s.d. 26 Agu", cara: true }, card("Rp 6.385,9 jt", [["GP P&L", "347,4 jt"]])),
  tile("c-forecast", [2, 2, 2, 2], { kind: "card", title: "Forecast sisa bulan", cara: true }, card("Rp 1.378,2 jt", [["GP P&L", `${M}51,2 jt`, "neg"], ["porsi run-rate", "23%"]])),
  tile("c-outlook", [4, 2, 3, 2], { kind: "card", title: "Outlook Agustus", cara: true }, card("Rp 7.764,1 jt", [["rentang", "7.626,3–7.902,0"], ["GP P&L", "296,2 jt (3,8%)"], ["NIBT", "belum diisi"]])),
  tile("c-po", [7, 2, 2, 2], { kind: "card", title: "Sisa bulan ber-PO" }, card("77%", [["kg", "40.437"]])),
  tile("c-budget", [9, 2, 3, 2], { kind: "card", title: "vs Budget" }, missingCard("budget belum diisi")),
  tile("ch-harian", [0, 4, 7, 4], { kind: "tall", title: "Revenue per hari Agustus: aktual, PO, run-rate", note: "25 Agu tanpa jurnal dan tanpa baris penjualan; dikeluarkan dari run-rate sebagai hari anomali.", src: "prd B.2 (20–31 Agu)", legend: [["s1", "aktual (jurnal)"], ["s2", "PO"], ["s3", "run-rate"]] },
    columns(box(7, 4, "x".repeat(90)).W, box(7, 4, "x".repeat(90)).H, [{ x: "20", v: 301.4 }, { x: "21", v: 579.3 }, { x: "22", v: 82.3 }, { x: "23", v: 0 }, { x: "24", v: 226.7 }, { x: "25", v: 0 }, { x: "26", v: 362.3 }, { x: "27", v: 457.8, tone: "s2" }, { x: "28", v: 232.1, tone: "s2" }, { x: "29", v: 378.0, tone: "s2" }, { x: "30", v: 0, tone: "s2" }, { x: "31", v: 310.4, tone: "s3" }])),
  tile("t-sisa", [7, 4, 5, 4], { kind: "tall", title: "Hari sisa bulan (Rp jt)" },
    table([{ l: "Tanggal", k: 1 }, { l: "Dasar", s: 1 }, { l: "Revenue", n: 1 }], [
      { cells: ["Kam 27 Agu", "PO", "457,8"] }, { cells: ["Jum 28 Agu", "PO", "232,1"] }, { cells: ["Sab 29 Agu", "PO", "378,0"] },
      { cells: ["Min 30 Agu", "tidak ada pengiriman", "0,0"] }, { cells: ["Sen 31 Agu", "run-rate 7 hari", "310,4"] }, { cells: ["Total", "", "1.378,2"], total: true },
    ])),
  tile("ch-kumulatif", [0, 8, 8, 4], { kind: "tall", title: "Revenue kumulatif Agustus: actual dan outlook", note: "Band ±10% hanya pada porsi forecast: 7.626,3–7.902,0 jt." },
    columns(845, 252, [{ x: "MTD 26 Agu", v: 6385.9 }, { x: "Outlook", v: 7764.1, tone: "s2" }, { x: "Rendah", v: 7626.3, tone: "s3" }, { x: "Tinggi", v: 7902.0, tone: "s3" }])),
  tile("register", [8, 8, 4, 4], { kind: "tall", title: "Register asumsi" },
    table([{ l: "Asumsi", k: 1 }, { l: "Nilai", n: 1 }, { l: "Pemilik", s: 1 }, { l: "Disepakati", s: 1 }], [
      { cells: ["Run-rate 31 Agu (7 hari tanpa anomali)", "310,4 jt", "Group Project Finance", "ditetapkan K3"] },
      { cells: ["25 Agu revenue 0", "anomali", "Finance + Sales", "belum disepakati"] },
      { cells: ["Margin acuan hari run-rate", "5,4%", "Finance", "belum disepakati"] },
      { cells: ["Toleransi forecast", "10%", "Group Project Finance", "ditetapkan K9"] },
    ])),
  tile("ch-bridge", [0, 12, 7, 4], { kind: "tall", title: "Dari V1 ke V2" }, `<p class="note" data-tile-value="">V2 belum ada.</p>`),
  tile("t-versi", [7, 12, 5, 4], { kind: "tall", title: "Versi" }, table([{ l: "Versi", k: 1 }, { l: "Cut-off" }, { l: "Revenue", n: 1 }, { l: "GP", n: 1 }, { l: "NIBT", n: 1 }], [{ cells: ["belum ada versi terkunci", "", "", "", ""] }])),
  tile("akurasi", [0, 16, 6, 3], { title: "Akurasi bulan terakhir yang FINAL", note: "Selisih terbesar dari penyesuaian tutup buku (revenue belum difaktur, revaluasi COGS unbilled).", src: "prd P13, fixture accuracy-2026-08" },
    table([{ l: "", k: 1 }, { l: "V1", n: 1 }, { l: "FINAL", n: 1 }, { l: "Selisih", n: 1 }], [
      { cells: ["Revenue", "7.712,4", "8.361,8", "649,4 (8,4%)"] }, { cells: ["GP P&L", "293,4", "306,7", "13,3"] },
    ])),
  tile("solvabilitas", [6, 16, 6, 3], { title: "Solvabilitas September 2026", src: "prd §1.1" },
    table([{ l: "", k: 1 }, { l: "Rp jt", n: 1 }], [
      { cells: ["Ekuitas (14% modal disetor)", "702,6"] }, { cells: ["Utang pihak berelasi", "9.845,9"] }, { cells: ["Bunga bulan ini", "54,0"] },
      { cells: ["Kas", "103,0"] }, { cells: ["Bulan sampai ekuitas negatif", "0,8"] },
    ])),
];
writeFileSync(join(dir, "outlook-bulan.html"), frame("Outlook bulan", MGMT_NAV, "outlook-bulan", ob));

// ------------------------------------------------------------------------------------------------ §6.3 Kas & solvabilitas
const ks = [
  tile("headline", [0, 0, 12, 1], { kind: "bare", src: "prd §1.1, §3.7" }, `<p class="headline" data-tile-value="">Kas Rp 103,0 jt per 30 Sep 2026; ekuitas Rp 702,6 jt habis dalam 0,8 bulan bila rugi September berulang.</p>`),
  tile("c-saldo", [0, 1, 2, 2], { kind: "card", title: "Saldo kas 30 Sep" }, card("Rp 103,0 jt")),
  tile("c-terendah", [2, 1, 3, 2], { kind: "card", title: "Terendah 13 minggu" }, missingCard("tidak tersedia")),
  tile("c-afiliasi", [5, 1, 3, 2], { kind: "card", title: "Utang pihak berelasi" }, card("Rp 9.845,9 jt", [["naik dari Agustus", "4.218,8 jt", "worse"], ["bunga September", "54,0 jt"]])),
  tile("c-ekuitas", [8, 1, 2, 2], { kind: "card", title: "Ekuitas" }, card("Rp 702,6 jt", [["modal disetor", "14%"]])),
  tile("c-bulan-negatif", [10, 1, 2, 2], { kind: "card", title: "Bulan sampai ekuitas negatif" }, card("0,8")),
  tile("ch-13minggu", [0, 3, 7, 4], { kind: "tall", title: "Saldo akhir per minggu, 13 minggu" }, `<p class="note" data-tile-value="">tidak ada data untuk periode ini</p>`),
  tile("t-rekening", [7, 3, 5, 4], { kind: "tall", title: "Saldo per rekening" }, `<p class="note" data-tile-value="">tidak ada data untuk periode ini</p>`),
  tile("ch-12bulan", [0, 7, 6, 4], { kind: "tall", title: "Kas 12 bulan" }, `<p class="note" data-tile-value="">tidak tersedia: outlook bulanan belum menjadi basis</p>`),
  tile("ccc", [6, 7, 6, 4], { kind: "tall", title: "Siklus kas", src: "prd §1.1" }, table([{ l: "", k: 1 }, { l: "Agustus", n: 1 }, { l: "September", n: 1 }], [{ cells: ["DIO (hari)", "14", "36"] }, { cells: ["Persediaan Rp jt", "3.532,6", "6.652,4"] }])),
  tile("t-arus", [0, 11, 12, 4], { kind: "tall", title: "Arus kas operasi vs pendanaan afiliasi, minggu 24–30 Agu (Rp jt)", src: "prd §3.7" },
    table([{ l: "", k: 1 }, { l: "Proyeksi", n: 1 }], [{ cells: ["Saldo terendah (Jum 28 Agu) termasuk pinjaman afiliasi", "289,7"] }, { cells: ["Pinjaman afiliasi", "1.200,0"] }, { cells: ["Saldo terendah tanpa pinjaman", `${M}910,3`] }, { cells: ["Bayar jasa proyeksi", "1.229,0"] }])),
];
writeFileSync(join(dir, "kas-solvabilitas.html"), frame("Kas & solvabilitas", MGMT_NAV, "kas", ks));

// ------------------------------------------------------------------------------------------------ §6.4 PPIC Rencana
// Lampiran B.3 dry run (yield placeholder, STD 2,0 kg): Karkas 13.118 kg → 9.179 ekor (binding); by-products do not
// decide the head count; shortfall HJA 1.022, Usus 897, Kepala 842, Ceker 548 kg.
const pr = [
  tile("stepper", [0, 0, 12, 1], { kind: "bare" }, `<ol class="stepper" aria-label="Langkah"><li class="step" aria-current="step"><span class="n">Langkah 1</span><span>Demand</span><span class="s">PERIKSA: by-product kurang</span></li><li class="step"><span class="n">Langkah 2</span><span>Rencana mingguan</span><span class="s">yield sementara</span></li><li class="step"><span class="n">Langkah 3</span><span>Rencana harian</span><span class="s">kapasitas belum diisi</span></li><li class="step"><span class="n">Langkah 4</span><span>Alokasi</span><span class="s">selesaikan langkah 3 dulu</span></li></ol>`),
  tile("t-demand", [0, 1, 8, 5], { kind: "tall", title: "Langkah 1: demand per SKU, minggu 24–30 Agu", src: "prd B.3" },
    table([{ l: "Unit", k: 1 }, { l: "Net kg", n: 1 }, { l: "kg/ekor", n: 1 }, { l: "Ekor", n: 1, k: 1 }, { l: "Kurang kg", n: 1 }, { l: "Saran", s: 1 }], [
      { cells: ["Karkas (binding)", "13.118", "1,4292", "9.179", "", ""] },
      { cells: ["HJA", "2.019", "0,1086", "tidak menentukan ekor", "1.022", "beli trading"] },
      { cells: ["Kepala", "1.674", "0,0906", "tidak menentukan ekor", "842", "beli trading"] },
      { cells: ["Ceker", "1.071", "0,0570", "tidak menentukan ekor", "548", "beli trading"] },
      { cells: ["Usus", "1.673", "0,0846", "tidak menentukan ekor", "897", "beli trading"] },
    ])),
  tile("ch-ekor", [8, 1, 4, 5], { kind: "tall", title: "Ekor per produk utama", note: "By-product ditampilkan abu-abu: tidak menentukan ekor." },
    columns(392, 330, [{ x: "Karkas", v: 9179 }, { x: "HJA", v: 18588, tone: "s3" }, { x: "Kepala", v: 18478, tone: "s3" }, { x: "Ceker", v: 18778, tone: "s3" }, { x: "Usus", v: 19778, tone: "s3" }])),
  tile("t-rencana", [0, 6, 8, 4], { kind: "tall", title: "Langkah 2: rencana mingguan versi 1" },
    table([{ l: "", k: 1 }, { l: "Nilai", n: 1 }], [{ cells: ["Ekor", "9.179"] }, { cells: ["kg live bird (STD 2,0 kg)", "18.358"] }, { cells: ["Yield", "sementara (placeholder)"] }, { cells: ["Perlu approval", "tidak"] }])
    + `<div class="actionbar"><span class="v4b primary">Simpan rencana versi 1</span><span class="reason">yield sementara: boleh disimpan, tidak boleh disalin ke batch</span></div>`),
  tile("ekonomi", [8, 6, 4, 4], { kind: "tall", title: "Ekonomi rencana", src: "fixture blok 2" },
    table([{ l: "", k: 1 }, { l: "Rp/kg", n: 1 }], [{ cells: ["Harga LB hari ini", "24.600"] }, { cells: ["Breakeven porsi fresh rencana", "20.726"] }, { cells: ["Margin per kg LB", `${M}3.874`] }, { cells: ["Aksi", "Negosiasi ≤ Rp 20.726"] }])),
  tile("t-harian", [0, 10, 12, 4], { kind: "tall", title: "Langkah 3: rencana harian" },
    table([{ l: "Tanggal", k: 1 }, { l: "Ekor", n: 1 }, { l: "Kapasitas", n: 1 }, { l: "LB supply", n: 1 }, { l: "Status", s: 1 }], [{ cells: ["Rab 26 Agu", "", "belum diisi", "", "belum diisi"] }])
    + `<div class="actionbar"><span class="v4b" aria-disabled="true">Salin ke batch rencana</span><span class="reason">C42 yield sementara, C47 kapasitas belum diisi</span></div>`),
];
writeFileSync(join(dir, "ppic-rencana.html"), frame("PPIC Rencana", PPIC_NAV, "rencana", pr));
console.log("mockups: minggu-ini.html, outlook-bulan.html, kas-solvabilitas.html, ppic-rencana.html");
