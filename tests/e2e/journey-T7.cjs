#!/usr/bin/env node
"use strict";
// journey T7 (PRD v5.2-A R71, T14): one weekly loop of the fixture week 24-30 Aug 2026, with the clock moving forward
// from Thursday 27 Aug 09:30 to the release on Friday 28 Aug 16:40, nine roles of the weekly loop and no Admin:
//   (1) Sales drafts the commitment of next week          (2) the commercial lead locks it (Friday 16.00)
//   (3) PPIC saves the class plan, copies it to batches   (4) Direktur Operasional decides the LB price
//   (5) Cost Accounting uploads the WP (H+1 11.00)        (6) invoice + posting
//   (7) Commercial shows the new cost                     (8) the K35 grid is green
//   (9) Finance releases without override, v4_release on
// Steps run in the order of the clock, not of the numbers above (the lock is on Friday, the plan is copied on Thursday:
// the copy needs the LB price of the cut dates that are still ahead, C57). Everything the app has an upload path for is done
// through that path by the role that owns the input; the rest is `week-complete.sql` and labelled setup in the log.
// Steps that wait for code still being finished on another branch are marked XFAIL with the R they wait for (they do not fail the job;
// an XPASS means the R is in and the marker goes). On main at b408a9a (A1, A1b, A2, A3, A4, B2, B5) R52, R54 and R60 are in: those three
// steps are plain checks now, T7 has no XFAIL left.
const path = require("node:path");
const { Journey, cfg, short, sleep } = require("./lib/e2e.cjs");

const WEEK = "2026-08-24";
const NEXT = "2026-08-31";
const BATCH = "126/PO/KGR/08/2026"; // actual batch of Wed 26 Aug: its WP is due Thu 27 Aug 12.00
const PI = { no: "PI26080085", date: "2026-08-26", value: "327933293.00" }; // the supplier invoice of that batch in the GL fixture
const idNum = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const parseId = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));

// The queue the role actions leave (ledger balances roll forward: more than the 7 dates an action does inline) holds C45 until it is drained.
// Finance's "Perbarui status tugas" drains it with a session. (The nightly route /api/cron/rebuild is covered by journey F19: its rebuild runs
// without a session and writes a different P&L forecast and no solvency, see docs/v5.2/a5.md Q-v5.2-51; so T7 does not use it.)
async function drain(J, finance, why) {
  // what is held is a queued date up to today (the refresh builds up to the wall date; later dates wait for their day)
  const open = () => Number(J.dbOne(`select count(*) from public.rebuild_queue where status in ('queued','running','failed') and date <= '${J.now().slice(0, 10)}'`));
  for (let i = 1; i <= 5; i++) {
    const left = open();
    if (left === 0) { J.log(`    antrean rebuild kosong (${why})`); return; }
    J.log(`    antrean rebuild: ${left} tanggal (${why}); Finance: Input → Perbarui status tugas, putaran ${i}`);
    await finance.goto("/input?panel=grid");
    await finance.act("Perbarui status tugas");
  }
  J.check(`antrean rebuild terkuras (${why})`, open() === 0);
}

