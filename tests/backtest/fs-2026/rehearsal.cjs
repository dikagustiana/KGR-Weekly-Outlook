#!/usr/bin/env node
"use strict";
/**
 * Gladi Agustus–September 2026 di stack lokal (PG16 lokal + PostgREST 12 + mock auth; BUKAN KGR-OS): urutan yang Dika jalankan di
 * production (SIAP-PAKAI §4b, KESIAPAN-PILOT §6), dengan berkas asli dari BACKTEST_DIR (tidak di-commit):
 *   0 SETUP jam uji Sen 19 Okt 2026 08.00 WIB; FS acuan versi 1 (docs/v5.2/kgr-os-data-fs.sql, = KGR-OS) + koreksi versi 2
 *     (docs/v5.3/kgr-os-data-fs-v2.sql); pemetaan fs_line_map disetujui (SETUP: app tidak punya layarnya)
 *   1 Admin: upload jurnal Agustus (wizard /w/2026-08-24/upload, "Accurate — General Ledger / Journal")
 *   2 Admin: upload jurnal September
 *   3 bangun ulang: cron (Bearer CRON_SECRET), diulang sampai antrean habis
 *   4 Finance: Rekonsiliasi Agustus dan September (C59: app vs FS per baris) — angka app vs FS
 *   4b Finance: penyesuaian tutup buku = jurnal DI di FS yang belum dijurnal di Accurate, ditandai diposting
 *   5 Finance: Tutup buku Agustus: kontrol FINAL, override yang perlu (alasan backtest; C59 hanya untuk neraca), Kunci FINAL;
 *     Rekonsiliasi dari FINAL: laba rugi harus sama dengan FS di semua baris
 *   6 sama untuk September
 * Pakai (stack harus hidup, mis. E2E_ONLY=none E2E_KEEP=1 bash tests/e2e/run.sh): source tests/e2e/stack/env.sh; node tests/backtest/fs-2026/rehearsal.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { Journey, cfg, short } = require("../../e2e/lib/e2e.cjs");
const DIR = process.env.BACKTEST_DIR || "/home/user/backtest-data";
const ROOT = path.join(__dirname, "../../..");
const W = "2026-08-24";

async function readRecon(actor) {
  return actor.page.evaluate(() => {
    const rows = (label) => [...document.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((r) => [...r.querySelectorAll("td,th")].map((c) => (c.textContent || "").trim()));
    const strong = document.querySelector("div.fin p strong");
    return { pl: rows("Rekonsiliasi laba rugi"), bs: rows("Rekonsiliasi neraca"), summary: ((strong || { parentElement: null }).parentElement?.textContent || "").replace(/\s+/g, " ").trim(),
      notes: [...document.querySelectorAll("ul.note li, p.note, p.muted")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()), text: (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ") };
  });
}
async function readClose(actor) {
  return actor.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^Kunci FINAL$/.test((b.textContent || "").trim()));
    return { controls: [...document.querySelectorAll('table[aria-label="Kontrol FINAL"] tbody tr')].map((r) => [...r.querySelectorAll("td,th")].map((c) => (c.textContent || "").trim())),
      rejections: [...document.querySelectorAll(".override > ul > li")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()),
      buttonDisabled: btn ? btn.disabled : null, reason: ((document.querySelector(".actionbar .reason") || {}).textContent || "").trim(), text: (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ") };
  });
}
async function uploadFile(J, actor, kind, file) {
  const p = actor.page;
  await actor.goto(`/w/${W}/upload`);
  await p.locator("select.in").first().selectOption(kind);
  await p.locator('input[type="file"]').setInputFiles(file);
  await p.getByRole("button", { name: "Pratinjau", exact: true }).click();
  await p.locator("h2", { hasText: "2. Pratinjau" }).waitFor({ timeout: 240_000 });
  const preview = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  const at = preview.indexOf("2. Pratinjau");
  J.log(`    ${actor.role}  pratinjau ${path.basename(file)}: ${short(preview.slice(at, at + 700), 700)}`);
  const btn = p.getByRole("button", { name: "Simpan ke database" });
  if (await btn.isDisabled()) return { preview, unchanged: true, ok: "tidak ada perubahan (berkas yang sama sudah tersimpan): tombol Simpan nonaktif" };
  const answered = p.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 280_000 });
  await btn.click(); await answered; await p.waitForTimeout(1500);
  const msg = await actor.message();
  J.log(`    ${actor.role}  simpan: ${short(msg.ok || msg.error || "(tanpa pesan)", 400)}`);
  return { preview, ...msg };
}
// Jurnal usulan (DI) di FS v2 (sheet "DI - Note" / "DI - Sep wp") yang belum dijurnal di Accurate per 18 Okt: masuk app sebagai penyesuaian
// tutup buku laba rugi (tanda P&L: + menambah laba). Angka agregat saja; pos = baris rencana app (pl_line).
const DI = {
  "2026-08": [
    ["DI-05", "Penjualan LB yang seharusnya masuk Agustus (performa)", "Revenue - LB Main Product", "accrual", "111.496.000"],
    ["DI-06", "Reklas penjualan sampel by-product dari uang muka", "Revenue - LB By Product", "accrual", "629.600"],
    ["DI-05", "HPP LB atas penjualan tersebut (persediaan dalam perjalanan)", "COGS - Live Bird", "unbilled_revaluation", "-117.513.717,18"],
    ["DI-06", "Selisih penutupan uang muka lebih bayar", "Other Expense", "other", "-1.185"],
    ["PPh22", "Selisih beban pajak (PPh 22) di FS; tanpa nota DI", "Tax expenses", "other", "513.119"],
  ],
  "2026-09": [
    ["DI-01", "COGS unbilled: nilai persediaan per 1 Sep (overvalue)", "COGS - Live Bird", "inventory_adj", "48.354.462"],
    ["DI-03", "Jasa angkut LB untuk potong 3 batch: ke uang muka", "Other COGS - Expedition", "parked_cost", "12.000.000"],
    ["DI-02", "Biaya RPA yang sudah terjadi: ke uang muka", "Maintenance Expenses", "parked_cost", "43.977.623,33"],
    ["DI-02", "Biaya RPA yang sudah terjadi: bagian beban lain", "Other Expense", "other", "100.000"],
  ],
};
async function cron(J) {
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${cfg.base}/api/cron/rebuild`, { headers: { authorization: `Bearer ${cfg.cronSecret}` } });
    const body = await res.json().catch(() => ({}));
    const q = J.dbOne("select count(*) from public.rebuild_queue where status in ('queued','running')");
    J.log(`    cron #${i + 1}: HTTP ${res.status} drained ${JSON.stringify(body.drained ? { done: body.drained.done, failed: body.drained.failed } : body).slice(0, 200)}; antrean tersisa ${q}`);
    if (body.drained && body.drained.failed) J.log(`      catatan: ${short((body.drained.notes || []).filter((n) => /GAGAL/.test(n)).join(" | "), 600)}`);
    if (q === "0") return;
  }
}

(async () => {
  const J = new Journey("BT-FS", "gladi Agustus–September 2026: jurnal asli lewat upload app, bangun ulang, rekonsiliasi FS (C59), FINAL");
  const admin = await J.actor("admin"), fin = await J.actor("finance");
  const gl = { "2026-08": path.join(DIR, "out/GL-Accurate-Agustus-2026.xlsx"), "2026-09": path.join(DIR, "out/GL-Accurate-September-2026.xlsx") };

  await J.step("0", null, "SETUP: jam uji Sen 19 Okt 08.00 WIB; FS acuan v1 (= KGR-OS) + koreksi v2; pemetaan FS disetujui", async () => {
    J.clock("2026-10-19T08:00:00+07:00");
    J.setupFile("FS acuan versi 1 (B-R91, sama dengan KGR-OS)", path.join(ROOT, "docs/v5.2/kgr-os-data-fs.sql"));
    J.setupFile("koreksi FS versi 2 (berkas 18 Okt; akrual Commission + Storage 43.845.013)", path.join(ROOT, "docs/v5.3/kgr-os-data-fs-v2.sql"));
    J.setup("fs_line_map: 15 baris agreed (Finance menyetujui pemetaan; tidak ada layarnya di app)", "update public.fs_line_map set status = 'agreed', updated_by = 'backtest (setup)'");
    // KGR-OS has run this data bundle (B-R89, 213 accounts); the e2e seed is the older 208-account coa_map
    J.setupFile("coa_map B-R89 (sama dengan KGR-OS: 213 akun, kolom Q FS)", path.join(ROOT, "docs/v5.2/kgr-os-coa-fix.sql"));
    J.setup("antrean bangun ulang 1 Agu–30 Sep (coa_map berubah)", "insert into public.rebuild_queue (date, reason) select d::date, 'backtest: coa_map B-R89' from generate_series(date '2026-08-01', date '2026-09-30', interval '1 day') d where not exists (select 1 from public.rebuild_queue q where q.date = d::date and q.status = 'queued')");
    const db = J.db("select (select count(*) from public.gl_line where deleted_at is null), (select min(date)||'..'||max(date) from public.gl_line where deleted_at is null), (select count(*) from public.tb_opening where deleted_at is null), (select string_agg(week_start::text||':'||update_date::text, ',' order by week_start) from public.week)")[0];
    J.log(`    DB awal: gl_line ${db[0]} (${db[1]}); tb_opening ${db[2]} baris; minggu ${db[3]}`);
    for (const a of [admin, fin]) await a.login();
    J.check("FS acuan Agustus dan September ada, September dengan versi 2", J.dbOne("select count(*) from public.fs_statement_line where version = 2") === "12");
  });

  for (const m of ["2026-08", "2026-09"]) {
    await J.step(`1-${m}`, admin, `Admin: upload jurnal ${m} lewat wizard (Accurate — General Ledger / Journal)`, async () => {
      const r = await uploadFile(J, admin, "accurate_journal", gl[m]);
      J.check(`jurnal ${m} tersimpan`, !!r.ok && !r.error, r.ok || r.error || "");
      const s = J.db(`select count(*), sum(debit), sum(credit) from public.gl_line where deleted_at is null and date between '${m}-01' and (date '${m}-01' + interval '1 month' - interval '1 day')::date`)[0];
      J.log(`    DB gl_line ${m}: ${s[0]} baris, Σ debit ${s[1]}, Σ kredit ${s[2]}`);
      J.check(`DB: gl_line ${m} = berkas (${m === "2026-08" ? 2431 : 1942} baris)`, s[0] === (m === "2026-08" ? "2431" : "1942"), s.join(" "));
    }, { allow: [{ status: 404, why: "prefetch" }] });
  }

  await J.step("3", null, "bangun ulang lewat cron sampai antrean habis", async () => {
    const q0 = J.db("select status, count(*), min(date), max(date) from public.rebuild_queue group by status order by status");
    J.log(`    antrean sebelum: ${q0.map((r) => r.join(" ")).join("; ")}`);
    await cron(J);
    const q1 = J.db("select status, count(*), min(date), max(date) from public.rebuild_queue group by status order by status");
    J.log(`    antrean sesudah: ${q1.map((r) => r.join(" ")).join("; ")}`);
    const ds = J.db("select table_name, count(*), min(scope), max(scope) from public.data_status group by table_name order by table_name");
    J.log(`    data_status: ${ds.map((r) => r.join(" ")).join("; ")}`);
    J.check("tidak ada tanggal gagal dibangun", !q1.some((r) => r[0] === "failed"), q1.map((r) => r.join(" ")).join("; "));
  });

  for (const m of ["2026-08", "2026-09"]) {
    await J.step(`4-${m}`, fin, `Finance: Rekonsiliasi ${m} (C59) — angka app vs FS per baris`, async () => {
      const st = await fin.goto(`/m/${m}/rekonsiliasi`);
      const r = await readRecon(fin);
      J.log(`    finance  HTTP ${st}; ${short(r.summary, 300)}`);
      for (const row of [...r.pl, ...r.bs]) J.log(`      ${row.join(" | ")}`);
      J.check(`halaman Rekonsiliasi ${m} terbuka`, st === 200, `HTTP ${st}`);
      await fin.shot(`BT-FS-rekon-${m}`);
    });
  }

  for (const m of ["2026-08", "2026-09"]) {
    await J.step(`4b-${m}`, fin, `Finance: penyesuaian tutup buku ${m} = jurnal DI di FS (belum dijurnal di Accurate), lalu Tandai diposting`, async () => {
      const adj = () => J.db(`select a.id, a.code, a.pl_line, a.amount, a.posted from public.closing_adjustment a join public.month_outlook o on o.id = a.month_outlook_id where o.month = '${m}-01' and a.deleted_at is null order by a.created_at, a.id`);
      const before = adj();
      J.log(`    DB sebelum: ${before.length} penyesuaian${before.length ? ` (${before.map((r) => `${r[1]} ${r[2]} ${r[3]}${r[4] === "t" ? " diposting" : ""}`).join("; ")})` : ""}`);
      const num = (x) => Number(x.replace(/\./g, "").replace(",", ".")).toFixed(2);
      // a row that is already there with the same code, line and amount (the M4 migration seeds DI-01 … DI-05 of September) is used, not added twice
      const match = (rows, [code, , line, , amount]) => rows.find((r) => r[1] === code && r[2] === line && Number(r[3]).toFixed(2) === num(amount));
      await fin.goto(`/m/${m}/tutup-buku`);
      const form = 'form:has(button:has-text("Tambah penyesuaian"))';
      for (const d of DI[m]) {
        if (match(adj(), d)) { J.log(`    finance  ${d[0]} ${d[2]} ${d[4]} sudah tercatat (migrasi M4): dipakai`); continue; }
        const [code, desc, line, kind, amount] = d;
        const f = fin.page.locator(form);
        await f.locator('input[name="code"]').fill(code); await f.locator('input[name="description"]').fill(desc);
        await f.locator('input[name="pl_line"]').fill(line); await f.locator('select[name="kind"]').selectOption(kind);
        await f.locator('input[name="amount"]').fill(amount);
        const r = await fin.act("Tambah penyesuaian", { within: form });
        J.log(`    finance  tambah ${code} ${line} ${amount}: ${short(r.ok || r.error || "", 120)}`);
        await fin.goto(`/m/${m}/tutup-buku`);
      }
      // only the DI of the FS are posted; other rows (M4 seeds the FS v2 does not carry) stay unposted: FINAL sums posted rows only
      const now = adj();
      for (const d of DI[m]) {
        const row = match(now, d);
        if (!row || row[4] === "t") continue;
        const within = `form:has(input[name="id"][value="${row[0]}"])`;
        await fin.page.locator(within).locator('input[name="gl_voucher"]').fill("DI (belum dijurnal)");
        await fin.act("Tandai diposting", { within });
        J.log(`    finance  tandai diposting ${d[0]} ${d[2]} ${d[4]}`);
        await fin.goto(`/m/${m}/tutup-buku`);
      }
      const left = adj().filter((r) => r[4] !== "t");
      if (left.length) J.log(`    finance  tidak diposting (bukan DI di FS v2): ${left.map((r) => `${r[1]} ${r[2]} ${r[3]}`).join("; ")}`);
      const db = J.db(`select count(*), count(*) filter (where posted), coalesce(sum(amount) filter (where posted), 0) from public.closing_adjustment a join public.month_outlook o on o.id = a.month_outlook_id where o.month = '${m}-01' and a.deleted_at is null`)[0];
      const want = DI[m].length, sum = DI[m].reduce((t, x) => t + Number(num(x[4])), 0).toFixed(2);
      J.log(`    DB closing_adjustment ${m}: ${db[0]} baris, ${db[1]} diposting, Σ posted ${db[2]} (DI FS: ${want} baris, Σ ${sum})`);
      J.check(`DB: ${want} penyesuaian DI ${m} diposting, Σ posted = ${sum}`, db[1] === String(want) && Number(db[2]).toFixed(2) === sum, db.join(" "));
    });
  }

  for (const m of ["2026-08", "2026-09"]) {
    await J.step(`5-${m}`, fin, `Finance: Tutup buku ${m}: kontrol FINAL, override (alasan backtest) untuk penolakan di luar C59, Kunci FINAL`, async () => {
      await fin.goto(`/m/${m}/tutup-buku`);
      const c = await readClose(fin);
      J.log(`    finance  kontrol FINAL: ${c.controls.map((x) => `${x[0]} ${x[2]}`).join(", ")}`);
      J.log(`    finance  penolakan: ${c.rejections.map((x) => short(x, 160)).join(" || ") || "-"}; tombol ${c.buttonDisabled ? "nonaktif" : "aktif"}; ${c.reason}`);
      const codes = c.rejections.map((x) => x.split(" ")[0]).filter((x) => /^C\d+$/.test(x) && x !== "C59");
      for (const code of codes) {
        await fin.page.locator('.override select[name="code"]').selectOption(code).catch(() => {});
        await fin.page.locator('.override input[name="reason"]').fill(`Backtest Agu–Sep 2026 (stack lokal): ${code} di luar cakupan jurnal yang dimuat; dicatat di docs/v5.3/backtest-fs/REPORT.md`);
        await fin.page.locator('.override input[name="evidence"]').fill("docs/v5.3/backtest-fs/REPORT.md");
        const o = await fin.act("Catat override"); J.log(`    finance  override ${code}: ${short(o.ok || o.error || "(formulir hilang)", 160)}`);
      }
      await fin.goto(`/m/${m}/tutup-buku`);
      const c1 = await readClose(fin);
      if (c1.rejections.some((x) => x.startsWith("C59"))) {
        await fin.goto(`/m/${m}/rekonsiliasi`);
        const r0 = await readRecon(fin);
        J.log(`    finance  C59 sebelum override (jurnal + DI terposting): ${short(r0.summary, 200)}`);
        await fin.goto(`/m/${m}/tutup-buku`);
        await fin.page.locator('.override select[name="code"]').selectOption("C59").catch(() => {});
        await fin.page.locator('.override input[name="reason"]').fill(`Backtest ${m}: laba rugi = FS sesudah DI; neraca beda karena DI belum dijurnal di Accurate${m === "2026-09" ? ", 1102008 Temporary Account di kas" : ""} dan D9 (REPORT.md §C59)`);
        await fin.page.locator('.override input[name="evidence"]').fill("docs/v5.3/backtest-fs/REPORT.md");
        const o = await fin.act("Catat override");
        J.log(`    finance  override C59: ${short(o.ok || o.error || "", 120)}; DB: ${J.dbOne(`select count(*) from public.release_override where scope_kind = 'month' and scope = '${m}-01:FINAL' and code = 'C59' and deleted_at is null`)} baris`);
        await fin.goto(`/m/${m}/tutup-buku`);
      }
      const c2 = await readClose(fin);
      J.log(`    finance  sesudah override: penolakan ${c2.rejections.map((x) => short(x, 120)).join(" || ") || "-"}; tombol ${c2.buttonDisabled ? "nonaktif" : "aktif"}`);
      if (c2.buttonDisabled === false) {
        const f = await fin.act("Kunci FINAL", { exact: true, timeout: 280_000 });
        J.log(`    finance  ${short(f.ok || f.error || "", 300)}`);
        J.check(`FINAL ${m} dikunci`, !!f.ok, f.ok || f.error || "");
        await fin.goto(`/m/${m}/rekonsiliasi`);
        const r = await readRecon(fin);
        J.log(`    finance  Rekonsiliasi dari FINAL: ${short(r.summary, 300)}`);
        for (const row of [...r.pl, ...r.bs]) J.log(`      ${row.join(" | ")}`);
        const plDiff = r.pl.filter((x) => x[5] !== "sama");
        J.check(`C59 laba rugi ${m} dari FINAL (jurnal + DI) = FS di semua baris`, r.pl.length > 0 && plDiff.length === 0, plDiff.map((x) => `${x[0]} ${x[4]}`).join("; ") || `${r.pl.length} baris sama`);
      } else J.check(`FINAL ${m} bisa dikunci sesudah override`, false, c2.rejections.join(" | ") || c2.reason);
    });
  }
  await J.done();
})().catch((e) => { console.error(e); process.exit(1); });
