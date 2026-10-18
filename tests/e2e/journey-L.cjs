#!/usr/bin/env node
"use strict";
// journey L (PRD v5.2-A R70; v5.1 spec docs/v5.1/journey-L.md, steps L4-L7): Commercial <-> PPIC with the real roles, on the database T7
// leaves (Friday 28 Aug 2026 ~16.50: commitment of 31 Aug locked v1 with its price list, class plan of 24 Aug saved and copied, week released).
// L1-L3 (Sales drafts, the lead locks, Sales cannot lock) are T7 steps 1 and 2 and the Sales API probe of the matrix; this journey is what they left:
//   L4  the lead changes a locked commitment: a new version needs a reason; with it v2 is a draft and the lock makes v2 the locked one, v1 superseded;
//       the price list that was locked is not overwritten (Q-v5.1-8)
//   L5  Sales sees the locked v2 and every input of the row is off (R15: one rule)
//   L6  the lead answers the surplus of PPIC's plan; PPIC sees "dijawab" and the commitment and price list as locked
//   L7  Finance: Outlook bulan and Kas say "belum diisi" for the cash of August (31 days with accounts = 0 and total = 0 in the mart, R21) and
//       "tidak berlaku (laba)" for the months to negative equity (R20)
// Where v5.2 behaves differently from the v5.1 spec the check asserts v5.2 and the reason is next to it (docs/v5.2/a5b.md):
//   - L1/L5 "tile Dari PPIC: Tidak ditampilkan untuk Sales": since A1c/B6/B7 (Q-v5.2-15) Sales do not read plan tables, they read the view
//     surplus_for_sales_v52: the tile says "Dari PPIC: surplus untuk SKU Anda" and "Detail rencana ... tidak ditampilkan untuk Sales".
//   - L6 "surplus karkas ± 2.104 kg, jawaban sebagian 3.000 kg": with R52 the saved class plan is the batch plan, so the surplus list of the plan holds
//     by-products (Lemak 350 kg), karkas ~0 kg; the answer is about the Lemak row of that list (R56: the key comes from the plan's row).
const { Journey, cfg, short, sleep } = require("./lib/e2e.cjs");

const WEEK = "2026-08-24";
const NEXT = "2026-08-31";
const KEY = "RPA|Karkas";
const idNum = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

