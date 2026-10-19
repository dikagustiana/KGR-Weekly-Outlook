#!/usr/bin/env node
"use strict";
// journey R69 (PRD v5.2-A R69, T15, K62, O25-O27; PRD v5.2-B B-R86): the reconciliation of the app's month with the FS (C59), on the database T7 leaves
// (Friday 28 Aug 2026 ~16.50; the clock goes on to Tuesday 1 Sep 09.00 so that August is over and FINAL can be locked). Environment: PG16 lokal +
// PostgREST 12 + mock auth.
//   R1  no FS imported: the page says so, C59 is not judged and does not hold FINAL; the 15 app lines of the page equal what plain SQL derives from
//       the tables (tests/e2e/sql/fs-app-lines.sql: trial balance + journal per coa_map line) - the FS fixture below is built from that SQL, not typed
//   R2  SETUP: the FS of August in fs_statement_line (the 15 rows of the minimum map, version 1, locked) while fs_line_map is still draft: "pemetaan
//       belum disetujui", C59 not judged
//   R3  SETUP: fs_line_map agreed: Finance opens /m/2026-08/rekonsiliasi: 15 sama, 0 beda, C59 LULUS; Tutup buku lists C59 LULUS
//   R4  Finance records an override (UI) for the six FINAL controls that data of this stack does not satisfy and that have nothing to do with the FS
//       (C22, C23, C24, C35, C36, C49), so FINAL depends on C59 alone: with C59 LULUS "Kunci FINAL" is enabled
//   R5  SETUP: a correction of the FS (version 2, K70) Rp 1,00 off on Revenue = the tolerance (O26): still sama, LULUS
//   R6  SETUP: version 3 with Revenue Rp 2.500.000,00 and Total equity Rp 2,71 off: 2 beda, C59 GAGAL, cause "selisih" (the data is complete); Tutup buku
//       holds FINAL on C59 (button off), the server action refuses when the button is forced
//   R7  Finance records the override of C59 with a reason (UI): FINAL is locked; the page still says GAGAL (the override only allows the lock), shows the
//       override, now from the locked FINAL; the accuracy tile of the month after reads C59 GAGAL
//   R8  access: admin, finance, management and operations_director open the page; the other six roles get what the app gives (404); the FS tables are
//       closed to them in the database (RLS) and the override of C59 is Finance's alone (release_override_policy, RLS)
// FS fixture: the file name and the SHA-256 on the rows are synthetic (a name for the fixture and the SHA-256 of its rows); nothing here is a real
// Management Report. docs/v5.2/a5b.md has the table.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Journey, cfg, short } = require("./lib/e2e.cjs");

const MONTH = "2026-08-01";
const M = "2026-08";
const OVERRIDE_REASON = "R69 e2e: kontrol ini di luar cakupan rekonsiliasi FS; data uji T7 tidak memenuhinya";
const LABEL = {
  "PL|12": "Revenue", "PL|13": "Cost of Sales", "PL|15": " GROSS PROFIT ", "PL|37": "TOTAL OPERATING EXPENSES", "PL|49": "TOTAL OTHER INCOME (EXPENSE)", "PL|51": "INCOME (LOSS) BEFORE TAX",
  "BS|14": "Cash and cash equivalents", "BS|17": "Trade Receivables - Third Parties", "BS|18": "Trade Receivables - Related Parties", "BS|23": "Inventory - Product", "BS|24": "Inventory - Trading",
  "BS|47": "Trade Payables - Third Parties", "BS|48": "Trade Payables - Affiliates", "BS|51": "Other Payable - Related Parties", "BS|77": "TOTAL EQUITY",
};
const SHEET = { PL: "PL - Management Report", BS: "BS - Management Report" };
const cents = (n) => Math.round(Number(n) * 100);
/** "Rp −420.329.749,60" (house minus U+2212) → cents; "belum ada" → null. */
const parseRp = (t) => { const m = /^Rp\s+(−|-)?([\d.]+),(\d\d)$/.exec(String(t).trim()); return m ? (m[1] ? -1 : 1) * (Number(m[2].replace(/\./g, "")) * 100 + Number(m[3])) : null; };
const rpText = (c) => `${c < 0 ? "−" : ""}${String(Math.floor(Math.abs(c) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(Math.abs(c) % 100).padStart(2, "0")}`;

/** The two reconciliation tables and the text of the page. */
async function readRecon(actor) {
  return actor.page.evaluate(() => {
    const rows = (label) => [...document.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((r) => [...r.querySelectorAll("td,th")].map((c) => (c.textContent || "").trim()));
    return {
      pl: rows("Rekonsiliasi laba rugi"), bs: rows("Rekonsiliasi neraca"), unmapped: rows("Baris di luar pemetaan"),
      notes: [...document.querySelectorAll("ul.note li, p.note, p.muted")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()),
      head: ((document.querySelector("div.fin p strong") || {}).textContent || "").replace(/\s+/g, " ").trim(),
      summary: ((document.querySelector("div.fin p strong") || { parentElement: null }).parentElement?.textContent || "").replace(/\s+/g, " ").trim(),
      detail: [...(([...document.querySelectorAll("div.fin")].find((d) => (d.querySelector("h2") || {}).textContent === "Rincian C59") || document.createElement("div")).querySelectorAll("li"))].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()),
      text: (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " "),
    };
  });
}

