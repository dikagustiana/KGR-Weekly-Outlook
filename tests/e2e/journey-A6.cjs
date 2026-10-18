#!/usr/bin/env node
"use strict";
// journey A6 (PRD v5.2-A irisan A6, R75-R79 + Q-v5.2-52, screenshots): what the UI slice changed, on the database T7 leaves
// (Friday 28 Aug 2026 ~16.50, the week 24-30 Aug completely filled and released). Environment: PG16 lokal + PostgREST 12 + mock auth.
//   (1) R75   the tiles of Minggu ini follow (y, x) when the page is one column (390 and 899 px): laba rugi (row 5) is above the
//             simulation, the decisions and the charts; screenshots of the six screens at 1366x768, 899 and 390 px (E2E_SCREENS=1)
//   (2) R76   a week of August opened with uploads of October in the database: every source label (Minggu ini, Komersial, Rencana)
//             names August; the simulation is PO + yield + harga LB, the cost is WP
//   (3) R77   Finance nav has 7 items without Upload; the v4 wizard is a link in the Input panel of Finance
//   (4) R78   a .xls file is read by the Input panel (also one named .xlsx that is an .xls inside)
//   (5) R79   "1,234" in a number column is held with "format ribuan ambigu"
//   (6) Q-v5.2-52  C45 STALE with more dates in the queue than one inline run takes: PPIC rebuilds them from the allocation screen
// Screenshots (E2E_SCREENS=1, opt-in: 18 PNG, about 20 s) go to out/screens/A6-<screen>-<width>.png; nothing in them but fixture data
// and the synthetic e2e users.
const fs = require("node:fs");
const path = require("node:path");
const { Journey, cfg, short, sleep } = require("./lib/e2e.cjs");

const WEEK = "2026-08-24";
const SCREENS = process.env.E2E_SCREENS === "1";
const NAV7 = ["Outlook bulan", "Biaya tetap & driver", "Tutup buku", "Kas", "Rilis", "Kontrol", "Input"];
const REBUILD = "Bangun ulang antrean (sampai hari ini)";

/** SheetJS of the web app (the dependency of apps/web), for a small .xls written here — nothing binary is committed. */
function sheetjs() {
  return require(require.resolve("xlsx", { paths: [path.join(cfg.root, "apps/web"), cfg.root] }));
}
function xlsBytes(rows, bookType = "xls") {
  const X = sheetjs();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), "PO");
  return Buffer.from(X.write(wb, { type: "buffer", bookType }));
}

/** The source labels under the tiles: tile id → text. */
async function labels(actor) {
  return actor.page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-tile]")]
    .map((t) => [t.getAttribute("data-tile"), t.querySelector("[data-tile-source]")?.textContent?.trim() ?? null]).filter(([, v]) => v)));
}
/** Vertical position of tiles (px from the top of the page). */
async function tops(actor, ids) {
  return actor.page.evaluate((list) => Object.fromEntries(list.map((id) => [id, document.querySelector(`[data-tile="${id}"]`)?.getBoundingClientRect().top ?? null])), ids);
}

const SIZES = [{ w: 1366, h: 768, tag: "1366x768", full: false }, { w: 899, h: 900, tag: "899", full: true }, { w: 390, h: 844, tag: "390", full: true }];

