#!/usr/bin/env node
"use strict";
// journey P (PRD v5.2-A R70; v5.1 spec docs/v5.1/journey-P.md, step P8): the release gate of the database. Finance calls
// POST /rpc/release_week straight at PostgREST with the Finance JWT and the snapshot of the release T7 made, three times, each time after a SETUP
// of the completeness grid (input_completeness_daily, K35), so the rule is shown to live in the database transaction and not in the app's pre-check:
//   P8a  no grid row for the week                          -> 400 P0001 "K35: grid kelengkapan belum dibangun"           (K45)
//   P8b  the grid back, one red cell plan_week 24/08       -> 400 P0001 "K35 kelengkapan data merah: plan_week 24/08"   (K35)
//   P8c  every cell green and an old release_week cell late -> 200, a release row by Finance                             (K44: the release task is not a cell)
// and a non-Finance role (PPIC) gets 403 42501 on the same call. Runs on the database T7 leaves (Friday 28 Aug 2026 ~16.50, week released, v4_release on,
// v5_costing and v5_input on): the snapshot is the one of T7 step 9.
// P1-P7 of the v5.1 spec (empty grid, refresh, red cell, PPIC saves the plan, release through the screen) are T7 steps 8 and 9 and the matrix (docs/v5.2/a5.md).
// v5.2 differs from the v5.1 spec in what the RPC asks of the snapshot (B-R84/K68): with v5_costing on it must carry controls_v3 with C53 (the T7 snapshot
// does), and every date up to yesterday needs a cell (O28b): the 400 of P8a would also be "grid belum dibangun untuk <tanggal>" for a partial grid.
const crypto = require("node:crypto");
const { Journey, cfg, short } = require("./lib/e2e.cjs");

const WEEK = "2026-08-24";
const RPC = "rpc/release_week";
const REJECT = [{ area: "rest", status: 400, path: /rpc\/release_week/, why: "penolakan yang diharapkan: release_week menolak di transaksi database (K35/K45)" },
  { area: "rest", status: 403, path: /rpc\/release_week/, why: "penolakan yang diharapkan: release_week hanya untuk Admin atau Finance" }];