(async () => {
  const J = new Journey("T7", "satu putaran mingguan utuh (minggu 24–30 Agu 2026, jam uji maju Kam 27 Agu → Jum 28 Agu)");
  const A = {};
  for (const r of ["sales", "commercial_lead", "ppic", "operations_director", "cost_accounting", "inventory_accounting", "purchasing", "finance", "management"]) A[r] = await J.actor(r);

  // ---------------------------------------------------------------------------------------------------------- 0 setup
  await J.step("0", null, "SETUP: jam uji Kamis 27 Agu 09.00, week-complete.sql (riwayat Sen–Rab dan master tanpa editor), antrean rebuild", async () => {
    J.clock("2026-08-27T09:00:00+07:00");
    J.setupFile("week-complete.sql: master kelas berat dan peta ukuran, mart minggu sebelumnya, riwayat keputusan LB 25–27/08, kartu stok 24–28, jurnal 27–28, PO dan alokasi 24–26", path.join(__dirname, "sql/week-complete.sql"));
    for (const a of Object.values(A)) await a.login();
    await drain(J, A.finance, "setelah SETUP");
    J.log(`    DB flag v4_release: ${J.dbOne("select value ->> 'enabled' from public.app_setting where key = 'v4_release'")} (ketat, seperti KGR-OS)`);
    J.check("sembilan role non-admin masuk", Object.values(A).every((a) => a.loggedIn), Object.keys(A).join(", "));
  });

  // ---------------------------------------------------------------------------------------------- 1 Sales drafts
  await J.step("1", A.sales, "Sales: draft komitmen minggu depan (31 Agu), hanya SKU yang ditugaskan", async () => {
    J.clock("2026-08-27T09:30:00+07:00");
    const s = await A.sales.goto("/komersial");
    J.check("Komersial terbuka untuk Sales", s === 200, `HTTP ${s}`);
    const rows = await A.sales.page.locator('input[name^="fresh_"]').count();
    J.check("Sales hanya melihat satu baris komitmen (assignment RPA|Karkas)", rows === 1, `${rows} baris`);
    await A.sales.page.locator('input[name="fresh_0"]').fill("15000");
    await A.sales.page.locator('input[name="frozen_0"]').fill("2000");
    await A.sales.page.locator('input[name="price_0"]').fill("36705");
    const m = await A.sales.act("Simpan draft");
    J.log(`    sales  ${short(m.ok || m.error || "", 200)}`);
    J.check("draft komitmen tersimpan", !!m.ok && /draft/.test(m.ok), m.ok || m.error || "");
    J.log(`    DB komitmen ${NEXT}: ${J.db(`select key, version, status, fresh_kg, frozen_kg, created_by from public.sales_commitment where week_start = '${NEXT}' order by key, version`).map((r) => r.join(" ")).join("; ")}`);
    J.check("DB: komitmen draft oleh sales", J.dbOne(`select count(*) from public.sales_commitment where week_start = '${NEXT}' and status = 'draft' and created_by = 'sales@${cfg.domain}'`) === "1");
    const lockBtn = await A.sales.page.getByRole("button", { name: "Kunci komitmen dan price list" }).count();
    J.check("Sales tidak punya tombol kunci", lockBtn === 0);
    await A.sales.shot("T7-1-sales-draft");
  });

  await J.step("1b", A.sales, "Sales: harga acuan Lemak Fresh (layar Harga, jalur app)", async () => {
    J.clock("2026-08-27T09:35:00+07:00");
    const s = await A.sales.goto(`/w/${WEEK}/input/harga`);
    J.check("layar Harga terbuka untuk Sales", s === 200, `HTTP ${s}`);
    await A.sales.page.locator('input[name="sell:RPA|Lemak|Fresh"]').fill("26000");
    await A.sales.page.getByRole("button", { name: /Simpan/ }).first().click();
    await A.sales.page.waitForLoadState("networkidle").catch(() => {});
    await sleep(500);
    const p = J.dbOne(`select ref_sell_price from public.sku_price p join public.week w on w.id = p.week_id where w.week_start = '${WEEK}' and p.key = 'RPA|Lemak|Fresh'`);
    J.log(`    DB sku_price Lemak Fresh: ${p}`);
    J.check("harga acuan Lemak Fresh tersimpan (C46, K50)", Number(p) === 26000, `harga ${p}`);
  });

  await J.step("1c", A.sales, "Sales: upload PO (tempel): baris sah tersimpan; pelanggan lain, tanggal lewat dan kode tak dikenal ditahan", async () => {
    J.clock("2026-08-27T09:38:00+07:00");
    const po = [["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan"],
      ["KGR26.E2E01", "2026-08-29", "JLB0922", 250, 60000, "PT A"], ["KGR26.E2E02", "2026-08-29", "JLB1857", 300, 60000, "PT A"], ["KGR26.E2E03", "2026-08-29", "JLB0829", 100, 60000, "PT Lain"],
      ["KGR26.E2E04", "2026-08-26", "JLB0763", 120, 60000, "PT A"], ["KGR26.E2E05", "2026-08-30", "X-999", 50, 60000, "PT A"]];
    const r = await A.sales.paste("po_lines", po);
    J.check("PO tersimpan: 2 dari 5 baris lolos cek", !!r.ok && /2 dari 5 baris lolos/.test(r.ok), r.ok || r.error || "");
    const saved = J.db(`select document_ref, kg, price, created_by from public.sales_line where document_ref like 'KGR26.E2E%' and deleted_at is null order by document_ref`).map((x) => x.join(" "));
    J.log(`    DB sales_line PO uji: ${saved.join("; ") || "tidak ada"}`);
    J.check("DB: tepat dua baris PO tersimpan (E2E01 dan E2E02), oleh Sales", saved.length === 2 && saved.every((x) => x.endsWith(`sales@${cfg.domain}`)), saved.join("; "));
    J.check("baris pelanggan lain, tanggal lewat dan kode tak dikenal tidak tersimpan", J.dbOne(`select count(*) from public.sales_line where document_ref in ('KGR26.E2E03','KGR26.E2E04','KGR26.E2E05')`) === "0");
    await A.sales.shot("T7-1c-sales-po");
  });

  // --------------------------------------------------------------------------------------- 3a Purchasing supply
  await J.step("3a", A.purchasing, "Purchasing: supply LB per kelas untuk tanggal potong 25–28/08 (upload)", async () => {
    J.clock("2026-08-27T09:45:00+07:00");
    const need = J.db(`select (ship_date - 1)::text, weight_class, round(sum(kg_lb)) from public.demand_class_weekly where ship_date >= '2026-08-24' group by 1, 2 order by 1, 2`);
    J.log(`    DB kebutuhan kg LB per tanggal potong dan kelas: ${need.map((r) => `${r[0].slice(5)} ${r[1]} ${r[2]}`).join("; ")}`);
    // one row per (date, class): the history of the cut dates 25 and 26 (actual batches) and the need of the dates ahead, +10%
    const want = new Map();
    for (const [d, c, kg] of need) want.set(`${d}|${c}`, Math.ceil(Number(kg) * 1.1));
    // the actual batches of 25 and 26 Aug were bought for class S (the K35 cell of lb_supply asks for a row on the cut date)
    for (const [d, kg] of [["2026-08-25", 12211.6], ["2026-08-26", 12089.6]]) want.set(`${d}|S`, Math.max(want.get(`${d}|S`) || 0, kg));
    const rows = [["tanggal", "kelas", "pemasok", "kg_lb", "harga", "ekor"]];
    for (const [k, kg] of [...want].sort()) { const [d, c] = k.split("|"); rows.push([d, c, "CV Unggas E2E", kg, 25000, ""]); }
    const r = await A.purchasing.paste("lb_supply", rows);
    J.check("supply LB tersimpan", !!r.ok && !r.error, r.ok || r.error || "");
    await A.purchasing.shot("T7-3a-purchasing-supply");
  });

  // ------------------------------------------------------------------------------------- 3b PPIC plan + copy blocked
  await J.step("3b", A.ppic, "PPIC: yield per kelas (upload), kapasitas, simpan rencana per kelas; salin ke batch ditahan C57", async () => {
    J.clock("2026-08-27T10:00:00+07:00");
    // karkas rows of K/S/B from the week start; the STD rows replace the placeholder rows of 2026-01-01 in place
    const y = [["kelas", "kunci", "yield_pct", "pola", "berlaku_mulai"]];
    for (const [k, v] of [["K", [70.2, 4.8, 3.1, 4.3, 5.6, 1.2]], ["S", [71.5, 4.5, 2.9, 4.2, 5.4, 1.4]], ["B", [72.4, 4.3, 2.8, 4.1, 5.3, 1.5]], ["STD", [71.5, 4.5, 2.9, 4.2, 5.4, 1.4]]])
      ["Karkas", "Kepala", "Ceker", "Usus", "HJA", "Lemak"].forEach((key, i) => y.push([k, key, v[i], "karkas", k === "STD" ? "2026-01-01" : WEEK]));
    const yr = await A.ppic.paste("yield_matrix", y);
    J.check("yield per kelas tersimpan (C42)", !!yr.ok && !yr.error, yr.ok || yr.error || "");
    await A.ppic.goto(`/w/${WEEK}/rencana`);
    for (let d = 24; d <= 30; d++) await A.ppic.page.locator(`input[name="head_2026-08-${d}"]`).fill("20000");
    const cap = await A.ppic.act("Simpan kapasitas");
    J.check("kapasitas potong tersimpan (C47)", !!cap.ok, cap.ok || cap.error || "");
    await A.ppic.goto(`/w/${WEEK}/rencana`);
    const sv = await A.ppic.act(/^Simpan rencana versi/);
    J.log(`    ppic  ${short(sv.ok || sv.error || "", 200)}`);
    J.check("rencana per kelas tersimpan", !!sv.ok && /kelas/.test(sv.ok), sv.ok || sv.error || "");
    J.log(`    DB plan_week: ${J.db(`select version, head_count, yield_provisional, created_by from public.plan_week where week_start = '${WEEK}' order by version`).map((r) => r.join(" ")).join("; ")}`);
    J.log(`    DB plan_week_class: ${J.db(`select c.weight_class, round(c.kg_lb), c.heads from public.plan_week_class c join public.plan_week p on p.id = c.plan_week_id where p.week_start = '${WEEK}' order by 1`).map((r) => r.join(" ")).join("; ")}`);
    await A.ppic.goto(`/w/${WEEK}/rencana`);
    const t = await A.ppic.text("main");
    const blocked = /Belum bisa salin ke batch rencana:[^.]*C57/.test(t);
    J.check("salin ke batch ditahan C57 (harga LB potong 28/08 belum diputuskan)", blocked, short(t.slice(t.indexOf("Belum bisa"), t.indexOf("Belum bisa") + 220)));
    const dp = t.indexOf("3 · Rencana harian");
    J.log(`    ppic  rencana harian: ${short(t.slice(dp, dp + 700), 700)}`);
    const copyBtn = A.ppic.page.getByRole("button", { name: /^Salin ke batch/ });
    J.check("tombol Salin nonaktif", (await copyBtn.count()) > 0 && (await copyBtn.first().isDisabled()));
    await A.ppic.shot("T7-3b-ppic-rencana-tertahan");
  });

  // --------------------------------------------------------------------------------------- 4 Dir Ops LB price
  await J.step("4", A.operations_director, "Direktur Operasional: putuskan harga LB potong Jum 28/08", async () => {
    J.clock("2026-08-27T10:30:00+07:00");
    const s = await A.operations_director.goto(`/minggu-ini/${WEEK}?lb=25000`);
    J.check("Minggu ini terbuka untuk Direktur Operasional", s === 200, `HTTP ${s}`);
    const m = await A.operations_director.act(/^Putuskan Rp 25\.000 untuk potong 28\/08/);
    J.log(`    opsdir  ${short(m.ok || m.error || "", 200)}`);
    J.check("keputusan harga LB tersimpan", !!m.ok && /diputuskan/.test(m.ok), m.ok || m.error || "");
    J.log(`    DB lb_price_decision 28/08: ${J.db(`select price, volume_kg_lb, decided_by from public.lb_price_decision where date = '2026-08-28'`).map((r) => r.join(" · ")).join("; ")}`);
    J.check("DB: keputusan 28/08 oleh opsdir", J.dbOne(`select count(*) from public.lb_price_decision where date = '2026-08-28' and decided_by = 'opsdir@${cfg.domain}'`) === "1");
    await A.operations_director.shot("T7-4-opsdir-keputusan");
  });

  // -------------------------------------------------------------------------------------------- 3c PPIC copy
  await J.step("3c", A.ppic, "PPIC: salin rencana per kelas ke batch rencana (C57 sudah lulus)", async () => {
    J.clock("2026-08-27T10:50:00+07:00");
    await A.ppic.goto(`/w/${WEEK}/rencana`);
    const t = await A.ppic.text("main");
    const hold = (t.match(/Belum bisa salin ke batch rencana:[^.]*/) || [""])[0];
    J.log(`    ppic  penahan salin: ${hold || "(tidak ada)"}`);
    const dp = t.indexOf("3 · Rencana harian");
    J.log(`    ppic  rencana harian: ${short(t.slice(dp, dp + 700), 700)}`);
    const m = await A.ppic.act(/^Salin ke batch/);
    J.log(`    ppic  ${short(m.ok || m.error || "", 200)}`);
    J.check("salin ke batch rencana berhasil", !!m.ok && /batch rencana ditulis/.test(m.ok), m.ok || m.error || "");
    const rows = J.db(`select b.date::text, b.lb_kg, b.head_count from public.batch b where b.status = 'Rencana' and b.batch_ref like 'PLAN-${WEEK}-%' and b.deleted_at is null order by b.date`);
    J.log(`    DB batch hasil salin: ${rows.map((r) => `${r[0].slice(5)} ${r[1]} kg LB ${r[2]} ekor`).join("; ")}`);
    const tot = J.db(`select round(sum(c.kg_lb)), sum(c.heads) from public.plan_week_class c join public.plan_week p on p.id = c.plan_week_id where p.week_start = '${WEEK}' and p.version = (select max(version) from public.plan_week where week_start = '${WEEK}')`)[0];
    const copied = rows.reduce((a, r) => a + Number(r[1]), 0), copiedHeads = rows.reduce((a, r) => a + Number(r[2] || 0), 0);
    J.log(`    DB rencana kelas tersimpan: ${tot[0]} kg LB, ${tot[1]} ekor; salinan batch: ${Math.round(copied)} kg LB, ${copiedHeads} ekor`);
    // R52 (merged with A2): the batches carry the saved class plan (kg per day and the class yield), not a recomputation on the STD yield
    J.check("angka batch hasil salin = rencana kelas tersimpan, kg LB dan ekor (R52)", Math.abs(copied - Number(tot[0])) <= 1 && copiedHeads === Number(tot[1]), `salinan ${Math.round(copied)} kg LB / ${copiedHeads} ekor vs tersimpan ${tot[0]} / ${tot[1]}`);
    await A.ppic.shot("T7-3c-ppic-disalin");
  });

  // ----------------------------------------------------------------------------------------------- 5 WP upload
  let costBefore = null;
  await J.step("5", A.cost_accounting, `Cost Accounting: upload WP batch ${BATCH} (H+1, Kam 27 Agu 11.00)`, async () => {
    J.clock("2026-08-27T11:00:00+07:00");
    costBefore = J.db(`select key, cost_per_kg, cost_status from public.commercial_daily where date = '2026-08-27' and key = 'RPA|Karkas|Fresh'`)[0];
    J.log(`    DB commercial_daily 27/08 Karkas fresh sebelum WP: Rp ${costBefore ? `${costBefore[1]}/kg, status ${costBefore[2]}` : "tidak ada"}`);
    const wp = [["batch", "kg_lb", "ekor", "kode_item", "kg"],
      [BATCH, 12089.6, 6300, "JLB0922", 5500.0], [BATCH, "", "", "JLB0927", 3675.0], [BATCH, "", "", "JLB0092", 560.0], [BATCH, "", "", "JLB0078", 350.0],
      [BATCH, "", "", "JLB0135", 540.0], [BATCH, "", "", "JLB0080", 650.0], [BATCH, "", "", "JLB0118", 45.0], [BATCH, "", "", "JLB0116", 250.0], [BATCH, "", "", "JLB0120", 150.0]];
    const r = await A.cost_accounting.paste("costing_wp", wp);
    J.check("WP tersimpan", !!r.ok && !r.error, r.ok || r.error || "");
    J.log(`    DB WP batch ${BATCH}: ${J.db(`select o.source, count(*), round(sum(o.kg)) from public.batch_output_sku o join public.batch b on b.id = o.batch_id where b.batch_ref = '${BATCH}' and b.status = 'Aktual' and o.deleted_at is null group by 1`).map((x) => x.join(" ")).join("; ")}`);
    await A.cost_accounting.shot("T7-5-costacc-wp");
  });

  // -------------------------------------------------------------------------------------- 6 invoice + posting
  await J.step("6", A.cost_accounting, `Cost Accounting: faktur pemasok ${PI.no} (tie ke GL), alokasi dan posting batch ${BATCH}`, async () => {
    J.clock("2026-08-27T13:00:00+07:00");
    const inv = [["no_faktur", "tanggal", "pemasok", "batch", "kg", "nilai"], [PI.no, PI.date, "CV Unggas E2E", BATCH, 12089.6, PI.value]];
    const r = await A.cost_accounting.paste("supplier_invoice", inv);
    J.check("faktur tersimpan dan tie ke GL", !!r.ok && /1 faktur tie/.test(r.ok), r.ok || r.error || r.summary?.join(" ") || "");
    J.log(`    DB batch ${BATCH}: invoice_status ${J.dbOne(`select invoice_status from public.batch where batch_ref = '${BATCH}' and status = 'Aktual'`)}, costing_status ${J.dbOne(`select costing_status from public.batch where batch_ref = '${BATCH}' and status = 'Aktual'`)}`);
    await A.cost_accounting.goto(`/w/${WEEK}/costing`);
    const before = (await A.cost_accounting.text("main")).split("\n").find((l) => l.includes(BATCH) && /final|sementara|estimasi/.test(l)) || "";
    J.log(`    cost_accounting  status biaya sesudah faktur tie, sebelum posting: ${short(before, 160)}`);
    // K59 (R60, merged with A3): `final` only from a posted allocation; a tied invoice is the condition to post, not the status
    J.check("faktur tie belum membuat biaya final: status tetap sementara sampai posting (R60, K59)", /sementara/.test(before) && !/final/.test(before), short(before, 140));
    await A.cost_accounting.goto(`/w/${WEEK}/input/costing`);
    const row = A.cost_accounting.page.locator("tr", { hasText: BATCH }).first();
    const al = await A.cost_accounting.act("Alokasikan", { within: `tr:has-text("${BATCH}")`, exact: true });
    J.log(`    cost_accounting  ${short(al.ok || al.error || "", 200)}`);
    J.check("alokasi batch (draft) berhasil", !!al.ok && /Dialokasikan/.test(al.ok), al.ok || al.error || "");
    void row;
    await A.cost_accounting.goto(`/w/${WEEK}/input/costing`);
    const post = await A.cost_accounting.act(/^Posting \d+ draft/);
    J.log(`    cost_accounting  ${short(post.ok || post.error || "", 200)}`);
    J.check("posting batch berhasil", !!post.ok && /Diposting/.test(post.ok), post.ok || post.error || "");
    J.log(`    DB allocation_run batch ${BATCH}: ${J.db(`select r.status, r.posted_by from public.allocation_run r join public.batch b on b.id = r.batch_id where b.batch_ref = '${BATCH}' and b.status = 'Aktual' and r.status <> 'superseded'`).map((x) => x.join(" ")).join("; ")}`);
    await A.cost_accounting.goto(`/w/${WEEK}/costing`);
    const after = (await A.cost_accounting.text("main")).split("\n").find((l) => l.includes(BATCH) && /final|sementara|estimasi/.test(l)) || "";
    J.log(`    cost_accounting  status biaya sesudah posting: ${short(after, 160)}`);
    J.check("sesudah posting biaya batch final", /final/.test(after), short(after, 140));
    await A.cost_accounting.shot("T7-6-costacc-posting");
  });

  // ------------------------------------------------------------------------------------ allocation Thursday (PPIC)
  await J.step("6b", A.ppic, "PPIC: alokasi FEFO hari ini, Kam 27 Agu (sebelum cut-off 14.00)", async () => {
    J.clock("2026-08-27T13:45:00+07:00");
    // C45 STALE holds the allocation while the queue is not drained (see drain())
    await drain(J, A.finance, "sebelum alokasi 27/08");
    await A.ppic.goto("/hari/2026-08-27/alokasi");
    { const t0 = await A.ppic.text("main"); J.log(`    ppic  halaman alokasi: ${short(t0, 500)}`); }
    const m = await A.ppic.act("Alokasikan hari ini");
    J.log(`    ppic  ${short(m.ok || m.error || "", 200)}`);
    J.check("alokasi 27/08 ditulis", !!m.ok && /alokasi FEFO ditulis/.test(m.ok), m.ok || m.error || "");
  });

  // --------------------------------------------------------------------------------- 7 Commercial shows new cost
  await J.step("7", A.commercial_lead, "Komersial: biaya baru tampil (WP dan posting batch sudah masuk)", async () => {
    J.clock("2026-08-27T14:30:00+07:00");
    await drain(J, A.finance, "sebelum layar Komersial");
    const after = J.db(`select key, cost_per_kg, cost_status from public.commercial_daily where date = '2026-08-27' and key = 'RPA|Karkas|Fresh'`)[0];
    J.log(`    DB commercial_daily 27/08 Karkas fresh sesudah: Rp ${after ? `${after[1]}/kg, status ${after[2]}` : "tidak ada"} (sebelum: ${costBefore ? `${costBefore[1]}/kg, ${costBefore[2]}` : "-"})`);
    J.check("DB: biaya/kg Karkas fresh berubah sesudah WP dan posting", !!after && !!costBefore && Number(after[1]) !== Number(costBefore[1]), `${costBefore?.[1]} → ${after?.[1]}`);
    const s = await A.commercial_lead.goto("/komersial");
    J.check("Komersial terbuka untuk Kepala Sales", s === 200, `HTTP ${s}`);
    const t = await A.commercial_lead.text("main");
    const line = t.split("\n").find((l) => /^\d+ Karkas( fresh| frozen)? /.test(l) && !/frozen/.test(l)) || t.split("\n").find((l) => /Karkas/.test(l) && /RPA/.test(l)) || "";
    J.log(`    commercial_lead  baris Karkas di layar: ${short(line, 200)}`);
    J.check("layar Komersial memuat biaya baru Karkas fresh", !!after && t.includes(idNum(after[1])), `Rp ${idNum(after?.[1] ?? 0)}/kg`);
    await A.commercial_lead.shot("T7-7-komersial-biaya-baru");
  });

  // -------------------------------------------------------------------------------------- Friday allocation
  await J.step("7b", A.ppic, "PPIC: alokasi FEFO hari ini, Jum 28 Agu (sebelum cut-off 14.00)", async () => {
    J.clock("2026-08-28T13:00:00+07:00");
    await drain(J, A.finance, "sebelum alokasi 28/08");
    await A.ppic.goto("/hari/2026-08-28/alokasi");
    { const t0 = await A.ppic.text("main"); J.log(`    ppic  halaman alokasi: ${short(t0, 500)}`); }
    const m = await A.ppic.act("Alokasikan hari ini");
    J.log(`    ppic  ${short(m.ok || m.error || "", 200)}`);
    J.check("alokasi 28/08 ditulis", !!m.ok && /alokasi FEFO ditulis/.test(m.ok), m.ok || m.error || "");
  });

  // ------------------------------------------------------------------------------------------ 2 lead locks
  await J.step("2", A.commercial_lead, "Kepala Sales: kunci komitmen dan price list minggu depan (Jum 28 Agu 16.00, tenggat 17.00)", async () => {
    J.clock("2026-08-28T16:00:00+07:00");
    await A.commercial_lead.goto("/komersial");
    const fz = A.commercial_lead.page.locator('input[name="price_frozen|RPA|Karkas"]');
    if (await fz.count()) await fz.fill("28000");
    const m = await A.commercial_lead.act("Kunci komitmen dan price list");
    J.log(`    commercial_lead  ${short(m.ok || m.error || "", 200)}`);
    J.check("komitmen dan price list terkunci", !!m.ok && /dikunci/.test(m.ok), m.ok || m.error || "");
    J.log(`    DB komitmen ${NEXT}: ${J.db(`select key, version, status, locked_by from public.sales_commitment where week_start = '${NEXT}' order by key, version`).map((r) => r.join(" ")).join("; ")}`);
    J.check("DB: komitmen terkunci oleh Kepala Sales", J.dbOne(`select count(*) from public.sales_commitment where week_start = '${NEXT}' and status = 'locked' and locked_by = 'lead@${cfg.domain}'`) === "1");
    J.check("DB: price list minggu depan terkunci", Number(J.dbOne(`select count(*) from public.price_list_week where week_start = '${NEXT}' and locked_at is not null`)) >= 1);
    // R54 (merged with A2): the lock queues the task date (Friday) and the cell is green without "Perbarui status tugas"
    const cell = J.dbOne(`select status from public.input_completeness_daily where date = '2026-08-28' and kind = 'commitment_lock'`);
    J.check("sel K35 commitment_lock 28/08 lolos tanpa 'Perbarui status tugas' (R54)", cell === "passed", `status tersimpan: ${cell}`);
    await A.commercial_lead.shot("T7-2-lead-kunci");
  });

  // ------------------------------------------------------------------------- Accurate totals (C8 / C9, Inventory Acc)
  await J.step("8a", A.inventory_accounting, "Inventory Accounting: total Accurate minggu ini (C8 kg penjualan, C9 nilai stok awal) lewat layar Parameter", async () => {
    J.clock("2026-08-28T16:10:00+07:00");
    await A.inventory_accounting.goto(`/w/${WEEK}/kontrol`);
    const t = await A.inventory_accounting.text("main");
    const c8 = /\n8\s+kg penjualan aktual minggu ini[^\n]*?\s([\d.]+,\d+|[\d.]+)\s/.exec(t);
    const c9 = /\n9\s+Nilai stok awal[^\n]*?\s([\d.]+,\d+|[\d.]+)\s/.exec(t);
    J.check("nilai C8 dan C9 terbaca di layar Kontrol", !!c8 && !!c9, `C8 ${c8?.[1]} · C9 ${c9?.[1]}`);
    const kg = parseId(c8[1]), val = parseId(c9[1]);
    await A.inventory_accounting.goto(`/w/${WEEK}/input/parameter`);
    await A.inventory_accounting.page.locator('input[name="accurate_sales_kg"]').fill(String(kg));
    await A.inventory_accounting.page.locator('input[name="accurate_opening_stock_value"]').fill(String(val));
    const before = A.inventory_accounting.page.url();
    await A.inventory_accounting.page.getByRole("button", { name: /Simpan/ }).first().click();
    await A.inventory_accounting.page.waitForLoadState("networkidle").catch(() => {});
    await sleep(500);
    J.log(`    inventory_accounting  simpan parameter → ${A.inventory_accounting.page.url().replace(cfg.base, "")} (sebelum ${before.replace(cfg.base, "")})`);
    J.log(`    DB parameter: accurate_sales_kg ${J.dbOne(`select accurate_sales_kg from public.parameter p join public.week w on w.id = p.week_id where w.week_start = '${WEEK}'`)} · accurate_opening_stock_value ${J.dbOne(`select accurate_opening_stock_value from public.parameter p join public.week w on w.id = p.week_id where w.week_start = '${WEEK}'`)}`);
    J.check("DB: total Accurate tersimpan", J.dbOne(`select accurate_sales_kg is not null and accurate_opening_stock_value is not null from public.parameter p join public.week w on w.id = p.week_id where w.week_start = '${WEEK}'`) === "t");
  });

  // ------------------------------------------------------------------------------------------- 8 K35 grid green
  await J.step("8", A.finance, "Finance: grid kelengkapan K35 minggu 24–30 Agu hijau (Input → Perbarui status tugas)", async () => {
    J.clock("2026-08-28T16:30:00+07:00");
    const s = await A.finance.goto("/input?panel=grid");
    J.check("Input terbuka untuk Finance", s === 200, `HTTP ${s}`);
    const m = await A.finance.act("Perbarui status tugas");
    J.log(`    finance  ${short(m.ok || m.error || "", 200)}`);
    J.check("status tugas diperbarui", !!m.ok, m.ok || m.error || "");
    const red = J.db(`select kind || ' ' || to_char(date, 'DD/MM') from public.input_completeness_daily where date between '${WEEK}' and '2026-08-30' and kind <> 'release_week' and (status = 'late' or (status = 'not_due' and due_at <= now())) order by date, kind`).map((r) => r[0]);
    J.log(`    DB sel merah minggu ${WEEK} (late, atau not_due lewat tenggat): ${red.length ? red.join(", ") : "tidak ada"}`);
    J.log(`    DB sel per status: ${J.db(`select status, count(*) from public.input_completeness_daily where date between '${WEEK}' and '2026-08-30' group by 1 order by 1`).map((r) => `${r[0]} ${r[1]}`).join(", ")}`);
    J.check("K35: tidak ada sel merah untuk minggu yang dirilis", red.length === 0, red.join(", "));
    await A.finance.goto("/input?panel=grid");
    await A.finance.shot("T7-8-finance-grid-k35");
  });

  // ------------------------------------------------------------------------------------------------ 9 release
  await J.step("9", A.finance, "Finance: rilis outlook minggu 24–30 Agu tanpa override, v4_release hidup", async () => {
    J.clock("2026-08-28T16:40:00+07:00");
    J.check("v4_release hidup (ketat)", J.dbOne("select value ->> 'enabled' from public.app_setting where key = 'v4_release'") === "true");
    const s = await A.finance.goto(`/w/${WEEK}/kontrol`);
    J.check("Kontrol terbuka untuk Finance", s === 200, `HTTP ${s}`);
    const t = await A.finance.text("main");
    J.log(`    finance  kartu Rilis: ${short(t.slice(t.indexOf("Rilis outlook"), t.indexOf("Rilis outlook") + 300), 300)}`);
    const m = await A.finance.act(/^Rilis outlook/);
    J.log(`    finance  ${short(m.ok || m.error || "", 300)}`);
    J.check("rilis berhasil tanpa override", !!m.ok && /dirilis/i.test(m.ok), m.ok || m.error || "");
    J.log(`    DB rilis: ${J.db(`select r.released_by, left(r.snapshot_sha256, 12), r.control_status from public.release r join public.week w on w.id = r.week_id where w.week_start = '${WEEK}'`).map((r) => r.join(" · ")).join("; ")}; override minggu ini: ${J.dbOne(`select count(*) from public.release_override where scope_kind = 'week' and scope = '${WEEK}' and deleted_at is null`)}`);
    J.check("DB: satu rilis oleh finance, nol override", J.dbOne(`select count(*) from public.release r join public.week w on w.id = r.week_id where w.week_start = '${WEEK}' and r.released_by = 'finance@${cfg.domain}'`) === "1"
      && J.dbOne(`select count(*) from public.release_override where scope_kind = 'week' and scope = '${WEEK}' and deleted_at is null`) === "0");
    await A.finance.shot("T7-9-finance-rilis");
  });

  // ------------------------------------------------------------------------------------ management sees the loop
  await J.step("10", A.management, "Manajemen: Minggu ini, tile Status putaran sesudah rilis (hanya baca)", async () => {
    J.clock("2026-08-28T16:50:00+07:00");
    const s = await A.management.goto(`/minggu-ini/${WEEK}`);
    J.check("Minggu ini terbuka untuk Manajemen", s === 200, `HTTP ${s}`);
    const t = await A.management.text("main");
    const i = t.indexOf("Status putaran");
    J.log(`    management  Status putaran: ${short(t.slice(i, i + 700), 700)}`);
    J.check("tile Status putaran tampil", i >= 0);
    const writes = await A.management.page.locator("main form button").count();
    J.check("Manajemen tidak punya tombol tulis di halaman", writes === 0, `${writes} tombol`);
    await A.management.shot("T7-10-manajemen-status-putaran");
  });

  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
