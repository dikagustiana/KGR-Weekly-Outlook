#!/usr/bin/env node
"use strict";
// Reads out/*.result.json of the journeys, prints a table and writes out/SUMMARY.md and out/summary.json.
// Exit 1 when a journey left no result (crashed), has a failed check or an unexpected 4xx/5xx; XPASS only warns
// (E2E_STRICT_XFAIL=1 makes it fail: the marker of an expected-to-fail step is then due for removal).
const fs = require("node:fs");
const path = require("node:path");
const OUT = process.env.E2E_OUT || path.join(__dirname, "out");
const ORDER = ["prepare", "matrix", "T7", "A6", "F19", "volume"];
const only = process.env.E2E_ONLY ? new Set(["prepare", ...process.env.E2E_ONLY.split(/\s+/)]) : null;
const env = process.env.E2E_ENV_LABEL || "PG16 lokal + PostgREST 12 + mock auth";
let bad = 0;
const rows = [];
const md = [`# Ringkasan e2e`, ``, `Lingkungan: **${env}** (bukan Supabase). Dijalankan ${new Date().toISOString()} (jam dinding mesin).`, ``,
  `| Journey | Cek lulus | Gagal | XFAIL | XPASS | Respons app | Tak terduga | SETUP | Detik |`, `|---|---|---|---|---|---|---|---|---|`];
const xf = [], xp = [];
for (const name of ORDER.filter((n) => !only || only.has(n) || (n === "T7" && (only.has("A6") || only.has("F19") || only.has("volume"))))) {
  const f = path.join(OUT, `${name}.result.json`);
  if (!fs.existsSync(f)) { rows.push(`${name.padEnd(8)} TIDAK ADA HASIL (journey terhenti sebelum selesai)`); md.push(`| ${name} | tidak ada hasil | | | | | | | |`); bad++; continue; }
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  const failed = r.fail.length + r.unexpected.length;
  if (failed) bad++;
  if (r.xpass.length && process.env.E2E_STRICT_XFAIL === "1") bad++;
  rows.push(`${name.padEnd(8)} lulus ${String(r.pass).padStart(4)}  gagal ${String(r.fail.length).padStart(3)}  xfail ${String(r.xfail.length).padStart(2)}  xpass ${String(r.xpass.length).padStart(2)}  respons app ${String(r.appResponses).padStart(4)}  tak terduga ${r.unexpected.length}  SETUP ${r.setups.length}  ${r.durationSec}s${failed ? "  <== GAGAL" : ""}`);
  md.push(`| ${name} | ${r.pass} | ${r.fail.length} | ${r.xfail.length} | ${r.xpass.length} | ${r.appResponses} | ${r.unexpected.length} | ${r.setups.length} | ${r.durationSec} |`);
  for (const x of r.xfail) xf.push({ journey: name, ...x });
  for (const x of r.xpass) xp.push({ journey: name, ...x });
  for (const m of r.fail) rows.push(`    GAGAL ${name}: ${m}`);
}
md.push("", "## Diharapkan gagal (XFAIL)", "");
md.push(xf.length ? "| Journey | Langkah | Cek | Menunggu |\n|---|---|---|---|" : "Tidak ada.");
for (const x of xf) md.push(`| ${x.journey} | ${x.step} | ${x.name} | ${x.waits} |`);
if (xp.length) { md.push("", "## XPASS (penanda xfail siap dihapus)", ""); for (const x of xp) md.push(`- ${x.journey} ${x.step}: ${x.name} — ${x.waits}`); }
console.log("\n==== RINGKASAN e2e (" + env + ") ====");
for (const r of rows) console.log(r);
for (const x of xf) console.log(`  XFAIL ${x.journey} ${x.step}: ${x.name} — menunggu ${x.waits}`);
for (const x of xp) console.log(`  XPASS ${x.journey} ${x.step}: ${x.name} — ${x.waits} sudah terpenuhi (hapus penanda)`);
console.log(bad ? `==== e2e GAGAL: ${bad} journey bermasalah ====` : "==== e2e HIJAU ====");
// GitHub Actions: the lines also as annotations (readable through the checks API) and as the job summary
if (process.env.GITHUB_ACTIONS === "true") {
  for (const r of rows) if (!r.startsWith("    ")) console.log(`::notice title=e2e ringkasan::${r.replace(/\s+/g, " ")}`);
  for (const x of xf) console.log(`::notice title=e2e xfail::${x.journey} ${x.step}: ${x.name} — menunggu ${x.waits}`);
  console.log(`::notice title=e2e hasil::${bad ? "GAGAL" : "HIJAU"} (${env})`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
}
fs.writeFileSync(path.join(OUT, "SUMMARY.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ environment: env, ok: bad === 0, xfail: xf, xpass: xp }, null, 2));
process.exit(bad ? 1 : 0);