(async () => {
  const J = new Journey("A6", "UI irisan A6: urutan tile, label sumber, nav Finance, .xls, ribuan ambigu, bangun ulang antrean PPIC");
  const A = {};
  for (const r of ["management", "finance", "commercial_lead", "ppic", "sales"]) A[r] = await J.actor(r);
  const resize = async (a, s) => { await a.page.setViewportSize({ width: s.w, height: s.h }); await sleep(250); };

  await J.step("0", null, "SETUP: jam uji Jum 28 Agu 17.00; login lima role", async () => {
    J.clock("2026-08-28T17:00:00+07:00");
    for (const a of Object.values(A)) await a.login();
    J.check("lima role masuk", Object.values(A).every((a) => a.loggedIn), Object.keys(A).join(", "));
    J.log(`    DB: PO uji T7 ${J.dbOne("select count(*) from public.sales_line where document_ref like 'KGR26.E2E%' and deleted_at is null")} baris; antrean rebuild belum selesai ${J.dbOne("select count(*) from public.rebuild_queue where status in ('queued','running','failed')")}`);
  });

  // ------------------------------------------------------------------------------------------- 1 R75 order, screenshots
  await J.step("1", A.management, "R75: Minggu ini satu kolom (390 dan 899 px): laba rugi di atas simulasi, keputusan dan grafik; layar utama di tiga lebar", async () => {
    const ids = ["t-laba-rugi", "sim-lb", "keputusan", "ch-harian", "t-segmen", "catatan"];
    for (const s of SIZES) {
      await resize(A.management, s);
      const st = await A.management.goto(`/minggu-ini/${WEEK}`);
      J.check(`Minggu ini terbuka di ${s.w} px`, st === 200, `HTTP ${st}`);
      const t = await tops(A.management, ids);
      J.log(`    management  posisi atas tile di ${s.w} px: ${ids.map((i) => `${i} ${t[i] === null ? "—" : Math.round(t[i])}`).join(", ")}`);
      J.check(`tile ada semua di ${s.w} px`, ids.every((i) => t[i] !== null), ids.filter((i) => t[i] === null).join(", "));
      if (s.w < 900) {
        // one column: the order of the page is the (y, x) order of the grid — laba rugi (row 5) before the simulation (row 9)
        J.check(`${s.w} px: laba rugi di atas simulasi, keputusan, grafik harian, tabel segmen dan catatan`, ids.every((id, i) => i === 0 || (t[ids[i - 1]] ?? 0) <= (t[id] ?? 0)), ids.map((i) => `${i}:${Math.round(t[i] ?? -1)}`).join(" "));
        J.check(`${s.w} px: laba rugi bukan tile terakhir (sebelum R75 ia ada di bawah semua tile v4)`, (t["t-laba-rugi"] ?? 1e9) < (t["ch-harian"] ?? 0));
      } else {
        J.check("1366 px: laba rugi (baris 5) di atas simulasi (baris 9) dan grafik harian", (t["t-laba-rugi"] ?? 1e9) < (t["sim-lb"] ?? 0) && (t["sim-lb"] ?? 1e9) < (t["ch-harian"] ?? 0));
      }
      const overflow = await A.management.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      J.check(`${s.w} px: tanpa gulir horizontal halaman`, overflow <= 1, `selisih ${overflow} px`);
    }
    await resize(A.management, SIZES[0]);
  });

  await J.step("1b", null, "R75: tanpa gulir horizontal halaman di 390 px pada enam layar utama (baris akun tidak melebarkan halaman)", async () => {
    const pages = [["Minggu ini", A.management, `/minggu-ini/${WEEK}`], ["Komersial", A.commercial_lead, "/komersial"], ["Rencana", A.ppic, `/w/${WEEK}/rencana`],
      ["Input", A.finance, "/input"], ["Outlook bulan", A.management, `/m/${WEEK.slice(0, 7)}`], ["Kas", A.management, "/kas"]];
    for (const [name, a, url] of pages) {
      await resize(a, SIZES[2]);
      const st = await a.goto(url);
      const over = await a.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      J.check(`${name}: 390 px tanpa gulir horizontal halaman (${a.role})`, st === 200 && over <= 1, `HTTP ${st}, selisih ${over} px`);
      await resize(a, SIZES[0]);
    }
  });

  if (SCREENS) {
    await J.step("1s", null, "tangkapan layar enam layar utama di 1366x768, 899 dan 390 px (E2E_SCREENS=1; hanya data fixture dan user e2e)", async () => {
      const month = WEEK.slice(0, 7);
      const pages = [
        ["minggu-ini", A.management, `/minggu-ini/${WEEK}`], ["komersial", A.commercial_lead, "/komersial"], ["rencana", A.ppic, `/w/${WEEK}/rencana`],
        ["input", A.finance, "/input"], ["outlook-bulan", A.management, `/m/${month}`], ["kas", A.management, "/kas"],
      ];
      for (const [name, a, url] of pages) {
        for (const s of SIZES) {
          await resize(a, s);
          const st = await a.goto(url);
          J.check(`${name} terbuka di ${s.w} px`, st === 200, `HTTP ${st}`);
          await a.shot(`A6-${name}-${s.tag}`, { fullPage: s.full });
        }
        await resize(a, SIZES[0]);
      }
    });
  }

  // ------------------------------------------------------------------------------------------ 2 R76 source labels
  await J.step("2", A.management, "R76: minggu Agustus dengan upload Oktober di database: label sumber Minggu ini, Komersial dan Rencana memakai Agustus", async () => {
    J.setup("upload Oktober (15 Okt 23.20 WIB) di jurnal, kartu stok, kas, jadwal beban tetap, WP + faktur, PO, harga LB, yield, supply LB dan satu tugas PO terlambat", `
      set session_replication_role = replica;  -- tanpa pemicu antrean/penjaga: baris ini hanya latar bagi label
      create temp table _c as select * from public.gl_line where deleted_at is null order by date desc limit 1;
      update _c set id = gen_random_uuid(), date = date '2026-10-14', created_at = timestamptz '2026-10-15 16:20:00+00', updated_at = timestamptz '2026-10-15 16:20:00+00', line_key = null, upload_id = null;
      insert into public.gl_line select * from _c; drop table _c;
      create temp table _c as select * from public.stock_card_snapshot where deleted_at is null order by date desc limit 1;
      update _c set id = gen_random_uuid(), date = date '2026-10-14', created_at = timestamptz '2026-10-15 16:21:00+00', updated_at = timestamptz '2026-10-15 16:21:00+00';
      insert into public.stock_card_snapshot select * from _c; drop table _c;
      create temp table _c as select * from public.cash_daily order by date desc limit 1;
      update _c set date = date '2026-10-15', updated_at = timestamptz '2026-10-15 16:22:00+00';
      insert into public.cash_daily select * from _c; drop table _c;
      create temp table _c as select * from public.fixed_cost_schedule where deleted_at is null limit 1;
      update _c set id = gen_random_uuid(), code = 'e2e-a6-okt', start_date = date '2026-10-01', end_date = null, updated_at = timestamptz '2026-10-15 16:23:00+00';
      insert into public.fixed_cost_schedule select * from _c; drop table _c;
      create temp table _c as select * from public.batch where status = 'Aktual' and deleted_at is null and superseded_at is null order by date desc limit 1;
      update _c set id = gen_random_uuid(), batch_ref = 'E2E-A6-OKT', date = date '2026-10-14', wp_received_at = timestamptz '2026-10-15 16:24:00+00', invoice_status = 'tied', updated_at = timestamptz '2026-10-15 16:24:00+00', document_ref = null;
      insert into public.batch select * from _c; drop table _c;
      create temp table _c as select * from public.sales_line where status = 'Order' and deleted_at is null order by date desc limit 1;
      update _c set id = gen_random_uuid(), date = date '2026-10-16', delivery_date = date '2026-10-16', document_ref = 'E2E-A6-OKT', po_ref = 'E2E-A6-OKT', line_key = null, upload_id = null, created_at = timestamptz '2026-10-15 16:20:00+00', updated_at = timestamptz '2026-10-15 16:20:00+00';
      insert into public.sales_line select * from _c; drop table _c;
      create temp table _c as select * from public.lb_price_decision order by date desc limit 1;
      update _c set id = gen_random_uuid(), date = date '2026-10-16', decided_at = timestamptz '2026-10-15 16:25:00+00', created_at = timestamptz '2026-10-15 16:25:00+00';
      insert into public.lb_price_decision select * from _c; drop table _c;
      create temp table _c as select * from public.yield_matrix where deleted_at is null and weight_class = 'STD' and cut_pattern = 'karkas' and key = 'Karkas' limit 1;
      update _c set id = gen_random_uuid(), effective_from = date '2026-10-01', created_at = timestamptz '2026-10-15 16:26:00+00', updated_at = timestamptz '2026-10-15 16:26:00+00';
      insert into public.yield_matrix select * from _c; drop table _c;
      create temp table _c as select * from public.lb_supply where deleted_at is null order by date desc limit 1;
      update _c set id = gen_random_uuid(), date = date '2026-10-16', created_at = timestamptz '2026-10-15 16:27:00+00', updated_at = timestamptz '2026-10-15 16:27:00+00';
      insert into public.lb_supply select * from _c; drop table _c;
      create temp table _c as select * from public.input_task where rule_kind = 'po_lines' order by due_date desc limit 1;
      update _c set due_date = date '2026-10-14', ref = '2026-10-15', status = 'late', due_at = timestamptz '2026-10-14 12:00:00+07', done_at = null;
      insert into public.input_task select * from _c; drop table _c;`);
    J.log(`    DB bukti upload Oktober: PO terbaru dibuat ${J.dbOne("select max(created_at) from public.sales_line where status = 'Order' and deleted_at is null")}, jurnal terbaru ${J.dbOne("select max(date) from public.gl_line where deleted_at is null")}, WP terbaru ${J.dbOne("select max(wp_received_at) from public.batch")}`);
    J.check("DB: ada upload Oktober di tabel sumber (bukan hanya Agustus)", Number(J.dbOne("select count(*) from public.sales_line where document_ref = 'E2E-A6-OKT'")) === 1 && J.dbOne("select max(date)::text from public.gl_line where deleted_at is null") === "2026-10-14");

    let st = await A.management.goto(`/minggu-ini/${WEEK}`);
    J.check("Minggu ini minggu 24 Agu terbuka", st === 200, `HTTP ${st}`);
    const m = await labels(A.management);
    J.log(`    management  label sumber: ${JSON.stringify(m)}`);
    J.check("lima label sumber di Minggu ini (jurnal, stok, kas, beban tetap, simulasi)", ["c-outlook", "c-stok", "c-kas", "c-bulan", "sim-lb"].every((id) => m[id]), Object.keys(m).join(", "));
    J.check("tidak ada label yang menyebut Oktober", !Object.values(m).some((v) => /\bOkt\b|\/10\b/.test(v)), Object.values(m).filter((v) => /\bOkt\b|\/10\b/.test(v)).join(" | "));
    J.check("label jurnal menyebut Agustus", /jurnal s\.d\. \d+\/08/.test(m["c-outlook"] || ""), m["c-outlook"]);
    J.check("simulasi = PO + yield + harga LB (bukan WP)", /^Sumber: PO( belum ada)? \+ yield( belum ada)? \+ harga LB/.test(m["sim-lb"] || "") && !/WP/.test(m["sim-lb"] || ""), m["sim-lb"]);
    J.check("label tidak terlambat karena tugas PO Oktober yang terbuka", !/lewat tenggat/.test(m["c-outlook"] || ""), m["c-outlook"]);

    st = await A.commercial_lead.goto("/komersial");
    J.check("Komersial terbuka", st === 200, `HTTP ${st}`);
    const k = await labels(A.commercial_lead);
    J.log(`    commercial_lead  label sumber: ${JSON.stringify(k)}`);
    J.check("Komersial: biaya berlabel WP, PO berlabel PO, keduanya Agustus", /^Sumber: WP/.test(k["c-stok"] || "") && /^Sumber: PO/.test(k["t-komitmen"] || "") && !Object.values(k).some((v) => /\bOkt\b/.test(v)), JSON.stringify(k));

    st = await A.ppic.goto(`/w/${WEEK}/rencana`);
    J.check("Rencana terbuka", st === 200, `HTTP ${st}`);
    const r = await labels(A.ppic);
    J.log(`    ppic  label sumber: ${JSON.stringify(r)}`);
    J.check("Rencana: PO, rencana biaya (yield + harga LB) dan supply berlabel Agustus", /^Sumber: PO/.test(r["c-po"] || "") && /^Sumber: yield/.test(r["c-biaya"] || "") && !Object.values(r).some((v) => /\bOkt\b|\/10\b/.test(v)), JSON.stringify(r));
  });

  // ---------------------------------------------------------------------------------------- 3 R77 Finance nav + link
  await J.step("3", A.finance, "R77: nav Finance 7 item tanpa Upload; wizard v4 jadi tautan di panel Input Finance", async () => {
    let st = await A.finance.goto("/input");
    J.check("Input terbuka untuk Finance", st === 200, `HTTP ${st}`);
    const nav = await A.finance.page.locator('nav.v4-nav[aria-label="Ruang kerja"] a').allInnerTexts();
    J.log(`    finance  nav: ${nav.join(" | ")}`);
    J.check("nav Finance 7 item, urutan PRD, tanpa Upload", JSON.stringify(nav.map((x) => x.trim())) === JSON.stringify(NAV7), nav.join(" | "));
    const link = A.finance.page.locator("[data-wizard-v4]");
    J.check("panel Kelengkapan memuat tautan wizard upload v4", (await link.count()) === 1, `${await link.count()} tautan`);
    const href = await link.first().getAttribute("href");
    J.check("tautan menuju wizard minggu berjalan", href === `/w/${WEEK}/upload`, href || "");
    await A.finance.goto("/input?panel=fixed_cost");
    J.check("panel Upload jadwal beban tetap juga memuat tautan itu", (await A.finance.page.locator("[data-wizard-v4]").count()) === 1);
    await Promise.all([A.finance.page.waitForURL((u) => u.pathname.endsWith("/upload")), A.finance.page.locator("[data-wizard-v4]").first().click()]);
    await A.finance.page.waitForLoadState("networkidle").catch(() => {});
    const t = await A.finance.text("main");
    J.check("tautan membuka wizard Upload v4 (Finance boleh)", /Upload — export Accurate/.test(t), short(t, 120));
    await A.finance.shot("A6-3-finance-wizard");
    // Sales' nav is untouched: Upload stays beside Input
    await A.sales.goto("/input");
    const sn = (await A.sales.page.locator('nav.v4-nav[aria-label="Ruang kerja"] a').allInnerTexts()).map((x) => x.trim());
    J.check("nav Sales tidak berubah (Input dan Upload)", sn.includes("Input") && sn.includes("Upload"), sn.join(" | "));
    J.check("Sales tidak melihat tautan wizard Finance", (await A.sales.page.locator("[data-wizard-v4]").count()) === 0);
  });

  // --------------------------------------------------------------------------------------------- 4 R78 .xls, R79 ribuan
  await J.step("4", A.sales, "R78: file .xls dibaca panel Input; R79: \"1,234\" ditahan 'format ribuan ambigu'", async () => {
    const grid = [["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan"],
      ["KGR26.A6X1", "2026-08-30", "JLB0922", 250, 60000, "PT A"], ["KGR26.A6X2", "2026-08-30", "JLB1857", 300, 60000, "PT A"], ["KGR26.A6X3", "2026-08-30", "JLB0829", 100, 60000, "PT A"]];
    await A.sales.goto("/input?panel=po_lines");
    const panel = A.sales.page.locator('[data-upload="po_lines"]');
    const input = panel.locator('input[type="file"]');
    J.check("pilih file menerima .xlsx, .xls dan .csv", /\.xls\b/.test((await input.getAttribute("accept")) || "") && /\.xlsx/.test((await input.getAttribute("accept")) || ""), (await input.getAttribute("accept")) || "");
    const read = async (name, buffer, mime) => {
      await input.setInputFiles({ name, mimeType: mime, buffer });
      // the panel names the file once it is read, or says it could not be
      await Promise.race([
        panel.locator(`p.note:has-text("${name} ·")`).first().waitFor({ state: "visible", timeout: 30_000 }),
        panel.locator('[role="status"]:has-text("tidak terbaca")').first().waitFor({ state: "visible", timeout: 30_000 }),
      ]).catch(() => {});
      const note = (await panel.locator("p.note").allInnerTexts()).join(" | ");
      const status = (await panel.locator('[role="status"]').allInnerTexts()).join(" | ");
      return { note, status, rows: (await panel.locator('table[aria-label="Baris upload"] tbody tr').allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()) };
    };
    const xls = xlsBytes(grid, "xls");
    J.check("berkas uji adalah .xls sungguhan (dokumen majemuk), ditulis SheetJS di sini", xls.slice(0, 4).toString("hex") === "d0cf11e0", xls.slice(0, 8).toString("hex"));
    const a = await read("po-accurate.xls", xls, "application/vnd.ms-excel");
    J.log(`    sales  .xls: ${short(a.note, 160)} · ${a.rows.length} baris tabel`);
    J.check(".xls terbaca: 'po-accurate.xls · 3 baris dibaca'", /po-accurate\.xls · 3 baris dibaca/.test(a.note), a.note);
    J.check("tanpa pesan 'File tidak terbaca'", !/tidak terbaca/.test(a.status), a.status);
    J.check("baris .xls dicek: kode, kg, harga terbaca (3 baris di tabel)", a.rows.length === 3 && a.rows.every((r) => /KGR|JLB|PT A|ukuran|lantai|\d/.test(r)), a.rows.join(" / "));
    const b = await read("export-accurate.xlsx", xls, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    J.check(".xls bernama .xlsx juga terbaca (dikenali dari isinya)", /export-accurate\.xlsx · 3 baris dibaca/.test(b.note) && !/tidak terbaca/.test(b.status), b.note || b.status);
    const x = await read("po.xlsx", xlsBytes(grid, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    J.check(".xlsx tetap terbaca (build mini)", /po\.xlsx · 3 baris dibaca/.test(x.note), x.note);
    await A.sales.shot("A6-4-sales-xls");

    // R79: English-style thousands in kg and harga are held, with the reason
    const amb = [grid[0], ["KGR26.A6X4", "2026-08-30", "JLB0922", "1,234", 60000, "PT A"], ["KGR26.A6X5", "2026-08-30", "JLB1857", 300, "12,500", "PT A"], ["KGR26.A6X6", "2026-08-30", "JLB1857", "1.234", 60000, "PT A"]];
    const p = await A.sales.paste("po_lines", amb, { noSave: true });
    const rows = (await A.sales.page.locator('[data-upload="po_lines"] table[aria-label="Baris upload"] tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, " ").trim());
    J.log(`    sales  tempel: ${rows.map((r) => short(r, 150)).join(" // ")}`);
    J.check("kg \"1,234\" ditahan: 'format ribuan ambigu'", /kg "1,234": format ribuan ambigu/.test(rows[0] || ""), rows[0]);
    J.check("harga \"12,500\" ditahan: 'format ribuan ambigu'", /harga "12,500": format ribuan ambigu/.test(rows[1] || ""), rows[1]);
    J.check("\"1.234\" (id-ID) tidak ditahan oleh aturan ribuan", !/ambigu/.test(rows[2] || ""), rows[2]);
    J.check("ringkasan: hanya baris yang tidak ambigu yang bisa disimpan (1 dari 3)", p.summary.some((s) => /1 dari 3 baris/.test(s)), p.summary.join(" | "));
  });

  // ------------------------------------------------------------------------------------- 5 Q-v5.2-52 PPIC rebuilds
  await J.step("5", A.ppic, "Q-v5.2-52: C45 STALE dengan 10 tanggal di antrean (lebih dari 7 inline): PPIC membangun ulang dari layar alokasi; Sales tidak punya tombolnya", async () => {
    const DATE = "2026-09-02";
    J.setup("10 tanggal antrean rebuild (24 Agu – 2 Sep) berstatus queued", `
      delete from public.rebuild_queue where status in ('queued','running','failed');
      insert into public.rebuild_queue (date, reason) select d::date, 'e2e A6: antrean panjang (Q-v5.2-52)' from generate_series(date '2026-08-24', date '${DATE}', interval '1 day') d;`);
    const queued = Number(J.dbOne(`select count(distinct date) from public.rebuild_queue where status = 'queued' and date <= '${DATE}'`));
    J.log(`    DB antrean queued sampai ${DATE}: ${queued} tanggal`);
    J.check("DB: 10 tanggal di antrean (lebih dari batas inline 7)", queued === 10, `${queued}`);

    await A.sales.goto(`/hari/${DATE}/alokasi`);
    const salesText = await A.sales.text("main");
    J.check("Sales melihat C45 STALE tetapi tidak punya tombol bangun ulang", /C45 STALE/.test(salesText) && (await A.sales.page.getByRole("button", { name: REBUILD, exact: true }).count()) === 0, short(salesText, 140));

    await A.ppic.goto(`/hari/${DATE}/alokasi`);
    const text = await A.ppic.text("main");
    J.check("PPIC melihat C45 STALE dan tombol 'Bangun ulang antrean (sampai hari ini)'", /C45 STALE/.test(text) && (await A.ppic.page.getByRole("button", { name: REBUILD, exact: true }).count()) === 1, short(text, 140));
    const alloc = A.ppic.page.getByRole("button", { name: "Alokasikan hari ini" });
    J.check("'Alokasikan hari ini' nonaktif selama STALE", (await alloc.count()) > 0 && (await alloc.first().isDisabled()));
    await A.ppic.shot("A6-5-ppic-stale");
    const m = await A.ppic.act(REBUILD, { exact: true, timeout: 280_000 });
    J.log(`    ppic  ${short(m.error || m.ok || "(layar menyegarkan dirinya: formulir hilang bersama C45 STALE)", 220)}`);
    J.check("tombol tidak mengembalikan galat", !m.error, m.error || "tanpa galat");
    const left = Number(J.dbOne(`select count(*) from public.rebuild_queue where status in ('queued','running','failed') and date <= '${DATE}'`));
    const done = Number(J.dbOne(`select count(distinct date) from public.rebuild_queue where status = 'done' and date <= '${DATE}' and reason like 'e2e A6%'`));
    J.log(`    DB sesudah: ${left} tanggal tersisa sampai ${DATE}, ${done} selesai`);
    J.check("DB: tidak ada tanggal tersisa sampai hari itu, 10 selesai", left === 0 && done === 10, `${left} tersisa, ${done} selesai`);
    await A.ppic.goto(`/hari/${DATE}/alokasi`);
    const after = await A.ppic.text("main");
    J.check("C45 tidak lagi STALE dan tombol bangun ulang hilang", !/C45 STALE/.test(after) && (await A.ppic.page.getByRole("button", { name: REBUILD, exact: true }).count()) === 0, short(after, 120));
    J.check("'Alokasikan hari ini' aktif lagi", !(await A.ppic.page.getByRole("button", { name: "Alokasikan hari ini" }).first().isDisabled()));
  });

  // ------------------------------------------------------------------------------------- 6 Q-v5.2-50 C42 on screen
  await J.step("6", A.ppic, "Q-v5.2-50: baris yield boneless placeholder masih ada, C42 tidak menahan Rencana", async () => {
    const ph = Number(J.dbOne("select count(*) from public.yield_matrix where weight_class = 'STD' and cut_pattern = 'boneless' and note ilike 'placeholder%' and deleted_at is null"));
    J.log(`    DB baris yield boneless STD berlabel placeholder: ${ph}`);
    J.check("DB: baris boneless placeholder masih ada (tanpa setup yang menggantinya)", ph > 0, `${ph} baris`);
    const c42 = J.dbOne(`select controls ->> 'C42' from public.plan_week where week_start = '${WEEK}' order by version desc limit 1`);
    J.log(`    DB plan_week terakhir: C42 = ${c42}`);
    J.check("DB: rencana tersimpan sesudah yield diunggah: C42 LULUS", c42 === "LULUS", `C42 ${c42}`);
    await A.ppic.goto(`/w/${WEEK}/rencana`);
    const t = await A.ppic.text("main");
    J.check("layar Rencana: C42 tidak disebut sebagai penahan", !/C42 BELUM DIISI|yield sementara/.test(t), short(t.slice(t.indexOf("Belum bisa"), t.indexOf("Belum bisa") + 160), 160));
  });

  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
