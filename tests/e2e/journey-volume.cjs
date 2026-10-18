#!/usr/bin/env node
"use strict";
// journey volume (PRD v5.2-A R73, B-UI-3, K42): 26 weeks of synthetic data (sql/volume.sql), PostgREST with db-max-rows=1000. What the app
// shows, computed from more than 1.000 rows read through pages of 1.000, is compared with direct SQL aggregates of the same rows.
// Log: out/volume.log, last line "N perbandingan, 0 selisih".
const path = require("node:path");
const { Journey, cfg, short } = require("./lib/e2e.cjs");

const WEEK = "2026-08-24";
const KEY = "RPA|Kepala|Fresh";
const num = (s) => Number(String(s).replace(/\./g, "").replace(",", ".").replace(/−/g, "-"));
let compared = 0, diffs = 0;

(async () => {
  const J = new Journey("volume", "26 minggu data sintetis: total di app (halaman 1.000 baris) = agregat SQL langsung");
  const fin = await J.actor("finance");
  const read = async () => {
    // weekly stock export: sum of jual_order_kg (sales + open orders of the week)
    const r = await fin.ctx.request.get(`${cfg.base}/api/w/${WEEK}/stok.csv`);
    const lines = (await r.text()).replace(/^﻿/, "").split("\n").filter(Boolean);
    const col = lines[0].split(",").indexOf("jual_order_kg");
    let csv = 0; for (const l of lines.slice(1)) csv += Number(l.split(",")[col] || 0);
    // Kontrol C13: the net of the journal ("Selisih")
    await fin.goto(`/w/${WEEK}/kontrol`);
    const k = (await fin.text("main")).split("\n").find((l) => /^13\s/.test(l)) || "";
    const m = /LULUS|GAGAL|PERIKSA|BELUM DIISI/.exec(k);
    const nums = (k.slice(0, m ? m.index : k.length).match(/-?[\d.]+,\d+|-?\d[\d.]*/g) || []).map(num);
    return { csvStatus: r.status(), csv, c13: nums[nums.length - 1] };
  };
  let before;
  await J.step("1", fin, "Finance: pembacaan sebelum data volume (ekspor stok mingguan, Kontrol C13)", async () => {
    J.clock("2026-08-28T17:30:00+07:00");
    await fin.login();
    before = await read();
    J.log(`    finance  sebelum: stok.csv HTTP ${before.csvStatus}, Σ jual_order_kg ${before.csv.toFixed(2)}; C13 selisih jurnal ${before.c13}`);
    J.check("pembacaan sebelum berhasil", before.csvStatus === 200 && Number.isFinite(before.c13));
  });
  await J.step("2", null, "SETUP: sql/volume.sql (26 minggu sintetis)", async () => {
    J.clock("2026-08-28T17:40:00+07:00");
    J.setupFile("volume.sql: 26 minggu sintetis, > 1.000 baris di sales_line, gl_line, lot_balance_daily, pl_daily_v4", path.join(__dirname, "sql/volume.sql"));
    const counts = ["sales_line", "gl_line", "lot_balance_daily", "pl_daily_v4"].map((t) => [t, Number(J.dbOne(`select count(*) from public.${t}`))]);
    J.log(`    DB jumlah baris: ${counts.map(([t, n]) => `${t} ${n}`).join(", ")}; minggu ${J.dbOne("select count(*) from public.week")}`);
    for (const [t, n] of counts) J.check(`${t} > 1.000 baris`, n > 1000, `${n}`);
    J.check("26 minggu sintetis", J.dbOne("select count(*) from public.week where note = 'e2e volume: minggu sintetis'") === "26");
  });
  await J.step("3", fin, "PostgREST membatasi satu permintaan pada 1.000 baris (db-max-rows)", async () => {
    const tok = await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: fin.email, password: cfg.password }) });
    const tj = await tok.json();
    const r = await fetch(`${cfg.supa}/rest/v1/sales_line?select=id`, { headers: { apikey: cfg.anon, authorization: `Bearer ${tj.access_token}`, prefer: "count=exact" } });
    const rows = await r.json();
    const range = r.headers.get("content-range") || "";
    J.log(`    finance (langsung ke PostgREST, bukan lewat app, tanpa halaman)  GET /rest/v1/sales_line?select=id → HTTP ${r.status} ${rows.length} baris, Content-Range ${range}`);
    const total = Number(range.split("/")[1]);
    J.check("satu permintaan mengembalikan tepat 1.000 baris padahal total lebih besar", rows.length === 1000 && total > 1000, `${rows.length} dari ${total}`);
  });
  await J.step("4", fin, "Finance: halaman dan ekspor memuat total dari > 1.000 baris; bandingkan dengan agregat SQL", async () => {
    const after = await read();
    const cmp = (label, app, sql, tol) => {
      compared++;
      const ok = Math.abs(app - sql) <= tol;
      if (!ok) diffs++;
      J.check(`${label}: app = SQL`, ok, `app ${app} · SQL ${sql}${ok ? "" : ` · selisih ${(app - sql).toFixed(4)}`}`);
    };
    // sales_line: 1.100 open PO lines of the fixture week through the weekly stock export
    cmp("sales_line · Σ jual_order_kg stok.csv (naik karena 1.100 baris PO)", Number((after.csv - before.csv).toFixed(2)), Number(J.dbOne("select round(sum(kg), 2) from public.sales_line where document_ref like 'VOL-PO-%'")), 0.01);
    // gl_line: 1.201 lines of the fixture week through the control C13 (net debit − credit)
    cmp("gl_line · selisih jurnal C13 (naik karena 1.201 baris)", Number((after.c13 - before.c13).toFixed(2)), Number(J.dbOne("select round(sum(debit) - sum(credit), 2) from public.gl_line where voucher_no like 'VOL-GL-%'")), 0.01);
    // lot_balance_daily: 1.200 lots of one SKU on 24 Aug through the SKU page (count in the title, Σ kg of the rows)
    await fin.goto(`/sku/${encodeURIComponent(KEY)}?date=2026-08-24`);
    const title = await fin.page.locator("h3, .card h2, .card-title, main").first().innerText().catch(() => "");
    const body = await fin.text("main");
    const cnt = Number((/Lot dengan saldo \((\d+)\)/.exec(body) || [])[1]);
    const kgs = await fin.page.locator("table.t.compact").first().locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[4]?.textContent || ""));
    const sum = kgs.reduce((a, t) => a + num(t), 0);
    void title;
    cmp("lot_balance_daily · jumlah lot SKU di halaman", cnt, Number(J.dbOne(`select count(*) from public.lot_balance_daily where date = '2026-08-24' and key = '${KEY}'`)), 0);
    cmp("lot_balance_daily · Σ kg lot di halaman", Number(sum.toFixed(2)), Number(J.dbOne(`select round(sum(kg), 2) from public.lot_balance_daily where date = '2026-08-24' and key = '${KEY}'`)), 0.01);
    // pl_daily_v4: 1.705 rows of March through the month page (Revenue, actual by journal, Rp jt with one decimal)
    await fin.goto("/m/2026-03");
    const mt = (await fin.text("main")).replace(/\s+/g, " ");
    const rev = (/Laba rugi Maret 2026[\s\S]*?\sRevenue\s+(−?[\d.]+,\d)\s/.exec(mt) || [])[1];
    J.log(`    finance  halaman /m/2026-03: Revenue actual jurnal Rp ${rev} jt`);
    cmp("pl_daily_v4 · Revenue Maret actual (Rp jt) di halaman bulan", num(rev), Number(J.dbOne("select round(sum(actual) / 1e6, 1) from public.pl_daily_v4 where date between '2026-03-01' and '2026-03-31' and basis = 'journal' and pl_line like 'Revenue%'")), 0.051);
    await fin.shot("volume-sku-1200-lot", { fullPage: false });
  });
  J.log("");
  J.log(`volume: ${compared} perbandingan, ${diffs} selisih`);
  J.check("0 selisih antara app dan SQL", diffs === 0 && compared >= 5, `${compared} perbandingan, ${diffs} selisih`);
  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
