#!/usr/bin/env node
"use strict";
// journey F19 (PRD v5.2-A R45 "rebuild satu tanggal dua kali → solvency_monthly identik", R46 route cron): the nightly route
// drains the queue; rebuilding the same date again must not change the monthly solvency (idempotent builders).
// The queue row is what the database trigger `needs_rebuild` writes after a data change; here it is inserted as a labelled SETUP.
const { Journey, cfg, short } = require("./lib/e2e.cjs");

const DATE = "2026-08-28"; // Friday: the date the data stands on after journey T7 (run.sh runs F19 on the database T7 leaves)
const HASH = `select md5(coalesce(string_agg((to_jsonb(s) - 'updated_at' - 'updated_by')::text, '|' order by s.month), '')), count(*) from public.solvency_monthly s`;
const HASH_PL = `select md5(coalesce(string_agg((to_jsonb(p) - 'updated_at' - 'updated_by' - 'id')::text, '|' order by p.date, p.pl_line, p.basis), '')), count(*) from public.pl_daily_v4 p where p.date between '2026-08-01' and '2026-08-31'`;

async function cron(J, headers) {
  const r = await fetch(`${cfg.base}/api/cron/rebuild`, { headers });
  let body = {};
  try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, body };
}

(async () => {
  const J = new Journey("F19", "rebuild satu tanggal dua kali lewat route cron → solvency_monthly identik");
  await J.step("1", null, "route cron: tanpa secret ditolak (R46)", async () => {
    J.clock("2026-08-28T17:00:00+07:00");
    const a = await cron(J, {});
    J.log(`    cron  GET /api/cron/rebuild (tanpa Authorization) → HTTP ${a.status}`);
    J.check("tanpa secret → 401", a.status === 401, `HTTP ${a.status}`);
    const b = await cron(J, { authorization: "Bearer salah" });
    J.log(`    cron  GET /api/cron/rebuild (secret salah) → HTTP ${b.status}`);
    J.check("secret salah → 401", b.status === 401, `HTTP ${b.status}`);
  });
  const hashes = [];
  const finance = await J.actor("finance");
  const EMPTY = (d) => `delete from public.solvency_monthly; delete from public.cash_position_daily where date = '${d}'; delete from public.ccc_daily where date = '${d}';`;
  await J.step("2", finance, `solvency_monthly sebelum rebuild: dibangun oleh sesi Finance (Input → Perbarui status tugas)`, async () => {
    await finance.login();
    J.clock("2026-08-28T17:05:00+07:00");
    J.setup(`mart solvabilitas dan kas ${DATE} dikosongkan, antrean rebuild ${DATE}`, `${EMPTY(DATE)} insert into public.rebuild_queue (date, reason) values ('${DATE}', 'e2e F19 sesi')`);
    await finance.goto("/input?panel=grid");
    const m = await finance.act("Perbarui status tugas");
    J.log(`    finance  ${short(m.ok || m.error || "", 160)}`);
    const [h, n] = J.db(HASH)[0];
    const [hp, np] = J.db(HASH_PL)[0];
    hashes.push({ label: "sesi Finance", solvency: h, pl: hp });
    J.log(`    DB solvency_monthly: ${n} baris, sidik ${h}; pl_daily_v4 Agustus: ${np} baris, sidik ${hp}`);
    J.check("prasyarat: rebuild oleh sesi Finance menulis solvency_monthly", Number(n) === 1, `${n} baris`);
  });
  await J.step("2b", null, `route cron: antrean dikuras`, async () => {
    J.clock("2026-08-28T17:10:00+07:00");
    const r0 = await cron(J, { authorization: `Bearer ${cfg.cronSecret}` });
    J.log(`    cron  GET /api/cron/rebuild → HTTP ${r0.status} ${JSON.stringify({ selesai: r0.body.drained?.done, gagal: r0.body.drained?.failed })}`);
    J.check("route cron 200", r0.status === 200, `HTTP ${r0.status}`);
  });
  for (const i of [1, 2]) {
    await J.step(`3.${i}`, null, `rebuild ${DATE} ke-${i}: antrean → route cron → solvency_monthly`, async () => {
      J.clock(`2026-08-28T17:${10 + i * 5}:00+07:00`);
      // the builders write only what changed ("0 ditulis"), so the marts of the date are emptied first: the rebuild must write them again, the same
      J.setup(`mart solvabilitas dan kas ${DATE} dikosongkan, antrean rebuild ${DATE} (yang ditulis trigger needs_rebuild sesudah perubahan data)`,
        `${EMPTY(DATE)} insert into public.rebuild_queue (date, reason) values ('${DATE}', 'e2e F19 ke-${i}')`);
      J.check("mart solvency_monthly kosong sebelum rebuild", J.dbOne("select count(*) from public.solvency_monthly") === "0");
      const queued = J.dbOne(`select count(*) from public.rebuild_queue where status = 'queued'`);
      const r = await cron(J, { authorization: `Bearer ${cfg.cronSecret}` });
      J.log(`    cron  GET /api/cron/rebuild (Authorization: Bearer CRON_SECRET) → HTTP ${r.status} ${JSON.stringify({ antrean: queued, selesai: r.body.drained?.done, gagal: r.body.drained?.failed })}`);
      J.check("route cron 200 dan menguras antrean", r.status === 200 && r.body.drained?.done >= 1 && r.body.drained?.failed === 0, short(JSON.stringify(r.body.drained?.notes?.[0] ?? r.body), 200));
      J.xcheck("rebuild lewat route cron menulis ulang solvency_monthly", "temuan A5 Q-v5.2-51 (belum ada R)", J.dbOne("select count(*) from public.solvency_monthly") === "1",
        "builder kas membaca minggu lewat computeForWeek → klien sesi; route cron tanpa sesi = anon, minggu terbaca kosong, solvabilitas dan CCC tidak dibangun");
      J.check("tidak ada antrean tersisa", J.dbOne(`select count(*) from public.rebuild_queue where status in ('queued','running','failed')`) === "0");
      const [h] = J.db(HASH)[0], [hp] = J.db(HASH_PL)[0];
      hashes.push({ label: `rebuild ke-${i}`, solvency: h, pl: hp });
      J.log(`    DB solvency_monthly sidik ${h}; pl_daily_v4 Agustus sidik ${hp}`);
    });
  }
  await J.step("4", null, "hasil: sidik solvency_monthly dan pl_daily_v4 identik", async () => {
    const [a, b, c] = hashes;
    J.check("solvency_monthly: rebuild cron ke-1 = ke-2 (F19)", b.solvency === c.solvency, `${b.solvency} vs ${c.solvency}`);
    J.xcheck("solvency_monthly: rebuild cron = rebuild sesi Finance", "temuan A5 Q-v5.2-51 (belum ada R)", a.solvency === b.solvency, `${a.solvency} vs ${b.solvency}`);
    J.check("pl_daily_v4 Agustus: rebuild cron ke-1 = ke-2 (F19)", b.pl === c.pl, `${b.pl} vs ${c.pl}`);
    J.xcheck("pl_daily_v4 Agustus: rebuild cron = rebuild sesi Finance (forecast po → runrate di tanggal data)", "temuan A5 Q-v5.2-51 (belum ada R)", a.pl === b.pl, `${a.pl} vs ${b.pl}`);
  });
  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