(async () => {
  const J = new Journey("L", "Commercial ↔ PPIC: versi 2 komitmen dengan alasan, input Sales nonaktif, jawaban surplus, Outlook bulan dan Kas (v5.1 L4–L7)");
  const A = {};
  for (const r of ["commercial_lead", "sales", "ppic", "finance"]) A[r] = await J.actor(r);
  const commit = () => J.db(`select version, status, fresh_kg::text, frozen_kg::text, price::text, coalesce(reason, ''), coalesce(locked_by, ''), coalesce(created_by, '') from public.sales_commitment where week_start = '${NEXT}' and key = '${KEY}' and deleted_at is null order by version`);
  const plist = () => J.db(`select key, price_fresh::text, price_frozen::text, locked_by, locked_at::text, price_frozen_source from public.price_list_week where week_start = '${NEXT}' and deleted_at is null order by key`);
  const fmtC = (rows) => rows.map((r) => `v${r[0]} ${r[1]} ${Number(r[2])}/${Number(r[3])} @${Number(r[4])}${r[5] ? ` alasan "${r[5]}"` : ""}${r[6] ? ` kunci ${r[6]}` : ""}`).join("; ");

  await J.step("0", null, "SETUP: jam uji Jum 28 Agu 17.10; login empat role", async () => {
    J.clock("2026-08-28T17:10:00+07:00");
    for (const a of Object.values(A)) await a.login();
    J.check("empat role masuk", Object.values(A).every((a) => a.loggedIn), Object.keys(A).join(", "));
    J.log(`    DB komitmen ${NEXT}: ${fmtC(commit())}`);
    J.log(`    DB price list ${NEXT}: ${plist().map((r) => r.join(" ")).join("; ")}`);
    J.check("awal: komitmen v1 terkunci (T7 langkah 2) dan price list terkunci", commit().length === 1 && commit()[0][1] === "locked" && plist().length === 1 && !!plist()[0][4]);
  });

  // ------------------------------------------------------------------------------------------------------- L4
  let before = null;
  await J.step("L4", A.commercial_lead, "Kepala Sales: komitmen terkunci diubah — versi baru wajib alasan; dengan alasan v2 draft, kunci → v1 superseded, v2 terkunci", async () => {
    before = { commit: commit(), plist: plist() };
    const st = await A.commercial_lead.goto("/komersial");
    J.check("Komersial terbuka untuk Kepala Sales", st === 200, `HTTP ${st}`);
    const fresh = A.commercial_lead.page.locator('input[name="fresh_0"]');
    J.check("form komitmen: baris Karkas terkunci v1 15.000 / 2.000, bisa diubah oleh Kepala Sales", (await fresh.inputValue()) === "15.000" && !(await fresh.isDisabled()), await fresh.inputValue());
    // (a) no reason: the database refuses a new version of a locked commitment (tg_commitment_guard); nothing is written
    await fresh.fill("16000");
    const bad = await A.commercial_lead.act("Simpan draft");
    J.log(`    commercial_lead  tanpa alasan: ${short(bad.error || bad.ok || "", 220)}`);
    J.check("tanpa alasan: ditolak 'Komitmen sudah dikunci: versi baru wajib alasan', tidak ada yang disimpan", !!bad.error && /sudah dikunci: versi baru wajib alasan/.test(bad.error) && /Tidak ada komitmen yang disimpan/.test(bad.error), bad.error || bad.ok || "");
    J.log(`    DB komitmen sesudah penolakan: ${fmtC(commit())}`);
    J.check("DB: komitmen tidak berubah (hanya v1 terkunci)", JSON.stringify(commit()) === JSON.stringify(before.commit), fmtC(commit()));
    // Q-v5.2-114 (A8): a refusal keeps what was typed (React empties a plain <form action> after every action, a refusal included): the number stays,
    // so the lead only adds the reason
    J.check("sesudah penolakan: angka yang diketik (16000) tetap di formulir, tidak perlu diketik ulang", (await fresh.inputValue()) === "16000", await fresh.inputValue());
    // (b) with a reason: v2 as a draft (the number is not typed again; only the reason)
    const reasonBox = A.commercial_lead.page.locator('input[name="reason"]');
    await reasonBox.fill("PO tambahan PT A");
    const ok = await A.commercial_lead.act("Simpan draft");
    J.log(`    commercial_lead  dengan alasan: ${short(ok.ok || ok.error || "", 220)}`);
    J.check("dengan alasan: v2 tersimpan sebagai draft", !!ok.ok && /1 SKU komitmen disimpan sebagai draft/.test(ok.ok) && /1 versi baru/.test(ok.ok), ok.ok || ok.error || "");
    // after a save the form is back to the stored values: the reason is empty again, the row shows the saved draft (16.000)
    J.check("sesudah tersimpan: kolom alasan kosong lagi dan angka baris = yang tersimpan (16.000)", (await reasonBox.inputValue()) === "" && (await fresh.inputValue()) === "16.000", `alasan "${await reasonBox.inputValue()}", fresh ${await fresh.inputValue()}`);
    const c1 = commit();
    J.log(`    DB komitmen: ${fmtC(c1)}`);
    J.check("DB: v1 tetap terkunci dan v2 draft 16.000 / 2.000 dengan alasan 'PO tambahan PT A'", c1.length === 2 && c1[0][1] === "locked" && c1[1][0] === "2" && c1[1][1] === "draft" && Number(c1[1][2]) === 16000 && Number(c1[1][3]) === 2000 && c1[1][5] === "PO tambahan PT A", fmtC(c1));
    // (c) the lock: v2 locked, v1 superseded; the locked price list stays as it was
    const lk = await A.commercial_lead.act("Kunci komitmen dan price list");
    J.log(`    commercial_lead  ${short(lk.ok || lk.error || "", 220)}`);
    J.check("kunci: 1 draft komitmen dikunci bersama price list", !!lk.ok && /1 draft komitmen dikunci bersama price list/.test(lk.ok), lk.ok || lk.error || "");
    const c2 = commit();
    J.log(`    DB komitmen: ${fmtC(c2)}`);
    J.check("DB: v1 superseded, v2 terkunci oleh Kepala Sales (16.000 fresh)", c2.length === 2 && c2[0][1] === "superseded" && c2[1][1] === "locked" && c2[1][6] === `lead@${cfg.domain}` && Number(c2[1][2]) === 16000, fmtC(c2));
    J.log(`    DB price list sesudah: ${plist().map((r) => r.join(" ")).join("; ")}`);
    J.check("DB: price list yang sudah terkunci tidak ditimpa (harga, harga frozen dari form, waktu kunci sama; Q-v5.1-8)", JSON.stringify(plist()) === JSON.stringify(before.plist), `${plist()[0]?.join(" ")} vs ${before.plist[0]?.join(" ")}`);
    await A.commercial_lead.shot("L-L4-lead-versi-2");
  }, { allow: [{ area: "rest", status: 400, path: /POST \/?sales_commitment/, why: "penolakan yang diharapkan: versi baru komitmen terkunci tanpa alasan (tg_commitment_guard)" }] });

  // ------------------------------------------------------------------------------------------------------- L5
  await J.step("L5", A.sales, "Sales: komitmen terkunci v2 — fresh, frozen, harga dan harga frozen semua nonaktif (R15); Sales tidak membaca tabel rencana (Q-v5.2-15)", async () => {
    const st = await A.sales.goto("/komersial");
    J.check("Komersial terbuka untuk Sales", st === 200, `HTTP ${st}`);
    const inputs = await A.sales.page.evaluate(() => ["fresh_0", "frozen_0", "price_0", "price_frozen|RPA|Karkas"].map((n) => { const e = document.querySelector(`input[name="${n}"]`); return e ? [n, e.value, e.disabled] : [n, null, null]; }));
    J.log(`    sales  input baris Karkas: ${inputs.map((i) => `${i[0]}=${i[1]}${i[2] ? " (nonaktif)" : ""}`).join(", ")}`);
    J.check("keempat input baris Karkas nonaktif dan berisi v2 (16.000 / 2.000 / 36.705 / 28.000)", inputs.every((i) => i[2] === true) && inputs[0][1] === "16.000" && inputs[1][1] === "2.000" && inputs[2][1] === "36.705" && inputs[3][1] === "28.000", JSON.stringify(inputs));
    const t = await A.sales.text("main");
    J.check("Sales: 'terkunci v2' dan 'Dikunci Kepala Sales.', tanpa tombol kunci", /terkunci v2/.test(t) && /Dikunci Kepala Sales\./.test(t) && (await A.sales.page.getByRole("button", { name: "Kunci komitmen dan price list" }).count()) === 0);
    // v5.2 (A1c, B6/B7, Q-v5.2-15): the tile from PPIC is the view of the Sales' own SKUs, not "Tidak ditampilkan untuk Sales (data perencanaan)" (v5.1)
    const tile = ((await A.sales.page.locator('section[data-tile="t-ppic"]').first().innerText()) || "").replace(/\s+/g, " ");
    J.log(`    sales  tile Dari PPIC: ${short(tile, 260)}`);
    J.check("tile Dari PPIC untuk Sales = surplus SKU sendiri dari view; detail rencana tidak ditampilkan (v5.2, Q-v5.2-15)", /Dari PPIC: surplus untuk SKU Anda/.test(tile) && /Detail rencana \(kelas, ekor, biaya, downgrade\) tidak ditampilkan untuk Sales/.test(tile), short(tile, 200));
    // the database says the same: no plan table for Sales, the view only
    const tok = await (await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: A.sales.email, password: cfg.password }) })).json();
    const h = { apikey: cfg.anon, authorization: `Bearer ${tok.access_token}` };
    const get = async (p) => { const r = await fetch(`${cfg.supa}/rest/v1/${p}`, { headers: h }); let b = null; try { b = await r.json(); } catch { /* empty */ } J.log(`    sales (langsung ke PostgREST)  GET /rest/v1/${short(p, 70)} → HTTP ${r.status} ${Array.isArray(b) ? `${b.length} baris` : short(JSON.stringify(b), 80)}`); return { s: r.status, b }; };
    const pw = await get("plan_week?select=id&limit=5");
    J.check("plan_week: Sales tidak membaca baris rencana (B6/B7)", pw.s >= 400 || (Array.isArray(pw.b) && pw.b.length === 0), `HTTP ${pw.s}, ${Array.isArray(pw.b) ? pw.b.length : "-"} baris`);
    const sv = await get("surplus_for_sales_v52?select=*&limit=20");
    J.check("surplus_for_sales_v52: Sales membaca view itu (SKU yang ditugaskan saja)", sv.s === 200 && Array.isArray(sv.b), `HTTP ${sv.s}, ${Array.isArray(sv.b) ? sv.b.length : "-"} baris`);
    await A.sales.shot("L-L5-sales-terkunci");
  }, { allow: [{ area: "rest", status: 401, path: /plan_week/, why: "Sales tidak boleh membaca plan_week (B6/B7)" }, { area: "rest", status: 403, path: /plan_week/, why: "Sales tidak boleh membaca plan_week (B6/B7)" }] });

  // ------------------------------------------------------------------------------------------------------- L6
  await J.step("L6", A.commercial_lead, "Kepala Sales menjawab surplus rencana PPIC (sebagian), PPIC melihat 'dijawab'; komitmen dan price list minggu depan terkunci", async () => {
    J.clock("2026-08-28T17:20:00+07:00");
    const plan = J.db(`select version, surplus_kg_by_key::text from public.plan_week where week_start = '${WEEK}' and deleted_at is null order by version desc limit 1`)[0];
    J.log(`    DB rencana PPIC ${WEEK}: v${plan?.[0]} surplus ${plan?.[1]}`);
    const surplus = JSON.parse(plan[1]);
    const row = Object.entries(surplus).filter(([, kg]) => Number(kg) > 1).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    J.check("DB: rencana tersimpan punya surplus nyata (> 1 kg) untuk dijawab", !!row, plan?.[1]);
    const [skey, skg] = row;
    const st = await A.commercial_lead.goto("/komersial");
    J.check("Komersial terbuka untuk Kepala Sales", st === 200, `HTTP ${st}`);
    const t = ((await A.commercial_lead.page.locator('section[data-tile="t-ppic"]').first().innerText()) || "").replace(/\s+/g, " ");
    J.log(`    commercial_lead  tile Dari PPIC: ${short(t, 400)}`);
    J.check("tile Dari PPIC menyebut surplus karkas dari batch rencana dan belum dijawab", /Karkas surplus dari batch rencana/.test(t) && /Belum dijawab/.test(t), short(t, 200));
    // Q-v5.2-112 (A8): two numbers for the surplus — the row of the tile is recomputed now, the answer list is the saved plan: the labels say which is which
    J.check("tile Dari PPIC: angka surplus karkas bertanda 'rencana saat ini' dan catatannya menyebut daftar jawaban = surplus rencana tersimpan", /Karkas surplus dari batch rencana saat ini/.test(t) && /daftar jawaban memuat surplus rencana tersimpan/.test(t), short(t, 300));
    const sel = A.commercial_lead.page.locator('select[aria-label="SKU surplus"]');
    const opt = await sel.evaluate((e, k) => { const o = [...e.options].find((x) => x.text.startsWith(k)); return o ? [o.value, o.text] : null; }, skey);
    J.log(`    commercial_lead  baris surplus yang dijawab: ${opt?.[1]} (DB ${skey} ${skg} kg)`);
    J.check("daftar jawaban memuat baris surplus rencana (R56: kunci dari baris rencana)", !!opt, opt ? opt[1] : `tidak ada ${skey}`);
    J.check("baris itu bertanda '(surplus rencana tersimpan)' (Q-v5.2-112)", !!opt && /\(surplus rencana tersimpan\)$/.test(opt[1]), opt ? opt[1] : "");
    await sel.selectOption(opt[0]);
    await A.commercial_lead.page.locator('select[aria-label="jawaban surplus"]').selectOption("partial");
    await A.commercial_lead.page.locator('input[aria-label="kg diserap"]').fill("300");
    await A.commercial_lead.page.locator('input[aria-label="harga"]').fill("25000");
    const m = await A.commercial_lead.act("Kirim jawaban ke PPIC");
    J.log(`    commercial_lead  ${short(m.ok || m.error || "", 220)}`);
    J.check("jawaban terkirim ke PPIC", !!m.ok && /Jawaban terkirim ke PPIC/.test(m.ok), m.ok || m.error || "");
    const r = J.db(`select r.key, r.surplus_kg::text, r.response, r.absorb_kg::text, r.price::text, r.responded_by from public.surplus_response r join public.plan_week p on p.id = r.plan_week_id where p.week_start = '${WEEK}' and r.deleted_at is null`);
    J.log(`    DB surplus_response: ${r.map((x) => x.join(" · ")).join("; ")}`);
    J.check("DB: satu jawaban 'partial' 300 kg @ 25.000 oleh Kepala Sales, untuk baris surplus itu dengan kg surplus rencana", r.length === 1 && r[0][0].endsWith(skey) && r[0][2] === "partial" && Number(r[0][3]) === 300 && Number(r[0][4]) === 25000 && r[0][5] === `lead@${cfg.domain}` && Math.abs(Number(r[0][1]) - Number(skg)) < 0.01, r.map((x) => x.join(" ")).join("; "));
    const q = J.db(`select date::text, reason, status from public.rebuild_queue where date = '${WEEK}' and (reason ilike '%surplus%' or reason ilike '%jawaban%') order by created_at desc limit 3`);
    J.log(`    DB antrean tanggal rencana ${WEEK} (jawaban surplus): ${q.map((x) => x.join(" · ")).join("; ") || "tidak ada"}`);
    J.check("DB: jawaban surplus masuk antrean rebuild untuk tanggal rencana (24/08)", q.length > 0, q.map((x) => x.join(" ")).join("; "));
    await A.commercial_lead.shot("L-L6-lead-jawaban-surplus");
    // PPIC sees it
    const s2 = await A.ppic.goto(`/w/${WEEK}/rencana`);
    J.check("Rencana terbuka untuk PPIC", s2 === 200, `HTTP ${s2}`);
    const tx = await A.ppic.text("main");
    const dari = tx.slice(tx.indexOf("Dari Commercial"), tx.indexOf("Dari Commercial") + 420).replace(/\s+/g, " ");
    J.log(`    ppic  Dari Commercial: ${short(dari, 300)}`);
    J.check("Rencana PPIC: 'Jawaban surplus' dijawab", /Jawaban surplus[^.]*dijawab/i.test(dari), short(dari, 200));
    J.check("Rencana PPIC: komitmen dan price list minggu depan dikunci", /Komitmen minggu depan\s+dikunci/.test(dari) && /Price list minggu depan\s+dikunci/.test(dari), short(dari, 260));
    await A.ppic.shot("L-L6-ppic-dijawab");
  });

  // ------------------------------------------------------------------------------------------------------- L7
  await J.step("L7", A.finance, "Finance: kas Agustus belum diisi (baris mart 0, R21) dan bulan sampai ekuitas negatif 'tidak berlaku (laba)' (R20), di Outlook bulan dan Kas", async () => {
    J.clock("2026-08-28T17:30:00+07:00");
    const cash = J.db(`select count(*), count(*) filter (where accounts = 0), count(*) filter (where total_closing = 0), sum(accounts), sum(total_closing) from public.cash_position_daily where date between '2026-08-01' and '2026-08-31'`)[0];
    J.log(`    DB cash_position_daily Agustus: ${cash[0]} hari, accounts = 0 di ${cash[1]}, total_closing = 0 di ${cash[2]}, Σ accounts ${cash[3]}, Σ total ${cash[4]}; cash_daily (upload kas): ${J.dbOne("select count(*) from public.cash_daily")} baris`);
    J.check("DB: 31 hari Agustus ada di mart kas, semuanya accounts = 0 dan total_closing = 0 (tidak ada upload kas)", cash[0] === "31" && cash[1] === "31" && cash[2] === "31" && J.dbOne("select count(*) from public.cash_daily") === "0", cash.join(" "));
    const s1 = await A.finance.goto("/m/2026-08");
    J.check("Outlook bulan Agustus terbuka untuk Finance", s1 === 200, `HTTP ${s1}`);
    const m = await A.finance.text("main");
    const sol = m.slice(m.indexOf("Solvabilitas"), m.indexOf("Solvabilitas") + 330).replace(/\s+/g, " ");
    J.log(`    finance  /m/2026-08 solvabilitas: ${short(sol, 330)}`);
    J.check("Outlook bulan: 'Kas belum diisi' (bukan Rp 0)", /Kas\s+belum diisi/.test(sol), short(sol, 200));
    J.check("Outlook bulan: 'Bulan sampai ekuitas negatif tidak berlaku (laba)'", /Bulan sampai ekuitas negatif\s+tidak berlaku \(laba\)/.test(sol), short(sol, 240));
    await A.finance.shot("L-L7-finance-outlook-bulan", { fullPage: false });
    const s2 = await A.finance.goto("/kas");
    J.check("Kas terbuka untuk Finance", s2 === 200, `HTTP ${s2}`);
    const k = (await A.finance.text("main")).replace(/\s+/g, " ");
    J.log(`    finance  /kas: ${short(k.slice(0, 420), 420)}`);
    J.check("Kas: 'Saldo kas per 27 Agu 2026 belum diisi' dan 'Saldo kas 27 Agu belum diisi' (bukan Rp 0)", /Saldo kas per 27 Agu 2026 belum diisi/.test(k) && /Saldo kas 27 Agu\s+cara hitung\s+belum diisi/.test(k), short(k, 200));
    J.check("Kas: 'Bulan sampai ekuitas negatif tidak berlaku (laba)'", /Bulan sampai ekuitas negatif\s+cara hitung\s+tidak berlaku \(laba\)/.test(k), "");
    await A.finance.shot("L-L7-finance-kas", { fullPage: false });
  });

  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
