#!/usr/bin/env node
"use strict";
// journey O (PRD v5.2-A R70; v5.1 spec docs/v5.1/irisan-2.md "journey O", steps O2 and O5), on the prepared database (fixture week 24-30 Aug, flags on,
// before T7): one clock for the whole app and data that moves the update date.
//   O2  R11/K39 + R12/K40: Cost Accounting uploads the WP of the batch of 26 Aug; the update date of the week moves 26 -> 27 Aug and the message of
//       the upload says so; the rebuild queue holds 26/08 (the trigger of the batch) and 27/08 (queue up to the data date) and both are processed
//   O5  R10/K38: the wall clock is 17 Oct 2026, the data is of 27 Aug: the decision form of the Direktur Operasional is for the cut date of the
//       WALL clock + 1 (Sun 18/10), not the data date + 1, and the tile says "Data per 27 Agu · potong Min 18/10"; with wall = data (Thu 27 Aug)
//       the note is absent and the cut date is 28/08
// v5.2 differs from the v5.1 run in the data, not in the rule: the fixture seed of this stack already says "data of 27 Aug" (week.update_date) and
// the WP of the batch of 26 Aug is the upload this journey does, so SETUP puts the update date back to 26 Aug first (the state before that WP),
// otherwise nothing would move; the v5.1 run did the same with its own database (update_date 26 -> 27 Aug).
const { Journey, cfg, short } = require("./lib/e2e.cjs");

const WEEK = "2026-08-24";
const BATCH = "126/PO/KGR/08/2026";
const idNum = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

