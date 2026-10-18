#!/usr/bin/env node
"use strict";
// matrix (PRD v5.2-A R72, T11, §5.4 of v5.1 and v5.2-A): the flag combinations × the ten roles. Per combination, role and page:
// allowed (HTTP 200) or 404 (or the redirect the page does), and per cost column visible or not — compared with the WRITTEN
// table tests/e2e/matrix-expect.json (not computed from the code under test). Sales' API (direct to PostgREST with Sales' own
// JWT): no cost columns while sales_sees_cost = false, plan_week_class and week updates refused.
//   node tests/e2e/matrix.cjs            verify against matrix-expect.json
//   E2E_MATRIX_RECORD=1 node …           write the observed table to out/matrix-observed.json (to review, then copy into matrix-expect.json)
const fs = require("node:fs");
const path = require("node:path");
const { Journey, cfg, short } = require("./lib/e2e.cjs");

const EXPECT = JSON.parse(fs.readFileSync(path.join(__dirname, "matrix-expect.json"), "utf8"));
const RECORD = process.env.E2E_MATRIX_RECORD === "1";
const WEEK = "2026-08-24", MONTH = "2026-08";
const pageUrl = (p) => p.replace("{week}", WEEK).replace("{month}", MONTH);

const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
/** The server-rendered tables of a page: [{ head: [..], rows: [[..]] }]. */
function tables(html) {
  const out = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/g) || []) {
    const head = [...(t.match(/<thead[\s\S]*?<\/thead>/) || [""])[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]));
    const body = (t.match(/<tbody[\s\S]*?<\/tbody>/) || [t])[0];
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => strip(c[1]))).filter((r) => r.length);
    out.push({ head, rows });
  }
  return out;
}
/** A cost column is visible when a table has that header and at least one cell of it holds a number (or a status word). */
function costVisible(html, probe) {
  for (const t of tables(html)) {
    const i = t.head.findIndex((h) => new RegExp(probe.header, "i").test(h));
    if (i < 0) continue;
    const re = new RegExp(probe.cell);
    if (t.rows.some((r) => re.test(r[i] || ""))) return true;
  }
  return false;
}
function costTextVisible(html, probe) { return new RegExp(probe.text).test(strip(html)); }

