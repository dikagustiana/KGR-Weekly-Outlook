#!/usr/bin/env node
"use strict";
// SETUP of the e2e database before the journeys (PRD v5.2-A R70): everything here is a setup, not a flow under test.
//   1. flags as on KGR-OS after v5.1: every module on, v4_release (strict release) on, v5_costing starting 2026-08-01
//   2. the one admin step the brief allows: Admin → Modul → "Bangun ulang" of August, so the data marts exist
// Every other role flow starts from this state. Run by run.sh after stack/up.sh.
const { Journey, cfg, short } = require("./lib/e2e.cjs");

(async () => {
  const J = new Journey("prepare", "SETUP: flag modul dan bangun ulang awal (satu-satunya langkah Admin)");
  J.clock(process.env.E2E_CLOCK_START || "2026-08-24T08:00:00+07:00");
  await J.step("S1", null, "flag modul (SETUP, SQL langsung)", async () => {
    J.setup("semua flag m*, v4_*, v5_* hidup, v4_release hidup (ketat); v5_costing mulai 2026-08-01; v6_* tetap bawaan migrasi (mati, Admin saja)", `
      update public.app_setting set value = '{"enabled": true}'::jsonb where key not like 'v6\\_%';
      update public.app_setting set value = '{"enabled": true, "since": "2026-08-01"}'::jsonb where key = 'v5_costing';`);
    const rows = J.db("select key || '=' || (value ->> 'enabled') from public.app_setting where key not like 'v6\\_%' order by key").map((r) => r[0]);
    J.log(`    DB flag: ${rows.join(" ")}`);
    J.check("semua flag hidup", rows.every((r) => r.endsWith("=true")), `${rows.length} flag`);
  });
  const admin = await J.actor("admin");
  await J.step("S2", admin, "bangun ulang awal Agustus (Admin → Modul → Bangun ulang; satu-satunya langkah Admin)", async () => {
    await admin.login();
    const s = await admin.goto("/admin/modul");
    J.check("halaman Admin → Modul terbuka", s === 200, `HTTP ${s}`);
    await admin.page.locator('input[name="from"]').fill("2026-08-01");
    await admin.page.locator('input[name="to"]').fill("2026-08-31");
    const m = await admin.act("Bangun ulang", { exact: true, timeout: 280_000 });
    J.log(`    ${admin.role}  ${short(m.ok || m.error || "", 200)}`);
    J.check("bangun ulang selesai tanpa gagal", !!m.ok && /0 gagal/.test(m.ok), short(m.ok || m.error || "", 80));
    const left = J.dbOne("select count(*) from public.rebuild_queue where status in ('queued','running')");
    J.log(`    DB antrean rebuild belum selesai: ${left}`);
    if (Number(left) > 0) {
      const r = await fetch(`${cfg.base}/api/cron/rebuild`, { headers: { authorization: `Bearer ${cfg.cronSecret}` } });
      const body = await r.json();
      J.log(`    cron GET /api/cron/rebuild → HTTP ${r.status} ${JSON.stringify({ done: body.drained?.done ?? body.done, failed: body.drained?.failed ?? body.failed })}`);
    }
    J.log(`    DB baris mart: commercial_daily ${J.dbOne("select count(*) from public.commercial_daily")}, lot_balance_daily ${J.dbOne("select count(*) from public.lot_balance_daily")}, pl_daily_v4 ${J.dbOne("select count(*) from public.pl_daily_v4")}, input_completeness_daily ${J.dbOne("select count(*) from public.input_completeness_daily")}`);
  });
  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