(async () => {
  const J = new Journey("P", "rilis minggu: release_week langsung ke PostgREST dengan JWT Finance, tiga keadaan grid K35 (v5.1 P8)");
  const finance = await J.actor("finance");
  const ppic = await J.actor("ppic");
  let tokenOf = async (a) => {
    const r = await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: a.email, password: cfg.password }) });
    const b = await r.json();
    if (!b.access_token) throw new Error(`login ${a.email} gagal: HTTP ${r.status}`);
    return b.access_token;
  };
  let tokF = null, tokP = null, body = null, grid = null;
  const releases = () => Number(J.dbOne(`select count(*) from public.release r join public.week w on w.id = r.week_id where w.week_start = '${WEEK}'`));
  const cells = () => J.db(`select status, count(*) from public.input_completeness_daily where date between '${WEEK}' and ('${WEEK}'::date + 6) group by 1 order by 1`).map((r) => `${r[0]} ${r[1]}`).join(", ") || "tidak ada";
  /** One call of release_week as `tok`; returns { s, b }. */
  const call = async (who, tok) => {
    const r = await fetch(`${cfg.supa}/rest/v1/${RPC}`, { method: "POST", headers: { apikey: cfg.anon, authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    let b = null; try { b = await r.json(); } catch { /* empty */ }
    J.log(`    ${who} (langsung ke PostgREST)  POST /rest/v1/${RPC} → HTTP ${r.status} ${short(JSON.stringify(b), 260)}`);
    return { s: r.status, b };
  };

  await J.step("0", null, "SETUP: jam uji Jum 28 Agu 16.55; login Finance dan PPIC; snapshot rilis T7 sebagai badan permintaan", async () => {
    J.clock("2026-08-28T16:55:00+07:00");
    await finance.login(); await ppic.login();
    tokF = await tokenOf(finance); tokP = await tokenOf(ppic);
    const wk = J.db(`select id, status from public.week where week_start = '${WEEK}'`)[0];
    const snap = J.dbOne(`select snapshot::text from public.release r where r.week_id = '${wk[0]}' order by released_at desc limit 1`);
    J.check("DB: minggu 24/08 sudah dirilis oleh T7 dan snapshot rilis ada", wk[1] === "released" && !!snap, `status ${wk[1]}, snapshot ${snap ? snap.length : 0} karakter`);
    const parsed = JSON.parse(snap);
    J.log(`    DB snapshot rilis T7: ${snap.length} karakter, controls.controls ${parsed.controls?.controls?.length} kontrol, controls_v3 ${Array.isArray(parsed.controls_v3) ? parsed.controls_v3.map((c) => `${c.code} ${c.status}`).join(", ") : "tidak ada"}`);
    J.check("snapshot memuat kontrol v1 dan controls_v3 dengan C53 (syarat release_week saat v5_costing hidup, K68)", Array.isArray(parsed.controls?.controls) && Array.isArray(parsed.controls_v3) && parsed.controls_v3.some((c) => c.code === "C53"));
    const text = JSON.stringify(parsed);
    body = { p_week_id: wk[0], p_json: text, p_sha: crypto.createHash("sha256").update(text, "utf8").digest("hex"), p_pdf_path: null, p_ops: [] };
    J.log(`    badan permintaan: p_week_id ${wk[0]}, p_sha ${body.p_sha.slice(0, 16)}… (SHA-256 dari p_json yang dikirim), ${releases()} rilis minggu ini, grid: ${cells()}`);
    grid = J.dbOne(`select coalesce(jsonb_agg(to_jsonb(c) order by c.date, c.kind), '[]'::jsonb)::text from public.input_completeness_daily c where c.date between '${WEEK}' and ('${WEEK}'::date + 6)`);
    J.check("DB: grid K35 minggu ini terisi dan tanpa sel merah (keadaan akhir T7)", JSON.parse(grid).length > 0 && JSON.parse(grid).every((c) => c.status !== "late"), cells());
    J.check("v4_release, v5_costing dan v5_input hidup", ["v4_release", "v5_costing", "v5_input"].every((k) => J.dbOne(`select value ->> 'enabled' from public.app_setting where key = '${k}'`) === "true"));
  });

  const restore = `delete from public.input_completeness_daily where date between '${WEEK}' and ('${WEEK}'::date + 6);
    insert into public.input_completeness_daily select * from jsonb_populate_recordset(null::public.input_completeness_daily, :'grid'::jsonb)`;

  await J.step("P8a", finance, "release_week tanpa satu pun baris grid minggu itu → 400 'K35: grid kelengkapan belum dibangun' (K45); tidak ada rilis baru", async () => {
    J.setup(`grid K35 minggu ${WEEK} dihapus seluruhnya (tidak ada baris untuk minggu itu)`, `delete from public.input_completeness_daily where date between '${WEEK}' and ('${WEEK}'::date + 6)`);
    const n0 = releases();
    const r = await call("finance", tokF);
    J.check("HTTP 400 dengan kode P0001", r.s === 400 && r.b?.code === "P0001", `HTTP ${r.s} ${r.b?.code}`);
    J.check("pesan: 'Rilis ditolak: K35: grid kelengkapan belum dibangun'", /Rilis ditolak: .*K35: grid kelengkapan belum dibangun/.test(r.b?.message || ""), short(r.b?.message || "", 200));
    J.check("DB: tidak ada rilis baru", releases() === n0, `${n0} → ${releases()}`);
  }, { allow: REJECT });

  await J.step("P8b", finance, "grid dikembalikan dengan satu sel plan_week 24/08 merah → 400 'K35 kelengkapan data merah: plan_week 24/08'; tidak ada rilis baru", async () => {
    J.setup(`grid K35 dikembalikan persis seperti keadaan akhir T7, lalu satu sel plan_week ${WEEK} dibuat late`, `${restore};
      update public.input_completeness_daily set status = 'late' where date = '${WEEK}' and kind = 'plan_week'`, { grid });
    J.log(`    DB grid: ${cells()}; sel merah: ${J.db(`select kind || ' ' || to_char(date, 'DD/MM') from public.input_completeness_daily where date between '${WEEK}' and ('${WEEK}'::date + 6) and status = 'late'`).map((x) => x[0]).join(", ")}`);
    const n0 = releases();
    const r = await call("finance", tokF);
    J.check("HTTP 400 dengan kode P0001", r.s === 400 && r.b?.code === "P0001", `HTTP ${r.s} ${r.b?.code}`);
    J.check("pesan: 'Rilis ditolak: K35 kelengkapan data merah: plan_week 24/08' (satu sel, disebut namanya)", /Rilis ditolak: .*K35 kelengkapan data merah: plan_week 24\/08(?!,)/.test(r.b?.message || ""), short(r.b?.message || "", 200));
    J.check("DB: tidak ada rilis baru", releases() === n0, `${n0} → ${releases()}`);
  }, { allow: REJECT });

  await J.step("P8c", finance, "semua sel lolos dan sel release_week lama late → 200: rilis baru oleh Finance (K44: tugas rilis bukan sel yang menahan)", async () => {
    J.setup(`grid K35 dikembalikan persis seperti keadaan akhir T7 (semua sel lolos), ditambah sel release_week ${WEEK} yang late`, `${restore};
      insert into public.input_completeness_daily (date, kind, owner_role, status, note, due_at)
      values ('${WEEK}', 'release_week', 'finance', 'late', 'e2e: sel tugas rilis lama, terlambat (setup)', timestamptz '2026-08-23 10:00:00+00')
      on conflict (date, kind) do update set status = 'late'`, { grid });
    J.log(`    DB grid: ${cells()}; sel release_week: ${J.db(`select status from public.input_completeness_daily where date between '${WEEK}' and ('${WEEK}'::date + 6) and kind = 'release_week'`).map((x) => x[0]).join(", ")}`);
    const n0 = releases();
    const r = await call("finance", tokF);
    J.check("HTTP 200 (id rilis baru)", r.s === 200 && typeof r.b === "string", `HTTP ${r.s} ${short(JSON.stringify(r.b), 80)}`);
    J.log(`    DB rilis minggu ini: ${J.db(`select r.released_by, left(r.snapshot_sha256, 12), r.control_status, coalesce(r.note, '-') from public.release r join public.week w on w.id = r.week_id where w.week_start = '${WEEK}' order by r.released_at`).map((x) => x.join(" · ")).join("; ")}`);
    J.check("DB: satu rilis baru oleh Finance dengan SHA-256 yang dikirim", releases() === n0 + 1 && J.dbOne(`select count(*) from public.release r where r.id = '${typeof r.b === "string" ? r.b : "00000000-0000-0000-0000-000000000000"}' and r.released_by = 'finance@${cfg.domain}' and r.snapshot_sha256 = '${body.p_sha}'`) === "1", `${n0} → ${releases()}`);
    J.check("DB: minggu tetap 'released'", J.dbOne(`select status from public.week where week_start = '${WEEK}'`) === "released");
  }, { allow: REJECT });

  await J.step("P8d", ppic, "PPIC memanggil release_week yang sama → 403 (hanya Admin atau Finance), tidak ada rilis baru", async () => {
    const n0 = releases();
    const r = await call("ppic", tokP);
    J.check("HTTP 403 dengan kode 42501", r.s === 403 && r.b?.code === "42501", `HTTP ${r.s} ${r.b?.code}`);
    J.check("pesan: 'Rilis mingguan hanya oleh Admin atau Finance'", /Rilis mingguan hanya oleh Admin atau Finance/.test(r.b?.message || ""), short(r.b?.message || "", 160));
    J.check("DB: tidak ada rilis baru", releases() === n0, `${n0} → ${releases()}`);
  }, { allow: REJECT });

  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