(async () => {
  const J = new Journey("matrix", `matriks flag: ${EXPECT.combos.length} kombinasi × ${EXPECT.roles.length} role × ${EXPECT.pages.length} halaman, kolom biaya, API Sales`);
  const actors = {};
  for (const r of EXPECT.roles) actors[r] = await J.actor(r);
  const observed = { status: {}, cost: {} };
  let cells = 0, bad = 0;

  const flagSql = (c) => {
    const sets = [];
    const val = (on, roles) => JSON.stringify({ enabled: on, ...(roles ? { roles } : {}) });
    for (const k of EXPECT.v4Modules) sets.push(`update public.app_setting set value = '${val(true)}'::jsonb where key = '${k}'`);
    for (const k of EXPECT.v5Modules) {
      const on = c.on.includes(k);
      const since = k === "v5_costing" && on ? `, "since": "2026-08-01"` : "";
      sets.push(`update public.app_setting set value = '${val(on, on ? c.roles : null).replace(/}$/, since + "}")}'::jsonb where key = '${k}'`);
    }
    sets.push(`update public.app_setting set value = '${val(c.v4_release === true)}'::jsonb where key = 'v4_release'`);
    return sets.join(";\n");
  };

  await J.step("0", null, "SETUP: jam uji dan login sepuluh role", async () => {
    J.clock("2026-08-27T10:00:00+07:00");
    for (const a of Object.values(actors)) await a.login();
    J.check("sepuluh role masuk", Object.values(actors).every((a) => a.loggedIn));
  });

  for (const c of EXPECT.combos) {
    await J.step(`C${c.n}`, null, `kombinasi (${c.n}) ${c.name}: ${EXPECT.roles.length} role × ${EXPECT.pages.length} halaman`, async () => {
      J.setup(`flag kombinasi (${c.n}): v5 hidup = [${c.on.join(", ") || "-"}]${c.roles ? ` roles ${JSON.stringify(c.roles)}` : ""}, v4_release ${c.v4_release ? "hidup" : "mati"}`, flagSql(c));
      await new Promise((r) => setTimeout(r, 1200));
      const results = await Promise.all(EXPECT.roles.map(async (role) => {
        const a = actors[role];
        const st = [], cost = {};
        for (const pg of EXPECT.pages) {
          const url = `${cfg.base}${pageUrl(pg.path)}`;
          const res = await a.ctx.request.get(url, { maxRedirects: 0, timeout: 60_000 });
          const status = res.status();
          const loc = res.headers()["location"];
          J._record({ role, method: "GET", path: pageUrl(pg.path), status, kind: "matriks" });
          st.push(status >= 300 && status < 400 ? `${status}→${new URL(loc, cfg.base).pathname}` : String(status));
          if (status === 200) {
            const html = await res.text();
            for (const p of EXPECT.costProbes.filter((q) => q.page === pg.id)) cost[p.id] = p.header ? costVisible(html, p) : costTextVisible(html, p);
          }
        }
        return { role, st, cost };
      }));
      for (const { role, st, cost } of results) {
        (observed.status[c.n] ||= {})[role] = EXPECT.pages.map((pg, i) => `${pg.id}=${st[i]}`).join(" ");
        (observed.cost[c.n] ||= {})[role] = EXPECT.costProbes.map((p) => `${p.id}=${cost[p.id] === undefined ? "-" : cost[p.id] ? 1 : 0}`).join(" ");
        const wantS = EXPECT.expect[c.n]?.[role]?.status, wantC = EXPECT.expect[c.n]?.[role]?.cost;
        J.log(`    ${role.padEnd(20)} ${observed.status[c.n][role]} | biaya: ${observed.cost[c.n][role]}`);
        if (!RECORD) {
          cells += EXPECT.pages.length + EXPECT.costProbes.length;
          const okS = wantS === observed.status[c.n][role], okC = wantC === observed.cost[c.n][role];
          if (!okS || !okC) bad++;
          J.check(`(${c.n}) ${role}: halaman dan kolom biaya sesuai tabel tertulis`, okS && okC, okS && okC ? "" : `diharapkan ${wantS} | ${wantC}; didapat ${observed.status[c.n][role]} | ${observed.cost[c.n][role]}`);
        }
      }
      const five = results.flatMap((r) => r.st).filter((s) => /^5/.test(s));
      J.check(`(${c.n}) tidak ada respons 5xx`, five.length === 0, five.join(","));
    }, { allow: [{ status: 404, why: "halaman yang memang tidak dibuka role itu pada kombinasi ini (matrix-expect.json)" }] });
  }

  // ---------------------------------------------------------------------------------- C53 holds the release (combination 9)
  await J.step("C9b", actors.finance, "kombinasi (9): v4_release hidup + v5_input mati + v5_costing hidup — C53 menahan rilis", async () => {
    const c9 = EXPECT.combos.find((x) => x.n === 9);
    J.setup("flag kombinasi (9); WP batch 125 belum masuk (lewat tenggat H+1 12.00)", `${flagSql(c9)};\nupdate public.batch set wp_received_at = null where batch_ref = '125/PO/KGR/08/2026' and status = 'Aktual'`);
    await new Promise((r) => setTimeout(r, 1200));
    await actors.finance.goto(`/w/${WEEK}/kontrol`);
    const t = await actors.finance.text("main");
    const line = (t.replace(/\s+/g, " ").match(/Rilis ditolak: [^.]*(\.[^.]*)?/) || [""])[0];
    J.log(`    finance  kartu Rilis: ${short(line || t.slice(t.indexOf("Rilis"), t.indexOf("Rilis") + 200), 260)}`);
    J.check("rilis ditolak dan menyebut C53", /C53/.test(line), short(line, 160));
    const btn = actors.finance.page.getByRole("button", { name: /^Rilis outlook/ });
    J.check("tombol Rilis nonaktif", (await btn.count()) > 0 && (await btn.first().isDisabled()));
    await actors.finance.shot("matrix-9-c53-menahan-rilis", { fullPage: false });
    J.setup("WP batch 125 dikembalikan", `update public.batch set wp_received_at = '2026-08-24 01:00:08+00' where batch_ref = '125/PO/KGR/08/2026' and status = 'Aktual'`);
  });

  // ------------------------------------------------------------------------------------------------------- Sales' API
  await J.step("API", actors.sales, "API Sales (langsung ke PostgREST dengan JWT Sales): tanpa kolom biaya, plan_week_class dan update minggu ditolak", async () => {
    J.setup("flag semua hidup; parameter.sales_sees_cost = false", `${flagSql(EXPECT.combos.find((x) => x.n === 7))};\nupdate public.parameter set sales_sees_cost = false`);
    const tok = await (await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: actors.sales.email, password: cfg.password }) })).json();
    const h = { apikey: cfg.anon, authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" };
    const get = async (p) => { const r = await fetch(`${cfg.supa}/rest/v1/${p}`, { headers: h }); let b = null; try { b = await r.json(); } catch { /* empty */ } J.log(`    sales (langsung ke PostgREST)  GET /rest/v1/${short(p, 80)} → HTTP ${r.status}`); return { s: r.status, b }; };
    // the Sales views keep their columns but give no cost while the week says sales_sees_cost = false (B-R83): every cost cell is null
    const COST = ["cost_per_kg_ma", "price_floor", "margin_per_kg_list", "margin_per_kg_realized", "cost_per_kg", "cost_status", "cost_check"];
    const leaked = (rows) => rows.flatMap((r) => COST.filter((c) => c in r && r[c] !== null && r[c] !== false).map((c) => `${c}=${r[c]}`));
    for (const view of ["commercial_daily_sales", "commercial_daily_sales_v5"]) {
      const r = await get(`${view}?select=*&limit=50`);
      const rows = Array.isArray(r.b) ? r.b : [];
      J.log(`    sales  ${view}: ${rows.length} baris, kolom biaya ${COST.filter((c) => rows[0] && c in rows[0]).join(", ")}`);
      J.check(`${view}: Sales melihat baris SKU-nya tetapi semua sel biaya null (sales_sees_cost = false)`, r.s === 200 && rows.length > 0 && leaked(rows).length === 0, `HTTP ${r.s}, ${rows.length} baris, bocor: ${leaked(rows).slice(0, 3).join(", ") || "tidak ada"}`);
    }
    J.setup("kontrol positif: sales_sees_cost = true", "update public.parameter set sales_sees_cost = true");
    const pos = await get("commercial_daily_sales?select=*&limit=50");
    J.check("kontrol positif: dengan sales_sees_cost = true biaya terbaca (pemeriksaan di atas membedakan)", Array.isArray(pos.b) && leaked(pos.b).length > 0, `${Array.isArray(pos.b) ? leaked(pos.b).length : 0} sel biaya terisi`);
    J.setup("sales_sees_cost = false lagi", "update public.parameter set sales_sees_cost = false");
    const cd = await get("commercial_daily?select=key,price_floor,cost_per_kg_ma&limit=1");
    J.check("commercial_daily (tabel dengan biaya): Sales tidak membaca baris", cd.s !== 200 || (Array.isArray(cd.b) && cd.b.length === 0), `HTTP ${cd.s}, ${Array.isArray(cd.b) ? cd.b.length : "-"} baris`);
    const pw = await get("plan_week_class?select=*&limit=1");
    J.check("plan_week_class ditolak untuk Sales (B-R83)", pw.s >= 400 || (Array.isArray(pw.b) && pw.b.length === 0), `HTTP ${pw.s}, ${Array.isArray(pw.b) ? pw.b.length : "-"} baris`);
    const up = await fetch(`${cfg.supa}/rest/v1/week?week_start=eq.${WEEK}`, { method: "PATCH", headers: { ...h, prefer: "return=representation" }, body: JSON.stringify({ update_date: "2026-08-30" }) });
    const ub = await up.json().catch(() => null);
    J.log(`    sales (langsung ke PostgREST)  PATCH /rest/v1/week?week_start=eq.${WEEK} → HTTP ${up.status} ${short(JSON.stringify(ub), 120)}`);
    J.check("update minggu oleh Sales ditolak (B-R83, K69)", up.status >= 400 || (Array.isArray(ub) && ub.length === 0), `HTTP ${up.status}`);
    const lk = await fetch(`${cfg.supa}/rest/v1/rpc/lock_commitments`, { method: "POST", headers: h, body: JSON.stringify({ p_week_start: "2026-08-31" }) });
    const lb = await lk.json().catch(() => null);
    J.log(`    sales (langsung ke PostgREST)  POST /rest/v1/rpc/lock_commitments → HTTP ${lk.status} ${short(JSON.stringify(lb), 120)}`);
    J.check("kunci komitmen oleh Sales ditolak", lk.status === 403 || lk.status === 400, `HTTP ${lk.status}`);
  }, { allow: [
    { area: "rest", status: 403, why: "penolakan yang diharapkan (probe API Sales)" }, { area: "rest", status: 401, why: "penolakan yang diharapkan (probe API Sales)" },
    { area: "rest", status: 400, why: "penolakan yang diharapkan (probe API Sales)" }] });

  J.setup("flag dikembalikan: semua hidup, v4_release hidup; sales_sees_cost kembali ke nilai awal", `${flagSql({ n: 0, on: EXPECT.v5Modules, roles: null, v4_release: true })};\nupdate public.parameter set sales_sees_cost = true`);
  if (RECORD) { fs.writeFileSync(path.join(cfg.out, "matrix-observed.json"), JSON.stringify(observed, null, 1)); J.log(`MODE REKAM: tabel teramati ditulis ke out/matrix-observed.json`); }
  J.log("");
  J.log(`matriks: ${EXPECT.combos.length} kombinasi × ${EXPECT.roles.length} role × ${EXPECT.pages.length} halaman = ${EXPECT.combos.length * EXPECT.roles.length * EXPECT.pages.length} halaman dibuka; ${cells} sel dicek, ${bad} baris tidak sesuai`);
  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