/** Tutup buku: the FINAL control table, the rejections, the state of the lock button. */
async function readClose(actor) {
  return actor.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^Kunci FINAL$/.test((b.textContent || "").trim()));
    return {
      controls: [...document.querySelectorAll('table[aria-label="Kontrol FINAL"] tbody tr')].map((r) => [...r.querySelectorAll("td,th")].map((c) => (c.textContent || "").trim())),
      rejections: [...document.querySelectorAll(".override > ul > li")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()),
      overrides: [...document.querySelectorAll(".override table tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => (c.textContent || "").trim())),
      buttonDisabled: btn ? btn.disabled : null,
      reason: ((document.querySelector(".actionbar .reason") || {}).textContent || "").trim(),
      text: (document.querySelector("main") || document.body).innerText.replace(/\s+/g, " "),
    };
  });
}

(async () => {
  const J = new Journey("R69", "rekonsiliasi app ↔ FS (C59): FS fixture dari SQL, LULUS, selisih → GAGAL, override Finance, akses (R69)");
  const ROLES = ["admin", "finance", "management", "operations_director", "sales", "commercial_lead", "ppic", "cost_accounting", "inventory_accounting", "purchasing"];
  const A = {};
  for (const r of ROLES) A[r] = await J.actor(r);
  const fin = A.finance;
  const url = `/m/${M}/rekonsiliasi`, close = `/m/${M}/tutup-buku`;

  /** App amounts of the month, derived by SQL from the tables (read only): { app_line: "6385876039.00" }. */
  const derive = () => Object.fromEntries(J.db(fs.readFileSync(sqlFile, "utf8"), { month: MONTH }));
  const sqlFile = path.join(__dirname, "sql/fs-app-lines.sql");
  const fsMap = () => J.db("select statement, row_no, app_line, status from public.fs_line_map order by statement, row_no").map((r) => ({ statement: r[0], row_no: Number(r[1]), app_line: r[2], status: r[3] }));
  const fsCount = () => J.dbOne(`select count(*) from public.fs_statement_line where month = '${MONTH}'`);
  let expected = null, fileV1 = null;

  /** The INSERT of one version of the FS rows: `rows` = [{ statement, row_no, amount }]. */
  const fsInsert = (version, rows, file) => {
    const sha = crypto.createHash("sha256").update(JSON.stringify(rows.map((r) => [r.statement, r.row_no, r.amount]))).digest("hex");
    const values = rows.map((r) => `('${MONTH}', '${r.statement}', '${SHEET[r.statement]}', ${r.row_no}, '${LABEL[`${r.statement}|${r.row_no}`].replace(/'/g, "''")}', ${r.amount}, '${file}', '${sha}', ${version}, now())`).join(",\n      ");
    return { sha, sql: `insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256, version, locked_at) values\n      ${values}` };
  };
  const fmt = (cs) => `Rp ${rpText(cs)}`;
  const byLine = (m) => new Map(m.map((x) => [x.app_line, x]));

  // ----------------------------------------------------------------------------------------------------------------- 0
  await J.step("0", null, "SETUP: jam uji Sel 1 Sep 09.00 (Agustus sudah lewat); login sepuluh role; keadaan awal tabel FS", async () => {
    J.clock("2026-09-01T09:00:00+07:00");
    for (const a of Object.values(A)) await a.login();
    J.check("sepuluh role masuk", Object.values(A).every((a) => a.loggedIn), Object.keys(A).join(", "));
    J.log(`    DB fs_statement_line: ${J.dbOne("select count(*) from public.fs_statement_line")} baris; fs_line_map: ${J.db("select status, count(*) from public.fs_line_map group by 1").map((r) => r.join(" ")).join(", ")}`);
    J.check("awal: belum ada baris FS, 15 baris pemetaan masih draft (seed B5)", J.dbOne("select count(*) from public.fs_statement_line") === "0" && J.db("select status, count(*) from public.fs_line_map group by 1").map((r) => r.join(" ")).join(",") === "draft 15");
    const pol = J.dbOne("select array_to_string(allowed_roles, ',') from public.release_override_policy where code = 'C59'");
    J.log(`    DB release_override_policy C59: ${pol}`);
    J.check("kebijakan override C59: hanya finance (B5)", pol === "finance", pol);
    J.check("v4_release hidup dan bulan Agustus belum FINAL", J.dbOne("select value ->> 'enabled' from public.app_setting where key = 'v4_release'") === "true" && J.dbOne(`select count(*) from public.month_outlook_version v join public.month_outlook o on o.id = v.month_outlook_id where o.month = '${MONTH}' and v.version = 'FINAL'`) === "0");
  });

  // ----------------------------------------------------------------------------------------------------------------- R1
  await J.step("R1", fin, "belum ada FS: halaman bilang FS belum diimpor, C59 tidak dinilai; angka app di halaman = turunan SQL dari tabel", async () => {
    expected = derive();
    J.log(`    DB turunan SQL (fs-app-lines.sql, ${MONTH}): ${Object.entries(expected).map(([k, v]) => `${k} ${v}`).join("; ")}`);
    J.check("SQL menurunkan 15 baris app", Object.keys(expected).length === 15, String(Object.keys(expected).length));
    const st = await fin.goto(url);
    J.check("halaman Rekonsiliasi terbuka untuk Finance", st === 200, `HTTP ${st}`);
    const r = await readRecon(fin);
    J.log(`    finance  ${short(r.summary, 220)}`);
    J.check("halaman: 'C59 BELUM DIISI' dan 'FS bulan ini belum diimpor'", /C59 BELUM DIISI/.test(r.summary) && /FS bulan ini belum diimpor/.test(r.summary), short(r.summary, 200));
    J.check("catatan: C59 belum dinilai dan belum menahan FINAL", r.notes.some((n) => /C59 belum dinilai dan belum menahan FINAL/.test(n)));
    J.check("laba rugi app: jurnal bulan penuh (Agustus sudah lewat), FINAL belum dikunci; tanpa baris Selisih costing atau Biaya kapasitas idle (mode cogs)", r.notes.some((n) => /jurnal bulan penuh \+ penyesuaian yang diposting; FINAL belum dikunci/.test(n)) && r.notes.some((n) => /tidak ada baris Selisih costing atau Biaya kapasitas idle bulan ini/.test(n)));
    // the app lines are listed outside the map (the map is draft): exact rupiah, compared with the SQL
    const app = new Map(r.unmapped.filter((c) => c[2] !== "").map((c) => [c[0], c[2]]));
    const diffs = Object.entries(expected).filter(([line, amt]) => parseRp(app.get(line)) !== cents(amt)).map(([line, amt]) => `${line}: halaman ${app.get(line)} vs SQL ${fmt(cents(amt))}`);
    J.log(`    finance  15 angka app di halaman vs SQL: ${diffs.length ? diffs.join("; ") : "semua sama sampai sen"}`);
    J.check("15 angka app di halaman = turunan SQL dari tabel (sampai sen; tanpa DO unbilled dan tanpa baris v5 di bulan ini)", app.size === 15 && diffs.length === 0, diffs.join("; "));
    const c = await (async () => { await fin.goto(close); return readClose(fin); })();
    J.log(`    finance  Tutup buku: kontrol ${c.controls.map((x) => `${x[0]} ${x[2]}`).join(", ")}`);
    J.check("Tutup buku: C59 tidak ada di daftar kontrol FINAL (tidak dinilai tanpa FS)", !c.controls.some((x) => x[0] === "C59"), c.controls.map((x) => x[0]).join(","));
    await fin.shot("R69-R1-tanpa-fs");
  });

  // ----------------------------------------------------------------------------------------------------------------- R2
  await J.step("R2", fin, "FS diimpor (SETUP) tetapi pemetaan masih draft: 'pemetaan belum disetujui', C59 belum dinilai", async () => {
    const map = fsMap();
    const rows = map.map((m) => ({ statement: m.statement, row_no: m.row_no, amount: expected[m.app_line] }));
    fileV1 = "e2e-fs-agustus-2026-v1.xlsx";
    const ins = fsInsert(1, rows, fileV1);
    J.setup(`FS Agustus (fs_statement_line): 15 baris versi 1, terkunci; jumlah = turunan SQL angka app; berkas sintetis ${fileV1}, SHA-256 ${ins.sha.slice(0, 12)}…`, ins.sql);
    J.log(`    DB fs_statement_line: ${fsCount()} baris; fs_line_map: ${J.db("select status, count(*) from public.fs_line_map group by 1").map((r) => r.join(" ")).join(", ")}`);
    const st = await fin.goto(url);
    J.check("halaman terbuka", st === 200, `HTTP ${st}`);
    const r = await readRecon(fin);
    J.log(`    finance  ${short(r.summary, 260)}`);
    J.check("pemetaan belum disetujui Finance (15 baris masih draft): C59 BELUM DIISI", /C59 BELUM DIISI/.test(r.summary) && /pemetaan belum disetujui Finance/.test(r.summary) && r.notes.some((n) => /15 baris masih draft/.test(n)), short(r.summary, 220));
    const meta = r.notes.find((n) => /^FS acuan:/.test(n)) || "";
    J.log(`    finance  ${meta}`);
    J.check("FS acuan: versi 1, berkas sintetis, SHA-256, 15 baris, dikunci", meta.includes("versi 1") && meta.includes(fileV1) && meta.includes(`${ins.sha.slice(0, 12)}…`) && /15 baris, dikunci/.test(meta), meta);
    J.check("tabel laba rugi dan neraca kosong: tidak ada baris yang dipetakan", r.pl.length === 0 && r.bs.length === 0);
    const c = await (async () => { await fin.goto(close); return readClose(fin); })();
    J.check("Tutup buku: C59 masih tidak dinilai dan tidak menahan", !c.controls.some((x) => x[0] === "C59") && !c.rejections.some((x) => /^C59/.test(x)), c.rejections.join(" | "));
  });

  // ----------------------------------------------------------------------------------------------------------------- R3
  await J.step("R3", fin, "pemetaan disetujui (SETUP): 15 sama, 0 beda, C59 LULUS; kolom FS = kolom app = turunan SQL; Tutup buku mencantumkan C59 LULUS", async () => {
    J.setup("fs_line_map: 15 baris status agreed (Finance menyetujui pemetaan minimum)", "update public.fs_line_map set status = 'agreed', updated_by = 'e2e (setup)'");
    const st = await fin.goto(url);
    J.check("halaman terbuka", st === 200, `HTTP ${st}`);
    const r = await readRecon(fin);
    J.log(`    finance  ${short(r.summary, 260)}`);
    J.check("C59 LULUS: 15 sama, 0 beda, 0 belum ada angka dari 15 baris yang dipetakan", /C59 LULUS/.test(r.summary) && /15 sama, 0 beda, 0 belum ada angka dari 15 baris yang dipetakan/.test(r.summary), short(r.summary, 240));
    const all = [...r.pl, ...r.bs];
    J.check("tabel laba rugi (6 baris) dan neraca (9 baris)", r.pl.length === 6 && r.bs.length === 9, `${r.pl.length} + ${r.bs.length}`);
    const bad = all.filter((c) => c[5] !== "sama" || parseRp(c[4]) !== 0);
    J.check("setiap baris: status 'sama', selisih Rp 0,00", bad.length === 0, bad.map((c) => `${c[0]} ${c[5]} ${c[4]}`).join("; "));
    const map = fsMap();
    const mism = map.filter((m) => { const row = all.find((c) => c[0].startsWith(`${m.statement} b.${m.row_no} `)); return !row || parseRp(row[2]) !== cents(expected[m.app_line]) || parseRp(row[3]) !== cents(expected[m.app_line]); });
    J.log(`    finance  app = FS = SQL pada ${map.length - mism.length} dari ${map.length} baris`);
    J.check("kolom app dan kolom FS sama dengan turunan SQL di semua 15 baris", mism.length === 0, mism.map((m) => m.app_line).join(", "));
    J.check("tanpa 'Rincian C59' (tidak ada selisih) dan tanpa catatan 'Ada selisih'", !/Rincian C59/.test(r.text) && !/Ada selisih di atas toleransi/.test(r.text));
    J.check("laba rugi app: jurnal bulan penuh (bulan sudah lewat), FINAL belum dikunci", r.notes.some((n) => /jurnal bulan penuh \+ penyesuaian yang diposting; FINAL belum dikunci/.test(n)), r.notes.filter((n) => /Angka app laba rugi/.test(n)).join(" "));
    await fin.shot("R69-R3-c59-lulus");
    const c = await (async () => { await fin.goto(close); return readClose(fin); })();
    const row = c.controls.find((x) => x[0] === "C59");
    J.log(`    finance  Tutup buku: kontrol ${c.controls.map((x) => `${x[0]} ${x[2]}`).join(", ")}; ditolak: ${c.reason}`);
    J.check("Tutup buku: C59 ada di kontrol FINAL dan LULUS", !!row && row[2] === "LULUS", row ? row.join(" ") : "tidak ada");
    J.check("Tutup buku: C59 bukan penolakan FINAL (yang menahan kontrol lain)", !c.rejections.some((x) => /^C59/.test(x)) && c.buttonDisabled === true && !/C59/.test(c.reason), c.reason);
    await fin.shot("R69-R3-tutup-buku");
  });

  // ----------------------------------------------------------------------------------------------------------------- R4
  await J.step("R4", fin, "Finance mencatat override (UI) untuk enam kontrol FINAL di luar FS yang tidak dipenuhi data uji; tanpa itu FINAL hanya bergantung pada C59: tombol Kunci FINAL aktif", async () => {
    await fin.goto(close);
    const before = await readClose(fin);
    const others = before.rejections.map((x) => x.split(" ")[0]).filter((c) => c !== "C59");
    J.log(`    finance  penolakan FINAL sebelum override: ${before.rejections.map((x) => x.split(" · ")[0]).join(" | ")}`);
    J.check("penolakan FINAL = enam kontrol di luar FS (C22, C23, C24, C35, C36, C49), semuanya bisa di-override Finance", others.sort().join(",") === "C22,C23,C24,C35,C36,C49" && before.rejections.every((x) => /override oleh/.test(x)), others.join(","));
    for (const code of ["C22", "C23", "C24", "C35", "C36", "C49"]) {
      await fin.page.locator('.override select[name="code"]').selectOption(code);
      await fin.page.locator('.override input[name="reason"]').fill(OVERRIDE_REASON);
      await fin.page.locator('.override input[name="evidence"]').fill("tests/e2e/journey-R69.cjs");
      const m = await fin.act("Catat override");
      // the form goes away with the last rejection, and its message with it: the row in the database is the evidence
      J.check(`override ${code} dicatat oleh Finance`, !m.error && J.dbOne(`select count(*) from public.release_override where scope_kind = 'month' and scope = '${MONTH}:FINAL' and code = '${code}' and created_role = 'finance' and deleted_at is null`) === "1", m.ok || m.error || "(pesan ikut hilang bersama formulir)");
    }
    const ov = J.db(`select code, created_role, reason from public.release_override where scope_kind = 'month' and scope = '${MONTH}:FINAL' and deleted_at is null order by code`);
    J.log(`    DB release_override ${MONTH}:FINAL: ${ov.map((r) => `${r[0]} (${r[1]})`).join(", ")}`);
    J.check("DB: enam override, semuanya oleh finance, dengan alasan", ov.length === 6 && ov.every((r) => r[1] === "finance" && r[2] === OVERRIDE_REASON), ov.map((r) => r[0]).join(","));
    await fin.goto(close);
    const c = await readClose(fin);
    J.log(`    finance  sesudah override: ditolak "${c.reason}"; tombol Kunci FINAL ${c.buttonDisabled ? "nonaktif" : "aktif"}; kontrol ${c.controls.map((x) => `${x[0]} ${x[2]}`).join(", ")}`);
    J.check("tidak ada penolakan FINAL lagi (C59 LULUS, enam lainnya dilepas override)", c.rejections.length === 0 && c.reason === "", c.rejections.join(" | ") || c.reason);
    J.check("tombol 'Kunci FINAL' aktif", c.buttonDisabled === false);
    await fin.shot("R69-R4-final-siap");
  });

  // ----------------------------------------------------------------------------------------------------------------- R5
  await J.step("R5", fin, "koreksi FS versi 2 (SETUP): Revenue selisih tepat Rp 1,00 = toleransi (O26): tetap sama, C59 LULUS, FINAL tetap boleh", async () => {
    const map = fsMap();
    const rev = map.find((m) => m.app_line === "revenue");
    const amount = (cents(expected.revenue) + 100) / 100; // the FS is Rp 1,00 above the app
    const ins = fsInsert(2, [{ statement: rev.statement, row_no: rev.row_no, amount: amount.toFixed(2) }], "e2e-fs-agustus-2026-v2.xlsx");
    J.setup(`FS Agustus versi 2 (koreksi, K70): ${rev.statement} b.${rev.row_no} Revenue = app + Rp 1,00; berkas sintetis e2e-fs-agustus-2026-v2.xlsx`, ins.sql);
    J.log(`    DB fs_statement_line: ${J.db(`select version, count(*) from public.fs_statement_line where month = '${MONTH}' group by 1 order by 1`).map((r) => `v${r[0]} ${r[1]}`).join(", ")}`);
    await fin.goto(url);
    const r = await readRecon(fin);
    const row = r.pl.find((c) => c[0].startsWith("PL b.12 "));
    J.log(`    finance  ${short(r.summary, 200)}; PL b.12: app ${row?.[2]}, FS ${row?.[3]}, selisih ${row?.[4]}, ${row?.[5]}`);
    J.check("Revenue: FS = app + Rp 1,00, selisih −Rp 1,00, status 'sama' (di dalam toleransi)", !!row && parseRp(row[3]) === cents(expected.revenue) + 100 && parseRp(row[4]) === -100 && row[5] === "sama", row ? row.join(" | ") : "tidak ada");
    J.check("C59 tetap LULUS (15 sama)", /C59 LULUS/.test(r.summary) && /15 sama, 0 beda/.test(r.summary), short(r.summary, 200));
    const meta = r.notes.find((n) => /^FS acuan:/.test(n)) || "";
    J.check("FS acuan menyebut versi 2 dan berkas koreksi", meta.includes("versi 2") && meta.includes("e2e-fs-agustus-2026-v2.xlsx"), meta);
    await fin.goto(close);
    const c = await readClose(fin);
    J.check("Tutup buku: C59 LULUS dan tombol 'Kunci FINAL' aktif", c.controls.find((x) => x[0] === "C59")?.[2] === "LULUS" && c.buttonDisabled === false, c.reason);
  });

  // ----------------------------------------------------------------------------------------------------------------- R6
  let sha = null;
  await J.step("R6", fin, "koreksi FS versi 3 dengan selisih (SETUP): 2 baris beda, C59 GAGAL, sebab 'selisih'; FINAL ditahan C59 (tombol nonaktif, aksi server menolak)", async () => {
    const map = fsMap();
    const rev = map.find((m) => m.app_line === "revenue"), eq = map.find((m) => m.app_line === "ekuitas");
    const dRev = 250000000, dEq = 271; // Rp 2.500.000,00 and Rp 2,71 above the app, in cents
    const rows = [{ ...rev, amount: ((cents(expected.revenue) + dRev) / 100).toFixed(2) }, { ...eq, amount: ((cents(expected.ekuitas) + dEq) / 100).toFixed(2) }].map((x) => ({ statement: x.statement, row_no: x.row_no, amount: x.amount }));
    const ins = fsInsert(3, rows, "e2e-fs-agustus-2026-v3.xlsx");
    J.setup("FS Agustus versi 3 (koreksi, K70): Revenue = app + Rp 2.500.000,00 dan Total ekuitas = app + Rp 2,71 (selisih yang disengaja); berkas sintetis e2e-fs-agustus-2026-v3.xlsx", ins.sql);
    await fin.goto(url);
    const r = await readRecon(fin);
    J.log(`    finance  ${short(r.summary, 220)}`);
    J.check("C59 GAGAL: 13 sama, 2 beda dari 15 baris", /C59 GAGAL/.test(r.summary) && /13 sama, 2 beda, 0 belum ada angka dari 15 baris/.test(r.summary), short(r.summary, 220));
    const rowRev = r.pl.find((c) => c[0].startsWith("PL b.12 ")), rowEq = r.bs.find((c) => c[0].startsWith("BS b.77 "));
    J.log(`    finance  PL b.12: ${rowRev?.slice(2).join(" | ")}; BS b.77: ${rowEq?.slice(2).join(" | ")}`);
    J.check("Revenue: selisih −Rp 2.500.000,00, status beda, sebab 'selisih' (data lengkap, definisi sama)", !!rowRev && parseRp(rowRev[4]) === -dRev && rowRev[5] === "beda" && /^selisih/.test(rowRev[6]), rowRev ? rowRev.join(" | ") : "tidak ada");
    J.check("Total ekuitas: selisih −Rp 2,71 (di atas toleransi Rp 1), status beda", !!rowEq && parseRp(rowEq[4]) === -dEq && rowEq[5] === "beda" && /^selisih/.test(rowEq[6]), rowEq ? rowEq.join(" | ") : "tidak ada");
    J.check("13 baris lain tetap sama", [...r.pl, ...r.bs].filter((c) => c[5] === "sama").length === 13);
    J.check("'Rincian C59' menyebut kedua baris dan catatan: kunci FINAL ditahan sampai override Finance di Tutup buku", r.detail.length === 2 && r.detail.some((d) => /PL b\.12 /.test(d)) && r.detail.some((d) => /BS b\.77 /.test(d)) && /Kunci FINAL ditahan sampai selisih dijelaskan atau Finance mencatat override C59/.test(r.text), r.detail.join(" | "));
    await fin.shot("R69-R6-c59-gagal");
    // Tutup buku: the FINAL lock is held on C59 alone
    await fin.goto(close);
    const c = await readClose(fin);
    J.log(`    finance  Tutup buku: ${c.controls.find((x) => x[0] === "C59")?.slice(0, 3).join(" ")}; penolakan: ${c.rejections.join(" | ")}; alasan di layar: "${c.reason}"; tombol ${c.buttonDisabled ? "nonaktif" : "aktif"}`);
    J.check("Tutup buku: C59 GAGAL di kontrol FINAL", c.controls.find((x) => x[0] === "C59")?.[2] === "GAGAL");
    J.check("FINAL ditahan C59 saja: satu penolakan 'C59 GAGAL', bisa di-override oleh finance", c.rejections.length === 1 && /^C59 GAGAL/.test(c.rejections[0]) && /override oleh finance/.test(c.rejections[0]), c.rejections.join(" | "));
    J.check("tombol 'Kunci FINAL' nonaktif dengan alasan 'ditolak: C59 GAGAL'", c.buttonDisabled === true && c.reason === "ditolak: C59 GAGAL", `${c.buttonDisabled} "${c.reason}"`);
    await fin.shot("R69-R6-tutup-buku-ditahan");
    // the rule is on the server: force the disabled button (disabled and, R146, aria-disabled), the action itself refuses (finalizeMonthV4)
    await fin.page.evaluate(() => { for (const b of document.querySelectorAll("button")) if (/^Kunci FINAL$/.test((b.textContent || "").trim())) { b.disabled = false; b.removeAttribute("aria-disabled"); } });
    const m = await fin.act("Kunci FINAL", { exact: true });
    J.log(`    finance  tombol dipaksa aktif: ${short(m.error || m.ok || "", 220)}`);
    J.check("aksi server menolak: 'FINAL ditolak: C59 GAGAL'", !!m.error && /^FINAL ditolak: C59 GAGAL$/.test(m.error), m.error || m.ok || "");
    const n = J.dbOne(`select count(*) from public.month_outlook_version v join public.month_outlook o on o.id = v.month_outlook_id where o.month = '${MONTH}' and v.version = 'FINAL'`);
    J.check("DB: FINAL Agustus tidak terkunci", n === "0", `${n}`);
    sha = null;
  });

  // ----------------------------------------------------------------------------------------------------------------- R7
  await J.step("R7", fin, "Finance mencatat override C59 dengan alasan (UI): FINAL dikunci; halaman tetap GAGAL, menampilkan override, dari FINAL terkunci; tile akurasi bulan sesudahnya", async () => {
    await fin.goto(close);
    const reason = "R69 e2e: selisih FS Agustus (Revenue Rp 2.500.000, ekuitas Rp 2,71) dijelaskan Finance; FS versi 3 dikoreksi di sumber";
    await fin.page.locator('.override select[name="code"]').selectOption("C59");
    await fin.page.locator('.override input[name="reason"]').fill(reason);
    await fin.page.locator('.override input[name="evidence"]').fill("e2e-fs-agustus-2026-v3.xlsx");
    const o = await fin.act("Catat override");
    J.check("override C59 dicatat (formulir dan pesannya hilang bersama penolakan terakhir: barisnya di database di bawah)", !o.error, o.ok || o.error || "");
    const ov = J.db(`select code, created_role, reason, evidence, created_by from public.release_override where scope_kind = 'month' and scope = '${MONTH}:FINAL' and code = 'C59' and deleted_at is null`);
    J.log(`    DB release_override C59: ${ov.map((r) => r.join(" · ")).join("; ")}`);
    J.check("DB: override C59 oleh finance dengan alasan dan bukti", ov.length === 1 && ov[0][1] === "finance" && ov[0][2] === reason && ov[0][3] === "e2e-fs-agustus-2026-v3.xlsx" && ov[0][4] === `finance@${cfg.domain}`, ov.map((r) => r.join(" ")).join("; "));
    await fin.goto(close);
    const c = await readClose(fin);
    J.log(`    finance  Tutup buku sesudah override: C59 ${c.controls.find((x) => x[0] === "C59")?.[2]}; ditolak "${c.reason}"; tombol ${c.buttonDisabled ? "nonaktif" : "aktif"}`);
    J.check("C59 tetap GAGAL di tabel; override hanya mengizinkan kunci: tidak ada penolakan, tombol aktif", c.controls.find((x) => x[0] === "C59")?.[2] === "GAGAL" && c.rejections.length === 0 && c.buttonDisabled === false, c.rejections.join(" | "));
    const f = await fin.act("Kunci FINAL", { exact: true, timeout: 280_000 });
    J.log(`    finance  ${short(f.ok || f.error || "", 260)}`);
    J.check("FINAL dikunci (SHA …)", !!f.ok && /^FINAL dikunci \(SHA [0-9a-f]{12}…\)/.test(f.ok), f.ok || f.error || "");
    const v = J.db(`select v.version, left(v.snapshot_sha256, 12), v.locked_by, v.snapshot -> 'controls' @> '[{"code":"C59","status":"GAGAL"}]'::jsonb from public.month_outlook_version v join public.month_outlook o on o.id = v.month_outlook_id where o.month = '${MONTH}' and v.version = 'FINAL'`);
    J.log(`    DB FINAL Agustus: ${v.map((r) => r.join(" · ")).join("; ") || "tidak ada"}`);
    J.check("DB: FINAL Agustus terkunci oleh finance; snapshot memuat C59 GAGAL (dikunci dengan override)", v.length === 1 && v[0][2] === `finance@${cfg.domain}` && v[0][3] === "t", v.map((r) => r.join(" ")).join("; "));
    // the page now reads the locked FINAL: the reference is its snapshot, C59 is still GAGAL, the override is shown
    await fin.goto(url);
    const r = await readRecon(fin);
    J.log(`    finance  ${short(r.summary, 200)}`);
    J.check("Rekonsiliasi: angka app laba rugi dari FINAL yang sudah dikunci; C59 tetap GAGAL dengan 2 baris beda", r.notes.some((n) => /FINAL yang sudah dikunci/.test(n)) && /C59 GAGAL/.test(r.summary) && /13 sama, 2 beda/.test(r.summary), short(r.summary, 200));
    const nominal = [...r.pl, ...r.bs].filter((x) => x[5] === "beda").map((x) => x[0].split(" · ")[0]).sort().join(",");
    J.check("baris yang beda masih PL b.12 dan BS b.77 (FINAL = angka jurnal yang sama)", nominal === "BS b.77,PL b.12", nominal);
    J.check("bagian 'Override C59' menampilkan alasan, bukti dan Finance; C59 tetap tampil di atas", /Override C59/.test(r.text) && r.text.includes(reason) && r.text.includes("e2e-fs-agustus-2026-v3.xlsx") && /oleh finance/.test(r.text), short(r.text.slice(r.text.indexOf("Override C59")), 200));
    await fin.shot("R69-R7-final-terkunci");
    // the accuracy tile of Outlook bulan: it compares a locked V1 or V2 with the FINAL, and V1/V2 of August do not exist in this database (the lock of V1 is
    // Thursday 20 Aug in production): SETUP puts a V1 next to the FINAL, 2% above it, only so that the tile has a version to compare
    J.setup("V1 Agustus (dikunci Kam 20 Agu di produksi, tidak ada di data uji) di samping FINAL: revenue, COGS, GP dan NIBT 2% di atas FINAL; hanya agar tile akurasi punya versi pembanding", `
      insert into public.month_outlook_version (month_outlook_id, version, cut_off_date, locked_at, locked_by, snapshot, snapshot_sha256, revenue, cogs, gp, opex, nibt, rule_version)
      select f.month_outlook_id, 'V1', date '2026-08-19', timestamptz '2026-08-20 03:00:00+00', 'e2e (setup)', '{"days": [], "rows": []}'::jsonb, encode(sha256(convert_to('e2e-v1-agustus', 'UTF8')), 'hex'),
             round(f.revenue * 1.02, 2), round(f.cogs * 1.02, 2), round(f.gp * 1.02, 2), f.opex, round(f.nibt * 1.02, 2), f.rule_version
        from public.month_outlook_version f join public.month_outlook o on o.id = f.month_outlook_id where o.month = '${MONTH}' and f.version = 'FINAL'`);
    const s2 = await fin.goto(`/m/${M}`);
    const tile = ((await fin.page.locator('section[data-tile="akurasi"]').first().innerText()) || "").replace(/\s+/g, " ");
    J.log(`    finance  /m/2026-08 tile akurasi: ${short(tile, 420)}`);
    J.check("Outlook bulan: tile 'Akurasi bulan terakhir yang FINAL' (Agustus, V1 terhadap FINAL) memuat baris 'Rekonsiliasi ke FS (C59)': 'GAGAL: 2 dari 15 baris beda'", s2 === 200 && /Agustus 2026, V1 terhadap FINAL/.test(tile) && /Rekonsiliasi ke FS \(C59\)\s*GAGAL: 2 dari 15 baris beda/.test(tile), short(tile, 300));
    J.check("baris C59 di tile menaut ke halaman Rekonsiliasi", (await fin.page.locator(`section[data-tile="akurasi"] a[href="/m/${M}/rekonsiliasi"]`).count()) > 0);
    await fin.shot("R69-R7-tile-akurasi", { fullPage: false });
  });

  // ----------------------------------------------------------------------------------------------------------------- R8
  await J.step("R8", null, "akses: admin, finance, management, operations_director membuka halaman; enam role lain tidak; tabel FS tertutup di database; override C59 hanya Finance", async () => {
    const OPEN = ["admin", "finance", "management", "operations_director"];
    const seen = {};
    for (const role of ROLES) {
      const res = await A[role].ctx.request.get(`${cfg.base}${url}`, { maxRedirects: 0, timeout: 60_000 });
      J._record({ role, method: "GET", path: url, status: res.status(), kind: "akses" });
      seen[role] = res.status();
    }
    J.log(`    akses ${url}: ${ROLES.map((r) => `${r} ${seen[r]}`).join(", ")}`);
    J.check("admin, finance, management dan operations_director: 200", OPEN.every((r) => seen[r] === 200), OPEN.map((r) => `${r} ${seen[r]}`).join(", "));
    J.check("sales, commercial_lead, ppic, cost_accounting, inventory_accounting dan purchasing: 404 (halaman tidak ada untuk role itu, K48)", ROLES.filter((r) => !OPEN.includes(r)).every((r) => seen[r] === 404), ROLES.filter((r) => !OPEN.includes(r)).map((r) => `${r} ${seen[r]}`).join(", "));
    // the database says the same: the FS tables are for admin, finance, management and operations_director
    const tok = async (a) => (await (await fetch(`${cfg.supa}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.anon }, body: JSON.stringify({ email: a.email, password: cfg.password }) })).json()).access_token;
    const get = async (who, a, p) => { const r = await fetch(`${cfg.supa}/rest/v1/${p}`, { headers: { apikey: cfg.anon, authorization: `Bearer ${await tok(a)}` } }); const b = await r.json().catch(() => null); J.log(`    ${who} (langsung ke PostgREST)  GET /rest/v1/${short(p, 60)} → HTTP ${r.status} ${Array.isArray(b) ? `${b.length} baris` : short(JSON.stringify(b), 80)}`); return { s: r.status, n: Array.isArray(b) ? b.length : null }; };
    const rowsOf = {};
    for (const role of ["finance", "management", "operations_director", "sales", "ppic", "cost_accounting"]) {
      const a = await get(role, A[role], "fs_statement_line?select=row_no&limit=100");
      const b = await get(role, A[role], "fs_line_map?select=row_no&limit=100");
      rowsOf[role] = [a.n, b.n, a.s, b.s];
    }
    J.check("finance, management dan operations_director membaca baris FS dan pemetaan", ["finance", "management", "operations_director"].every((r) => rowsOf[r][0] > 0 && rowsOf[r][1] === 15), JSON.stringify(rowsOf));
    J.check("sales, ppic dan cost_accounting: nol baris (RLS), bukan galat", ["sales", "ppic", "cost_accounting"].every((r) => rowsOf[r][0] === 0 && rowsOf[r][1] === 0 && rowsOf[r][2] === 200), JSON.stringify(rowsOf));
    // an override of C59 is Finance's alone (RLS names the roles of release_override_policy)
    const t = await tok(A.cost_accounting);
    const ins = await fetch(`${cfg.supa}/rest/v1/release_override`, { method: "POST", headers: { apikey: cfg.anon, authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ scope_kind: "month", scope: "2026-09-01:FINAL", code: "C59", reason: "e2e: Cost Accounting mencoba override C59", evidence: "e2e" }) });
    const ib = await ins.json().catch(() => null);
    J.log(`    cost_accounting (langsung ke PostgREST)  POST /rest/v1/release_override C59 → HTTP ${ins.status} ${short(JSON.stringify(ib), 120)}`);
    J.check("override C59 oleh cost_accounting ditolak (403, RLS: hanya finance)", ins.status === 403, `HTTP ${ins.status}`);
    J.check("DB: tidak ada override C59 untuk 2026-09-01", J.dbOne("select count(*) from public.release_override where scope = '2026-09-01:FINAL' and code = 'C59'") === "0");
  }, { allow: [{ status: 404, why: "halaman Rekonsiliasi tidak ada untuk role itu (K48, R69: hanya admin, finance, management, operations_director)" }, { area: "rest", status: 403, path: /release_override/, why: "penolakan yang diharapkan: override C59 hanya Finance" }] });

  process.exit(await J.done());
})().catch((e) => { console.error(e); process.exit(2); });