(async () => {
  const J = new Journey("O", "satu jam untuk data dan aplikasi: upload WP memajukan tanggal data dan antrean (K39, K40), tanggal potong dari jam dinding (K38) (v5.1 O2, O5)");
  const A = {};
  for (const r of ["cost_accounting", "operations_director"]) A[r] = await J.actor(r);
  const week = () => J.db(`select update_date::text, status from public.week where week_start = '${WEEK}'`)[0];
  const queue = (since) => J.db(`select date::text, reason, status from public.rebuild_queue where created_at >= '${since}'::timestamptz order by date, created_at`);
  const queueDates = (rows) => [...new Set(rows.map((r) => r[0]))].sort();
  const wp = [["batch", "kg_lb", "ekor", "kode_item", "kg"],
    [BATCH, 12089.6, 6300, "JLB0922", 5500.0], [BATCH, "", "", "JLB0927", 3675.0], [BATCH, "", "", "JLB0092", 560.0], [BATCH, "", "", "JLB0078", 350.0],
    [BATCH, "", "", "JLB0135", 540.0], [BATCH, "", "", "JLB0080", 650.0], [BATCH, "", "", "JLB0118", 45.0], [BATCH, "", "", "JLB0116", 250.0], [BATCH, "", "", "JLB0120", 150.0]];
  let t0 = null;

  await J.step("0", null, "SETUP: jam uji Kam 27 Agu 10.55; tanggal data minggu 24/08 dikembalikan ke 26 Agu (sebelum WP batch 26 Agu); login", async () => {
    J.clock("2026-08-27T10:55:00+07:00");
    J.setup(`week.update_date = 2026-08-26 untuk minggu ${WEEK} (keadaan sebelum WP batch ${BATCH} masuk; seed fixture sudah 27 Agu)`, `update public.week set update_date = date '2026-08-26' where week_start = '${WEEK}'`);
    for (const a of Object.values(A)) await a.login();
    J.check("dua role masuk", Object.values(A).every((a) => a.loggedIn), Object.keys(A).join(", "));
    J.log(`    DB minggu ${WEEK}: tanggal data ${week()[0]}, status ${week()[1]}; antrean belum selesai: ${J.dbOne("select count(*) from public.rebuild_queue where status in ('queued','running','failed')")}; WP di batch ${BATCH}: ${J.dbOne(`select count(*) from public.batch_output_sku o join public.batch b on b.id = o.batch_id where b.batch_ref = '${BATCH}' and o.source = 'WP' and o.deleted_at is null`)} baris`);
    J.check("awal: tanggal data 26 Agu, antrean kosong, belum ada baris WP batch 26 Agu", week()[0] === "2026-08-26" && J.dbOne("select count(*) from public.rebuild_queue where status in ('queued','running','failed')") === "0"
      && J.dbOne(`select count(*) from public.batch_output_sku o join public.batch b on b.id = o.batch_id where b.batch_ref = '${BATCH}' and o.source = 'WP' and o.deleted_at is null`) === "0");
  });

  await J.step("O2", A.cost_accounting, `Cost Accounting: upload WP batch ${BATCH} → tanggal data 26 → 27 Agu (K39), antrean 26/08 dan 27/08 diproses (K40)`, async () => {
    J.clock("2026-08-27T11:00:00+07:00");
    t0 = J.dbOne("select now()::text");
    const r = await A.cost_accounting.paste("costing_wp", wp);
    J.log(`    DB minggu ${WEEK} sesudah upload: tanggal data ${week()[0]}`);
    J.check("WP tersimpan: 9 dari 9 baris lolos cek", !!r.ok && /9 dari 9 baris lolos/.test(r.ok), r.ok || r.error || "");
    J.check("pesan upload menyebut tanggal data minggu itu maju: 2026-08-24: 2026-08-26 → 2026-08-27 (K39)", !!r.ok && /tanggal update minggu 2026-08-24: 2026-08-26 → 2026-08-27/.test(r.ok), r.ok || r.error || "");
    J.check("DB: tanggal data minggu 24/08 = 27 Agu", week()[0] === "2026-08-27", week()[0]);
    const q = queue(t0);
    J.log(`    DB antrean sejak upload: ${q.map((x) => `${x[0]} ${x[1]} ${x[2]}`).join("; ") || "tidak ada"}`);
    const dates = queueDates(q);
    J.check("DB: antrean memuat 26/08 (pemicu batch) dan 27/08 (sampai tanggal data, K40), dan tidak lebih dari itu", dates.includes("2026-08-26") && dates.includes("2026-08-27") && dates.every((d) => d <= "2026-08-27"), dates.join(", "));
    J.check("DB: semua baris antrean itu selesai (tidak ada queued, running atau failed)", q.length > 0 && q.every((x) => x[2] === "done"), q.map((x) => x[2]).join(","));
    J.check("pesan upload menyebut rebuild selesai", /Rebuild: \d+ selesai/.test(r.ok || ""), short(r.ok || "", 200));
    J.log(`    DB commercial_daily 27/08 Karkas fresh: Rp ${J.dbOne("select cost_per_kg::text from public.commercial_daily where date = '2026-08-27' and key = 'RPA|Karkas|Fresh'")}/kg, status ${J.dbOne("select cost_status from public.commercial_daily where date = '2026-08-27' and key = 'RPA|Karkas|Fresh'")}`);
    await A.cost_accounting.shot("O-O2-costacc-wp");
    // wall = data date: the cut date of the decision form is the day after wall (28/08), no note about the data date
    const s = await A.operations_director.goto(`/minggu-ini/${WEEK}`);
    J.check("Minggu ini terbuka untuk Direktur Operasional (jam dinding = tanggal data)", s === 200, `HTTP ${s}`);
    const date = await A.operations_director.page.locator('section[data-tile="sim-lb"] input[name="date"]').inputValue();
    const note = ((await A.operations_director.page.locator('section[data-tile="sim-lb"] [data-tile-note]').first().innerText()) || "").replace(/\s+/g, " ");
    J.log(`    operations_director  form date=${date}; catatan simulasi: ${short(note, 200)}`);
    J.check("jam dinding = tanggal data: form untuk potong 28/08 dan tanpa catatan 'Data per'", date === "2026-08-28" && !/Data per/.test(note), `date=${date}`);
  });

  await J.step("O5", A.operations_director, "jam dinding 17 Okt, data 27 Agu: form keputusan harga LB untuk potong dari jam dinding + 1 (18/10) dan catatan 'Data per 27 Agu · potong Min 18/10' (K38)", async () => {
    J.clock("2026-10-17T10:00:00+07:00");
    J.log(`    DB tanggal data minggu ${WEEK}: ${week()[0]}; jam uji ${J.now()}`);
    const s = await A.operations_director.goto(`/minggu-ini/${WEEK}`);
    J.check("Minggu ini terbuka untuk Direktur Operasional", s === 200, `HTTP ${s}`);
    const tile = A.operations_director.page.locator('section[data-tile="sim-lb"]');
    const date = await tile.locator('input[name="date"]').inputValue();
    const btn = ((await tile.locator("button").last().innerText()) || "").replace(/\s+/g, " ");
    const note = ((await tile.locator("[data-tile-note]").first().innerText()) || "").replace(/\s+/g, " ");
    J.log(`    operations_director  form date=${date}; tombol "${btn}"; catatan: ${short(note, 220)}`);
    J.check("form keputusan: date = 2026-10-18 (jam dinding + 1), bukan 2026-08-28 (tanggal data + 1)", date === "2026-10-18", `date=${date}`);
    J.check("tombol: 'Putuskan Rp … untuk potong 18/10'", /^Putuskan Rp [\d.]+ untuk potong 18\/10$/.test(btn), btn);
    J.check("catatan simulasi: 'Data per 27 Agu · potong Min 18/10'", /Data per 27 Agu · potong Min 18\/10/.test(note), short(note, 200));
    J.check("tanggal data di database tetap 27 Agu (jam dinding tidak mengubah data)", week()[0] === "2026-08-27", week()[0]);
    await A.operations_director.shot("O-O5-opsdir-jam-dinding", { fullPage: false });
  });

  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
