#!/usr/bin/env node
"use strict";
// journey A7 (PRD v5.2 slice A7: the screen for `sales_assignment`, K49, O21(b)), on the database T7 leaves (Friday 28 Aug 2026
// ~16.50, the week 24-30 Aug completely filled and released). Environment: PG16 lokal + PostgREST 12 + mock auth (not Supabase).
//   (1) Kepala Sales opens the screen from Komersial; the Sales users are listed although she cannot read app_user (service client)
//   (2) she assigns ONE form of a SKU ("RPA|X|Fresh") to the Sales user → on /komersial that Sales user sees that key and not the other form
//   (3) she assigns the base key ("RPA|X") → the Sales user sees both forms (O21(b)); the same assignment twice is one row (upsert)
//   (4) deactivate / activate: the access follows, nothing is ever deleted; the base key keeps the access while the form key is off
//   (5) a key the app does not know, a key spelled in another case and an empty key are refused with a message; nothing is written
//   (6) edit a row (note, customer); Admin writes too and reaches the screen from Admin → Pengguna
//   (7) every other role gets a 404; Sales cannot write the table through the API (RLS), and Kepala Sales cannot read app_user
// A8 (Q-v5.2-122, K43): the commitment tile of /komersial follows the coverage rule of the database. A commitment is per BASE key and the database
// accepts it from Sales only with a base-key assignment (assignment_covers): with a one-form assignment (2) the tile offers no row for that SKU and says
// why, and the database refuses the save the tile used to offer (probe); with the base key (3) the row is offered and the save is accepted.
// Every assignment this journey makes carries the note "e2e-a7…" and is removed again by a SETUP at the end (run.sh also restores the
// snapshot of the database T7 left).
const { Journey, cfg, short, sleep } = require("./lib/e2e.cjs");

const DATA_DAY = "2026-08-28";
const NOTE = "e2e-a7";
const SALES = `sales@${cfg.domain}`;
const baseOf = (k) => k.replace(/\|(Fresh|Frozen|n\/a)$/, "");

