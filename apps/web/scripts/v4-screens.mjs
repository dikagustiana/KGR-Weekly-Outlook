// Screenshot comparison of PRD v4 §9.4: a mockup of reference/design/ against the page rendered by the app, per tile.
//
//   node apps/web/scripts/v4-screens.mjs <mockup.html> <page.html> <name> [out-dir]
//
// For both files, at 1366×768: screenshot above the fold and full page; for every tile (data-tile) its grid position
// (x, y, w, h), its box in px, its title and the text of its values (data-tile-value). The report lists every
// difference per tile; each one must be explained in docs/v4/bukti/<irisan>-selisih.md to count as approved.
// Also: the rows 0–3 (slicer, headline, cards) end above 768 px without scrolling (§6.1), the DOM of the page has none
// of the technical names / e-mail / "→" / " M " as unit / inline hex (§9.4), contrast of the tokens (§5.2).
// The page file comes from `scripts/v4-fixture.tsx` (fixture) or a saved HTML of a real session (production).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) throw new Error("playwright tidak ditemukan");

const [mockup, page, name = "halaman", outArg] = process.argv.slice(2);
if (!mockup || !page) { console.error("pakai: v4-screens.mjs <mockup.html> <page.html> <nama> [out-dir]"); process.exit(2); }
const out = resolve(outArg ?? "docs/v4/bukti");
mkdirSync(join(out, "img"), { recursive: true });

const executablePath = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function inspect(file, label) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const pg = await ctx.newPage();
  await pg.goto("file://" + resolve(file));
  await pg.screenshot({ path: join(out, "img", `${name}-${label}-1366x768.png`) });
  await pg.screenshot({ path: join(out, "img", `${name}-${label}-full.png`), fullPage: true });
  const data = await pg.evaluate(() => {
    const grid = document.querySelector(".tg")?.getBoundingClientRect();
    const tiles = {};
    for (const el of document.querySelectorAll("[data-tile]")) {
      const r = el.getBoundingClientRect();
      const b = el.querySelector(".tile-b");
      tiles[el.dataset.tile] = {
        grid: [Number(el.dataset.x), Number(el.dataset.y), Number(el.dataset.w), Number(el.dataset.h)],
        box: [Math.round(r.left - (grid?.left ?? 0)), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)],
        bottom: Math.round(r.bottom + window.scrollY),
        title: el.querySelector("[data-tile-title]")?.textContent?.trim() ?? "",
        values: [...el.querySelectorAll("[data-tile-value]")].map((v) => v.textContent.replace(/\s+/g, " ").trim()).filter(Boolean),
        note: el.querySelector("[data-tile-note]")?.textContent?.trim() ?? "",
        clipped: b ? b.scrollHeight > b.clientHeight + 1 : false,
      };
    }
    const html = document.documentElement.outerHTML;
    return { tiles, html, scrollH: document.documentElement.scrollHeight, scrollY: window.scrollY };
  });
  await ctx.close();
  return data;
}

const A = await inspect(mockup, "mockup");
const B = await inspect(page, "halaman");
await browser.close();

// ------------------------------------------------------------------------------------------------ per tile
const diffs = [];
const ids = [...new Set([...Object.keys(A.tiles), ...Object.keys(B.tiles)])];
for (const id of ids) {
  const a = A.tiles[id], b = B.tiles[id];
  if (!a) { diffs.push([id, "tile", "tidak ada di mockup", "ada di halaman"]); continue; }
  if (!b) { diffs.push([id, "tile", "ada di mockup", "tidak dirender di halaman"]); continue; }
  if (a.grid.join() !== b.grid.join()) diffs.push([id, "posisi (x,y,w,h)", a.grid.join(","), b.grid.join(",")]);
  const [ax, ay, aw, ah] = a.box, [bx, by, bw, bh] = b.box;
  if (Math.abs(ax - bx) > 2 || Math.abs(ay - by) > 2 || Math.abs(aw - bw) > 2 || Math.abs(ah - bh) > 2) diffs.push([id, "ukuran px (x,y,w,h)", a.box.join(","), b.box.join(",")]);
  if (a.title !== b.title) diffs.push([id, "judul", a.title || "(tanpa judul)", b.title || "(tanpa judul)"]);
  const av = a.values.join(" | "), bv = b.values.join(" | ");
  if (av !== bv) diffs.push([id, "nilai", av, bv]);
  if (a.note !== b.note) diffs.push([id, "catatan", a.note || "(tanpa catatan)", b.note || "(tanpa catatan)"]);
  if (b.clipped) diffs.push([id, "isi terpotong di halaman", "-", "ya"]);
}

// ------------------------------------------------------------------------------------------------ above the fold (§6.1)
const FOLD = 768;
const top = Object.entries(B.tiles).filter(([, t]) => t.grid[1] <= 3);
const foldFail = top.filter(([, t]) => t.bottom > FOLD).map(([id, t]) => `${id} berakhir di ${t.bottom}px`);

// ------------------------------------------------------------------------------------------------ DOM grep (§9.4)
const body = B.html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
const text = body.replace(/<[^>]+>/g, " ");
const grep = {
  "I_, O_, T_ (nama lembar teknis)": (text.match(/\b[IOT]_[A-Za-z_]+/g) ?? []),
  "alamat e-mail": (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []),
  "\"bersumber Ops\"": (text.match(/bersumber Ops/g) ?? []),
  "\"→\"": (text.match(/→/g) ?? []),
  "\"M \" sebagai satuan": (text.match(/\d\s?M\b(?!\w)/g) ?? []),
  "# hex inline (style=)": (body.match(/style="[^"]*#[0-9a-fA-F]{3,8}\b[^"]*"/g) ?? []),
  "fontSize inline": (body.match(/style="[^"]*font-size[^"]*"/g) ?? []),
};

// ------------------------------------------------------------------------------------------------ contrast (§5.2)
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../reference/design/tokens.css"), "utf8");
const tok = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
const pairs = [
  ["teks --text di atas --surface", tok.text, tok.surface, 4.5], ["--muted di atas --surface", tok.muted, tok.surface, 4.5],
  ["--muted di atas --bg", tok.muted, tok.bg, 4.5], ["--bad (teks) di atas --surface", tok.bad, tok.surface, 4.5],
  ["--good (teks) di atas --surface", tok.good, tok.surface, 4.5], ["--accent (teks) di atas --surface", tok.accent, tok.surface, 4.5],
  ["--accent di atas --accent-soft", tok.accent, tok["accent-soft"], 4.5],
  ["bar --chart-1 vs --surface", tok["chart-1"], tok.surface, 3], ["bar --chart-2 vs --surface", tok["chart-2"], tok.surface, 3],
  ["bar --chart-3 vs --surface", tok["chart-3"], tok.surface, 3],
].map(([l, f, g, min]) => ({ l, ratio: ratio(f, g), min }));
const contrastFail = pairs.filter((p) => p.ratio < p.min);

// ------------------------------------------------------------------------------------------------ report
const r1 = (n) => n.toFixed(2).replace(".", ",");
const md = [];
md.push(`# Banding screenshot: ${name}`, "");
md.push(`Mockup \`${mockup}\` lawan halaman \`${page}\`, viewport 1366×768. Pasangan gambar di \`img/\`.`, "");
md.push("| Mockup (1366×768) | Halaman (1366×768) |", "| --- | --- |", `| ![mockup](img/${name}-mockup-1366x768.png) | ![halaman](img/${name}-halaman-1366x768.png) |`, "");
md.push("| Mockup (penuh) | Halaman (penuh) |", "| --- | --- |", `| ![mockup](img/${name}-mockup-full.png) | ![halaman](img/${name}-halaman-full.png) |`, "");
md.push(`## Above the fold`, "", foldFail.length ? `GAGAL: ${foldFail.join("; ")}.` : `LULUS: baris 0–3 (${top.map(([id]) => id).join(", ")}) berakhir di atas ${FOLD}px (paling bawah ${Math.max(...top.map(([, t]) => t.bottom))}px), scrollY = ${B.scrollY}.`, "");
md.push(`## Grep DOM halaman`, "", "| Pola | Jumlah | Contoh |", "| --- | --- | --- |");
for (const [k, v] of Object.entries(grep)) md.push(`| ${k} | ${v.length} | ${v.length ? "`" + v[0].replace(/\|/g, "/").slice(0, 80) + "`" : ""} |`);
md.push("", `## Kontras token (§5.2)`, "", "| Pasangan | Rasio | Minimum | |", "| --- | --- | --- | --- |");
for (const p of pairs) md.push(`| ${p.l} | ${r1(p.ratio)}:1 | ${p.min}:1 | ${p.ratio >= p.min ? "lulus" : "GAGAL"} |`);
md.push("", `## Selisih per tile (${diffs.length})`, "", `Tile di mockup: ${Object.keys(A.tiles).length}; di halaman: ${Object.keys(B.tiles).length}.`, "");
if (diffs.length) { md.push("| Tile | Aspek | Mockup | Halaman |", "| --- | --- | --- | --- |"); for (const d of diffs) md.push(`| ${d.map((c) => String(c).replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`); }
else md.push("Tidak ada selisih.");
writeFileSync(join(out, `${name}-banding.md`), md.join("\n") + "\n");
writeFileSync(join(out, `${name}-banding.json`), JSON.stringify({ diffs, foldFail, grep: Object.fromEntries(Object.entries(grep).map(([k, v]) => [k, v.length])), contrastFail, tilesMockup: Object.keys(A.tiles).length, tilesPage: Object.keys(B.tiles).length }, null, 1));
console.log(`${name}: ${diffs.length} selisih, fold ${foldFail.length ? "GAGAL" : "lulus"}, grep ${Object.values(grep).reduce((a, v) => a + v.length, 0)}, kontras gagal ${contrastFail.length}`);
process.exitCode = foldFail.length || Object.values(grep).some((v) => v.length) || contrastFail.length ? 1 : 0;