(async () => {
  const J = new Journey("A7", "A7: Kepala Sales dan Admin mengatur penugasan Sales (SKU dan pelanggan), dan Sales melihat hasilnya di Komersial");
  const A = {}, S = {};
  for (const r of ["commercial_lead", "sales", "admin", "management", "ppic"]) A[r] = await J.actor(r);
  const lead = A.commercial_lead, sales = A.sales, admin = A.admin;
  const rowsOf = (key) => J.db(`select sales_rep, email, coalesce(customer, '<semua>'), key, active::text, coalesce(note, ''), coalesce(created_by, ''), coalesce(updated_by, '') from public.sales_assignment where key = '${key}' order by created_at`);
  const countAll = () => Number(J.dbOne("select count(*) from public.sales_assignment"));
  /** The SKU keys the ranking of Komersial lists for this actor (the first column of each row links to the key). */
  const visibleKeys = async (a) => {
    const st = await a.goto("/komersial");
    if (st !== 200) throw new Error(`/komersial HTTP ${st}`);
    return a.page.evaluate(() => [...document.querySelectorAll('[data-tile="t-ranking"] a[href^="/komersial/"]')]
      .map((x) => decodeURIComponent((x.getAttribute("href") || "").slice("/komersial/".length))));
  };
  /** Rows of the 14-day table on the SKU page /komersial/<key> (the page reads the Sales view of the database and then the assigned keys). */
  const skuPageRows = async (a, key) => {
    const st = await a.goto(`/komersial/${encodeURIComponent(key)}`);
    if (st !== 200) throw new Error(`/komersial/${key} HTTP ${st}`);
    return a.page.locator("main table").first().locator("tbody tr").count();
  };
  /** The commitment tile of /komersial for this actor: the SKU rows of its form (the label of a row is "<unit> fresh") and the note under the tile. */
  const commitmentTile = async (a) => {
    const st = await a.goto("/komersial");
    if (st !== 200) throw new Error(`/komersial HTTP ${st}`);
    return a.page.evaluate(() => {
      const t = document.querySelector('section[data-tile="t-komitmen"]');
      return { units: [...t.querySelectorAll('input[name^="fresh_"]')].map((i) => i.closest("label").innerText.replace(/\s*fresh\s*$/, "").trim()), note: ((t.querySelector("[data-tile-note]") || {}).innerText || "").replace(/\s+/g, " ") };
    });
  };
  const NOTE_FORM_ONLY = /Komitmen per key dasar butuh penugasan key dasar: penugasan Anda untuk/;
  const form = (a) => ({
    pick: (email) => a.page.locator("#as-email").selectOption(email),
    key: (v) => a.page.locator("#as-key").fill(v),
    customer: (v) => a.page.locator("#as-customer").fill(v),
    note: (v) => a.page.locator("#as-note").fill(v),
    save: () => a.act(/^Simpan (penugasan|perubahan)$/, { within: "main" }),
  });
  const cleanup = (label) => J.setup(label, `delete from public.sales_assignment where note like '${NOTE}%'`);
  const deletes = () => Number(J.dbOne("select count(*) from public.audit_log where table_name = 'sales_assignment' and op = 'DELETE'"));

  await J.step("0", null, "SETUP: jam uji Jum 28 Agu 17.00; login lima role; pilih SKU dari mart (satu unit dengan dua bentuk)", async () => {
    J.clock("2026-08-28T17:00:00+07:00");
    for (const a of Object.values(A)) await a.login();
    J.check("lima role masuk", Object.values(A).every((a) => a.loggedIn), Object.keys(A).join(", "));
    cleanup("sisa penugasan uji A7 dari run sebelumnya dihapus (bila ada)");
    S.deletes0 = deletes();
    const day = J.dbOne(`select max(date)::text from public.commercial_daily where date <= '${DATA_DAY}'`);
    const keys = J.db(`select key from public.commercial_daily where date = '${day}' and (free_fresh_kg + free_frozen_kg) > 0 order by rank, key`).map((r) => r[0]);
    const byBase = new Map();
    for (const k of keys) byBase.set(baseOf(k), [...(byBase.get(baseOf(k)) || []), k]);
    const pick = [...byBase].find(([b, ks]) => b !== "RPA|Karkas" && ks.length >= 2 && ks.some((k) => /\|Fresh$/.test(k)) && ks.some((k) => /\|Frozen$/.test(k)));
    J.log(`    DB mart ${day}: ${keys.length} SKU dengan stok bebas; unit dengan dua bentuk selain RPA|Karkas: ${[...byBase].filter(([b, ks]) => b !== "RPA|Karkas" && ks.length >= 2).map(([b, ks]) => `${b} (${ks.length})`).join(", ") || "tidak ada"}`);
    J.check("DB: ada unit selain RPA|Karkas yang punya stok bebas Fresh dan Frozen", !!pick, "");
    if (!pick) throw new Error("tidak ada unit dengan dua bentuk di mart");
    [S.base, S.forms] = pick;
    S.form = S.forms.find((k) => /\|Fresh$/.test(k));
    S.other = S.forms.find((k) => /\|Frozen$/.test(k));
    J.log(`    dipakai: key bentuk ${S.form}, bentuk lain ${S.other}, key dasar ${S.base}`);
    J.log(`    DB penugasan awal: ${J.db("select sales_rep, email, coalesce(customer, '<semua>'), key, active::text from public.sales_assignment order by key").map((r) => r.join(" | ")).join("; ")}`);
  });

  // ------------------------------------------------------------------------------ 1 open from Komersial, the Sales list
  await J.step("1", lead, "Kepala Sales membuka layar dari Komersial; daftar Sales terbaca walau app_user tertutup baginya", async () => {
    let st = await lead.goto("/komersial");
    J.check("Komersial terbuka", st === 200, `HTTP ${st}`);
    const link = lead.page.locator("[data-assignment-link] a");
    J.check("Komersial memuat tautan 'Penugasan Sales' untuk Kepala Sales", (await link.count()) === 1, `${await link.count()} tautan`);
    await Promise.all([lead.page.waitForURL((u) => u.pathname === "/komersial/assignment"), link.first().click()]);
    await lead.page.waitForLoadState("networkidle").catch(() => {});
    const t = await lead.text("main");
    J.check("layar Penugasan Sales terbuka lewat tautan itu", /Penugasan Sales/.test(t) && lead.page.url().endsWith("/komersial/assignment"), lead.page.url());
    const summary = (await lead.page.locator(`[data-sales="${SALES}"]`).innerText()).replace(/\s+/g, " ");
    J.log(`    commercial_lead  ringkasan: ${summary}`);
    J.check("ringkasan Sales uji: nama dari app_user dan 'RPA|Karkas = semua bentuk' (O21 b)", /E2E Sales/.test(summary) && /RPA\|Karkas = semua bentuk/.test(summary), summary);
    const opts = (await lead.page.locator("#as-email option").allInnerTexts()).map((x) => x.trim());
    J.log(`    commercial_lead  pilihan Sales: ${opts.join(" | ")}`);
    J.check("pilihan Sales memuat pengguna role sales (E2E Sales) dan tidak memuat role lain", opts.some((o) => o.includes(SALES)) && !opts.some((o) => /ppic@|finance@|admin@|lead@|mgmt@/.test(o)), opts.join(" | "));
    const row = lead.page.locator('tr[data-key="RPA|Karkas"]');
    J.check("daftar memuat penugasan awal Sales uji (RPA|Karkas, PT A, aktif)", (await row.count()) === 1 && /PT A/.test(await row.innerText()) && (await row.getAttribute("data-active")) === "1");
    // why the list needs the service client: Kepala Sales reads only her own row of app_user
    const tok = await (await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: lead.email, password: cfg.password }) })).json();
    const r = await fetch(`${cfg.supa}/rest/v1/app_user?select=email,role`, { headers: { apikey: cfg.anon, authorization: `Bearer ${tok.access_token}` } });
    const body = await r.json();
    J.log(`    commercial_lead (langsung ke PostgREST)  GET /rest/v1/app_user → HTTP ${r.status} ${short(JSON.stringify(body), 120)}`);
    J.check("PostgREST: Kepala Sales hanya membaca barisnya sendiri di app_user (karena itu daftar Sales dibaca server dengan kunci layanan)", r.status === 200 && Array.isArray(body) && body.length === 1 && body[0].email === lead.email, `${Array.isArray(body) ? body.length : "-"} baris`);
    await lead.shot("A7-1-layar-kepala-sales");
    // 390 px: the page itself does not scroll sideways (the table scrolls inside its card)
    await lead.page.setViewportSize({ width: 390, height: 844 });
    await lead.goto("/komersial/assignment");
    const over = await lead.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    J.check("390 px: layar Penugasan Sales tanpa gulir horizontal halaman", over <= 1, `selisih ${over} px`);
    await lead.shot("A7-1-layar-kepala-sales-390");
    await lead.page.setViewportSize({ width: 1366, height: 768 });
  });

  // ------------------------------------------------------------------------------------ 2 one form of a SKU
  await J.step("2", sales, "Sales sebelum penugasan baru: hanya SKU RPA|Karkas", async () => {
    const keys = await visibleKeys(sales);
    J.log(`    sales  SKU di peringkat Komersial: ${keys.join(", ")}`);
    J.check("Sales melihat RPA|Karkas", keys.length > 0 && keys.every((k) => baseOf(k) === "RPA|Karkas"), keys.join(", "));
    J.check(`Sales belum melihat ${S.form}`, !keys.includes(S.form));
    J.check("tidak ada tautan 'Penugasan Sales' untuk Sales", (await sales.page.locator("[data-assignment-link]").count()) === 0);
    // the SKU page reads the assigned keys too: a base-key assignment (RPA|Karkas) must show the history of every form (before A7 it showed an empty table)
    const n = await skuPageRows(sales, keys[0]);
    J.check(`halaman SKU ${keys[0]}: Sales dengan penugasan key dasar melihat riwayat 14 hari (bukan tabel kosong)`, n > 0, `${n} baris`);
    // K43 (A8): with the base-key assignment RPA|Karkas the commitment tile offers the Karkas row and has nothing to explain
    const k0 = await commitmentTile(sales);
    J.log(`    sales  tile komitmen: baris ${k0.units.join(", ") || "tidak ada"}`);
    J.check("tile komitmen: Sales dengan penugasan key dasar RPA|Karkas mendapat baris Karkas, tanpa catatan 'butuh penugasan key dasar'", k0.units.includes("Karkas") && !NOTE_FORM_ONLY.test(k0.note), `${k0.units.join(", ")} | ${short(k0.note, 120)}`);
  });

  await J.step("3", lead, "Kepala Sales menugaskan SATU bentuk SKU ke Sales uji; Sales melihat bentuk itu dan bukan bentuk lain (O21 b)", async () => {
    const before = countAll();
    await lead.goto("/komersial/assignment");
    const f = form(lead);
    await f.pick(SALES); await f.key(S.form); await f.customer(""); await f.note(`${NOTE} bentuk`);
    const m = await f.save();
    J.log(`    commercial_lead  ${short(m.ok || m.error || "", 240)}`);
    J.check("pesan: disimpan, mencakup hanya Fresh, dengan catatan komitmen per key dasar", !!m.ok && /Penugasan disimpan/.test(m.ok) && /hanya Fresh/.test(m.ok) && /key dasar/.test(m.ok), m.ok || m.error || "");
    J.check("formulir sesudah simpan: Sales tetap terpilih (kunci berikutnya biasanya untuk Sales yang sama), key, pelanggan dan catatan dikosongkan",
      (await lead.page.locator("#as-email").inputValue()) === SALES && (await lead.page.locator("#as-key").inputValue()) === "" && (await lead.page.locator("#as-note").inputValue()) === "");
    const rows = rowsOf(S.form);
    J.log(`    DB ${S.form}: ${rows.map((r) => r.join(" | ")).join("; ")}`);
    J.check("DB: satu baris baru; sales_rep dipakai ulang (SALES-E2E), customer kosong, aktif, dicap Kepala Sales", rows.length === 1 && rows[0][0] === "SALES-E2E" && rows[0][1] === SALES && rows[0][2] === "<semua>" && rows[0][4] === "true" && rows[0][6] === lead.email, JSON.stringify(rows));
    J.check("DB: jumlah penugasan bertambah satu", countAll() === before + 1, `${before} → ${countAll()}`);
    const t = await lead.text("main");
    J.check("daftar dan ringkasan memuat key bentuk itu (hanya Fresh)", new RegExp(`${S.form.replace(/[|()]/g, "\\$&")} = hanya Fresh`).test(t), short(t, 100));
    const keys = await visibleKeys(sales);
    J.log(`    sales  SKU di peringkat Komersial: ${keys.join(", ")}`);
    J.check(`Sales sekarang melihat ${S.form}`, keys.includes(S.form), keys.join(", "));
    J.check(`Sales tidak melihat ${S.other} (bentuk lain dari unit yang sama)`, !keys.includes(S.other), keys.join(", "));
    J.check("Sales tetap melihat RPA|Karkas", keys.some((k) => baseOf(k) === "RPA|Karkas"));
    await sales.shot("A7-3-sales-melihat-satu-bentuk");
    // K43 (A8): a commitment is per base key, and a one-form assignment does not cover it: no row is offered for the unit, and the tile says why
    const unit = S.base.split("|")[1];
    const k1 = await commitmentTile(sales);
    J.log(`    sales  tile komitmen: baris ${k1.units.join(", ") || "tidak ada"}; catatan: ${short(k1.note, 360)}`);
    J.check(`tile komitmen: tidak ada baris ${unit} untuk Sales dengan penugasan satu bentuk (${S.form}); baris Karkas (key dasar) tetap`, !k1.units.includes(unit) && k1.units.includes("Karkas"), k1.units.join(", "));
    J.check(`tile komitmen: satu kalimat menjelaskan 'komitmen per key dasar butuh penugasan key dasar' dan menyebut ${unit}`, NOTE_FORM_ONLY.test(k1.note) && new RegExp(`penugasan Anda untuk [^.]*\\b${unit.replace(/[()/]/g, "\\$&")}\\b`).test(k1.note), short(k1.note, 300));
    // the refusal the tile used to lead to, by the database itself: Sales write a draft commitment of the base key of the unit with only the one-form assignment
    const tok = await (await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: sales.email, password: cfg.password }) })).json();
    const ins = await fetch(`${cfg.supa}/rest/v1/sales_commitment`, { method: "POST", headers: { apikey: cfg.anon, authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify({ week_start: "2026-08-31", key: S.base, fresh_kg: 100, frozen_kg: 0 }) });
    const ib = await ins.json().catch(() => null);
    J.log(`    sales (langsung ke PostgREST)  POST sales_commitment ${S.base} → HTTP ${ins.status} ${short(JSON.stringify(ib), 160)}`);
    J.check(`PostgREST: komitmen key dasar ${S.base} oleh Sales dengan penugasan ${S.form} ditolak database (assignment_covers: tg_commitment_guard)`, (ins.status === 403 || ins.status === 401) && /tidak ditugaskan kepada Anda/.test(JSON.stringify(ib)), `HTTP ${ins.status} ${short(JSON.stringify(ib), 120)}`);
    J.check("DB: tidak ada komitmen baru untuk unit itu", Number(J.dbOne(`select count(*) from public.sales_commitment where week_start = '2026-08-31' and key = '${S.base}'`)) === 0);
    const [rf, ro] = [await skuPageRows(sales, S.form), await skuPageRows(sales, S.other)];
    J.check(`halaman SKU: ${S.form} berisi riwayat, ${S.other} kosong (bentuk lain tidak ditugaskan)`, rf > 0 && ro === 0, `${rf} baris / ${ro} baris`);
  }, { allow: [{ area: "rest", status: 403, path: /sales_commitment/, why: "penolakan yang diharapkan: komitmen key dasar tanpa penugasan key dasar (tg_commitment_guard, probe API Sales)" }, { area: "rest", status: 401, path: /sales_commitment/, why: "penolakan yang diharapkan: komitmen key dasar tanpa penugasan key dasar (tg_commitment_guard, probe API Sales)" }] });

  await J.step("4", lead, "Kepala Sales menugaskan key dasar (satu unit); Sales melihat semua bentuk; menyimpan yang sama lagi tidak menggandakan baris", async () => {
    await lead.goto("/komersial/assignment");
    const f = form(lead);
    await f.pick(SALES); await f.key(S.base); await f.note(`${NOTE} dasar`);
    const m = await f.save();
    J.log(`    commercial_lead  ${short(m.ok || m.error || "", 240)}`);
    J.check("pesan: disimpan, mencakup semua bentuk, tanpa catatan komitmen", !!m.ok && /semua bentuk/.test(m.ok) && !/Q-v5\.2-53/.test(m.ok), m.ok || m.error || "");
    let keys = await visibleKeys(sales);
    J.log(`    sales  SKU di peringkat Komersial: ${keys.join(", ")}`);
    J.check(`Sales melihat ${S.form} dan ${S.other} (key dasar mencakup semua bentuk)`, keys.includes(S.form) && keys.includes(S.other), keys.join(", "));
    const ro = await skuPageRows(sales, S.other);
    J.check(`halaman SKU ${S.other} sekarang berisi riwayat`, ro > 0, `${ro} baris`);
    // K43 (A8): with the base key the row is offered, nothing is left out, and the save is accepted by the database
    const unit = S.base.split("|")[1];
    const k2 = await commitmentTile(sales);
    J.log(`    sales  tile komitmen: baris ${k2.units.join(", ") || "tidak ada"}`);
    J.check(`tile komitmen: dengan penugasan key dasar ${S.base} baris ${unit} ditawarkan, tanpa catatan 'butuh penugasan key dasar'`, k2.units.includes(unit) && !NOTE_FORM_ONLY.test(k2.note), `${k2.units.join(", ")} | ${short(k2.note, 100)}`);
    const idx = await sales.page.evaluate((u) => { const i = [...document.querySelectorAll('input[name^="fresh_"]')].find((x) => x.closest("label").innerText.replace(/\s*fresh\s*$/, "").trim() === u); return i ? i.name.slice("fresh_".length) : null; }, unit);
    await sales.page.locator(`input[name="fresh_${idx}"]`).fill("100");
    await sales.page.locator(`input[name="frozen_${idx}"]`).fill("0");
    const saved = await sales.act("Simpan draft", { within: 'section[data-tile="t-komitmen"]' });
    J.log(`    sales  ${short(saved.ok || saved.error || "", 220)}`);
    J.check(`Sales menyimpan draft komitmen ${unit} dari tile: diterima database (1 versi baru)`, !!saved.ok && /1 SKU komitmen disimpan sebagai draft/.test(saved.ok) && /1 versi baru/.test(saved.ok), saved.ok || saved.error || "");
    const crow = J.db(`select key, status, fresh_kg::text, created_by from public.sales_commitment where week_start = '2026-08-31' and key = '${S.base}' and deleted_at is null`);
    J.check(`DB: draft komitmen ${S.base} 100 kg oleh Sales`, crow.length === 1 && crow[0][1] === "draft" && Number(crow[0][2]) === 100 && crow[0][3] === sales.email, JSON.stringify(crow));
    J.setup(`draft komitmen uji ${S.base} (A7 langkah 4) dihapus`, `delete from public.sales_commitment where week_start = '2026-08-31' and key = '${S.base}' and created_by = '${sales.email}'`);
    // the same assignment again (a new note): activated and refreshed, still one row
    const n = countAll();
    await lead.goto("/komersial/assignment");
    await f.pick(SALES); await f.key(S.base); await f.note(`${NOTE} dasar (ulang)`);
    const again = await f.save();
    J.log(`    commercial_lead  ${short(again.ok || again.error || "", 200)}`);
    J.check("pesan: penugasan sudah ada, diaktifkan dan catatan diperbarui", !!again.ok && /sudah ada/.test(again.ok), again.ok || again.error || "");
    const rows = rowsOf(S.base);
    J.check("DB: tetap satu baris untuk key dasar itu, catatan diperbarui (upsert pada triple unik)", rows.length === 1 && rows[0][5] === `${NOTE} dasar (ulang)` && countAll() === n, JSON.stringify(rows));
  });

  await J.step("5", lead, "nonaktifkan dan aktifkan: akses Sales mengikuti, tidak ada baris yang dihapus", async () => {
    const n = countAll();
    await lead.goto("/komersial/assignment");
    const row = (k) => `tr[data-key="${k}"]`;
    let m = await lead.act("Nonaktifkan", { within: row(S.form) });
    J.log(`    commercial_lead  ${short(m.ok || m.error || "", 200)}`);
    J.check("pesan: dinonaktifkan", !!m.ok && /^Dinonaktifkan/.test(m.ok), m.ok || m.error || "");
    J.check("DB: bentuk itu nonaktif, barisnya masih ada", rowsOf(S.form).length === 1 && rowsOf(S.form)[0][4] === "false" && countAll() === n);
    let keys = await visibleKeys(sales);
    J.check("Sales masih melihat kedua bentuk (key dasar masih aktif)", keys.includes(S.form) && keys.includes(S.other), keys.join(", "));
    await lead.goto("/komersial/assignment");
    J.check("baris nonaktif ditandai dan ada tombol Aktifkan", (await lead.page.locator(`${row(S.form)}[data-active="0"]`).count()) === 1 && (await lead.page.locator(`${row(S.form)} button:has-text("Aktifkan")`).count()) === 1);
    m = await lead.act("Nonaktifkan", { within: row(S.base) });
    J.check("key dasar dinonaktifkan juga", !!m.ok, m.ok || m.error || "");
    keys = await visibleKeys(sales);
    J.log(`    sales  SKU di peringkat Komersial (kedua penugasan mati): ${keys.join(", ")}`);
    J.check("Sales tidak melihat unit itu lagi, hanya RPA|Karkas", !keys.includes(S.form) && !keys.includes(S.other) && keys.some((k) => baseOf(k) === "RPA|Karkas"), keys.join(", "));
    await lead.goto("/komersial/assignment");
    const s = (await lead.page.locator(`[data-sales="${SALES}"]`).innerText()).replace(/\s+/g, " ");
    J.check("ringkasan tidak lagi memuat dua key itu; menyebut 2 nonaktif", !s.includes(S.form) && !s.includes(`${S.base} =`) && /2 nonaktif/.test(s), s);
    m = await lead.act("Aktifkan", { within: row(S.base) });
    J.check("key dasar diaktifkan lagi", !!m.ok && /^Diaktifkan/.test(m.ok), m.ok || m.error || "");
    keys = await visibleKeys(sales);
    J.check("Sales melihat kedua bentuk lagi", keys.includes(S.form) && keys.includes(S.other), keys.join(", "));
    await lead.goto("/komersial/assignment");
    m = await lead.act("Aktifkan", { within: row(S.form) });
    J.check("key bentuk diaktifkan lagi (kedua penugasan aktif untuk langkah berikutnya)", !!m.ok && rowsOf(S.form)[0][4] === "true", m.ok || m.error || "");
    J.check("DB: tidak ada baris dihapus (jumlah sama)", countAll() === n, `${n} → ${countAll()}`);
    J.check("audit: tidak ada DELETE pada sales_assignment selama langkah ini dan sebelumnya di journey", deletes() === S.deletes0, `${S.deletes0} → ${deletes()}`);
    const who = J.db("select op, actor from public.audit_log where table_name = 'sales_assignment' order by id desc limit 6").map((r) => r.join(" ")).join("; ");
    J.log(`    DB audit (terbaru): ${who}`);
    J.check("audit: perubahan dicatat atas nama Kepala Sales", /UPDATE lead@/.test(who) || new RegExp(`UPDATE ${lead.email}`).test(who), who);
  });

  // ------------------------------------------------------------------------------------------------ 6 refused keys
  await J.step("6", lead, "key yang tidak dikenal, huruf besar/kecil lain dan key kosong ditolak dengan pesan; tidak ada yang ditulis", async () => {
    const n = countAll();
    await lead.goto("/komersial/assignment");
    const f = form(lead);
    await f.pick(SALES);
    const tries = [["RPA|Tidakada|Fresh", /Key "RPA\|Tidakada\|Fresh" tidak dikenal/, "SKU yang tidak ada di master"], [S.form.toLowerCase(), /maksud Anda/, "ejaan huruf kecil"], ["   ", /Isi key SKU/, "key kosong (spasi)"], [`${S.base}|Chilled`, /tidak dikenal/, "bentuk yang tidak ada"]];
    for (const [key, re, why] of tries) {
      await f.key(key); await f.note(`${NOTE} ditolak`);
      const m = await f.save();
      J.log(`    commercial_lead  "${key}" (${why}) → ${short(m.error || m.ok || "", 200)}`);
      J.check(`${why}: ditolak dengan pesan yang jelas`, !m.ok && re.test(m.error || ""), m.error || m.ok || "");
      // a refusal keeps what was typed: Sales user, key and note (React empties a plain <form action> after every action)
      J.check(`${why}: formulir tidak dikosongkan (Sales, key, catatan tetap)`, (await lead.page.locator("#as-email").inputValue()) === SALES && (await lead.page.locator("#as-key").inputValue()) === key && (await lead.page.locator("#as-note").inputValue()) === `${NOTE} ditolak`);
    }
    J.check("DB: tidak ada baris baru", countAll() === n && Number(J.dbOne("select count(*) from public.sales_assignment where note = 'e2e-a7 ditolak'")) === 0, `${n} → ${countAll()}`);
  });

  // ----------------------------------------------------------------------------------------------------------- 7 edit
  await J.step("7", lead, "ubah satu penugasan (catatan, pelanggan) lewat 'Ubah'", async () => {
    await lead.goto("/komersial/assignment");
    await Promise.all([lead.page.waitForURL((u) => u.searchParams.has("edit")), lead.page.locator(`tr[data-key="${S.form}"] a:has-text("Ubah")`).click()]);
    await lead.page.waitForLoadState("networkidle").catch(() => {});
    J.check("formulir berisi penugasan itu (key, e-mail) dan tombolnya 'Simpan perubahan'", (await lead.page.locator("#as-key").inputValue()) === S.form && (await lead.page.locator("#as-email").inputValue()) === SALES && (await lead.page.getByRole("button", { name: "Simpan perubahan" }).count()) === 1);
    const f = form(lead);
    await f.customer("PT B"); await f.note(`${NOTE} diubah`);
    const m = await f.save();
    J.log(`    commercial_lead  ${short(m.ok || m.error || "", 200)}`);
    J.check("pesan: penugasan diubah", !!m.ok && /Penugasan diubah/.test(m.ok), m.ok || m.error || "");
    const rows = rowsOf(S.form);
    J.log(`    DB ${S.form}: ${rows.map((r) => r.join(" | ")).join("; ")}`);
    J.check("DB: pelanggan PT B dan catatan baru; masih satu baris, sales_rep tetap", rows.length === 1 && rows[0][2] === "PT B" && rows[0][5] === `${NOTE} diubah` && rows[0][0] === "SALES-E2E", JSON.stringify(rows));
    // a change into an assignment that already exists is refused
    await lead.goto("/komersial/assignment");
    await Promise.all([lead.page.waitForURL((u) => u.searchParams.has("edit")), lead.page.locator(`tr[data-key="${S.form}"] a:has-text("Ubah")`).click()]);
    await lead.page.waitForLoadState("networkidle").catch(() => {});
    await form(lead).key("RPA|Karkas"); await form(lead).customer("PT A");
    const dup = await form(lead).save();
    J.check("ubah menjadi penugasan yang sudah ada (RPA|Karkas, PT A) ditolak", !dup.ok && /Penugasan yang sama sudah ada/.test(dup.error || ""), dup.error || dup.ok || "");
    J.check("DB: baris tidak berubah oleh percobaan itu", rowsOf(S.form).length === 1 && rowsOf("RPA|Karkas").length === 1);
  });

  // -------------------------------------------------------------------------------------------------- 8 Admin, roles
  await J.step("8", admin, "Admin: tautan dari Admin → Pengguna, boleh menulis; role lain 404", async () => {
    let st = await admin.goto("/admin/pengguna");
    J.check("Admin → Pengguna terbuka", st === 200, `HTTP ${st}`);
    const link = admin.page.locator("[data-assignment-link] a");
    J.check("Pengguna memuat tautan 'Penugasan Sales'", (await link.count()) === 1);
    await Promise.all([admin.page.waitForURL((u) => u.pathname === "/komersial/assignment"), link.first().click()]);
    await admin.page.waitForLoadState("networkidle").catch(() => {});
    J.check("tautan membuka layar Penugasan Sales", /Penugasan Sales/.test(await admin.text("main")) && (await admin.page.locator("#as-email").count()) === 1);
    const opts = await admin.page.locator("#as-email option").allInnerTexts();
    J.check("Admin juga memilih Sales dari daftar (dibaca dengan sesi Admin)", opts.some((o) => o.includes(SALES)), opts.join(" | "));
    const m = await admin.act("Nonaktifkan", { within: `tr[data-key="${S.form}"]` });
    J.check("Admin menonaktifkan satu penugasan", !!m.ok && rowsOf(S.form)[0][4] === "false" && rowsOf(S.form)[0][7] === admin.email, `${m.ok || m.error} | ${JSON.stringify(rowsOf(S.form))}`);
    const a2 = await admin.act("Aktifkan", { within: `tr[data-key="${S.form}"]` });
    J.check("dan mengaktifkannya lagi", !!a2.ok && rowsOf(S.form)[0][4] === "true", a2.ok || a2.error || "");
    const adminHome = await admin.goto("/admin");
    J.check("halaman Admin memuat tautan ke layar", adminHome === 200 && (await admin.page.locator('a[href="/komersial/assignment"]').count()) >= 1);
    for (const [role, a] of [["sales", sales], ["management", A.management], ["ppic", A.ppic]]) {
      st = await a.goto("/komersial/assignment");
      J.check(`${role}: /komersial/assignment → 404`, st === 404, `HTTP ${st}`);
    }
  }, { allow: [{ status: 404, why: "layar Penugasan Sales hanya untuk Admin dan Kepala Sales (area sales_assignment); role lain 404" }] });

  // ------------------------------------------------------------------------------------------------- 9 Sales' API
  await J.step("9", sales, "Sales tidak bisa menulis sales_assignment lewat API (RLS): ubah dan tambah ditolak", async () => {
    const tok = await (await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: sales.email, password: cfg.password }) })).json();
    const h = { apikey: cfg.anon, authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", prefer: "return=representation" };
    const id = J.dbOne(`select id from public.sales_assignment where key = '${S.base}'`);
    const up = await fetch(`${cfg.supa}/rest/v1/sales_assignment?id=eq.${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ active: false, note: `${NOTE} diretas` }) });
    const ub = await up.json().catch(() => null);
    J.log(`    sales (langsung ke PostgREST)  PATCH sales_assignment → HTTP ${up.status} ${short(JSON.stringify(ub), 120)}`);
    J.check("ubah oleh Sales: tidak ada baris berubah (RLS menyembunyikan baris dari UPDATE)", up.status >= 400 || (Array.isArray(ub) && ub.length === 0), `HTTP ${up.status}`);
    J.check("DB: penugasan itu tetap aktif dan catatannya tidak berubah", rowsOf(S.base)[0][4] === "true" && !/diretas/.test(rowsOf(S.base)[0][5]), JSON.stringify(rowsOf(S.base)));
    const n = countAll();
    const ins = await fetch(`${cfg.supa}/rest/v1/sales_assignment`, { method: "POST", headers: h, body: JSON.stringify({ sales_rep: "SALES-E2E", email: sales.email, customer: null, key: "RPA|Lemak", active: true, note: `${NOTE} diretas` }) });
    const ib = await ins.json().catch(() => null);
    J.log(`    sales (langsung ke PostgREST)  POST sales_assignment → HTTP ${ins.status} ${short(JSON.stringify(ib), 160)}`);
    J.check("tambah oleh Sales ditolak (RLS, 403)", ins.status === 403 || ins.status === 401, `HTTP ${ins.status}`);
    J.check("DB: tidak ada baris baru", countAll() === n, `${n} → ${countAll()}`);
  }, { allow: [{ area: "rest", status: 403, why: "penolakan yang diharapkan (probe API Sales)" }, { area: "rest", status: 401, why: "penolakan yang diharapkan (probe API Sales)" }] });

  await J.step("10", null, "SETUP: penugasan uji A7 dihapus; penugasan awal Sales uji utuh", async () => {
    cleanup("penugasan uji A7 (catatan e2e-a7…) dihapus");
    const left = J.db("select sales_rep, email, coalesce(customer, '<semua>'), key, active::text from public.sales_assignment order by key").map((r) => r.join(" | "));
    J.log(`    DB penugasan sesudah: ${left.join("; ")}`);
    J.check("DB: kembali ke penugasan awal (RPA|Karkas untuk Sales uji)", left.length === 1 && /RPA\|Karkas/.test(left[0]), left.join("; "));
  });
  await sleep(100);
  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
