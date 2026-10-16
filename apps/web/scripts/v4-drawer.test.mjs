// Keyboard check of the "cara hitung" drawer (PRD v4 §5.3, §9.1 G7): opens with Enter or Space from the tile button,
// Esc closes it, focus returns to the button. Bundles components/v4/CaraHitung.tsx with esbuild and runs it in Chromium.
//   node apps/web/scripts/v4-drawer.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../package.json"));
const esbuild = require(require.resolve("esbuild", { paths: [here, join(here, "../../../node_modules/.pnpm/node_modules")] }));
let chromium;
for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { ({ chromium } = require(p)); break; } catch { /* next */ } }

const tmp = mkdtempSync(join(tmpdir(), "drawer-"));
writeFileSync(join(tmp, "entry.tsx"), `
import { createRoot } from "react-dom/client";
import { CaraHitung } from ${JSON.stringify(resolve(here, "../components/v4/CaraHitung.tsx"))};
createRoot(document.getElementById("root")!).render(<CaraHitung content={{ title: "Outlook minggu", fn: "weekOutlook", rule: "Revenue dan GP P&L", sources: [{ label: "Tabel", value: "pl_daily_v4" }] }} />);
`);
await esbuild.build({ entryPoints: [join(tmp, "entry.tsx")], bundle: true, outfile: join(tmp, "out.js"), jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, nodePaths: [join(here, "../node_modules")], logLevel: "error" });
writeFileSync(join(tmp, "index.html"), `<!doctype html><meta charset="utf-8"><style>${readFileSync(join(here, "../app/v4.css"), "utf8")}</style><div class="v4"><div id="root"></div></div><script src="out.js"></script>`);

const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe });
const pg = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await pg.goto("file://" + join(tmp, "index.html"));
const results = [];
const ok = (name, cond) => { results.push([name, !!cond]); };
const dlg = () => pg.locator('[role="dialog"]').count();
await pg.keyboard.press("Tab");
ok("tombol dapat dijangkau dengan Tab", await pg.evaluate(() => document.activeElement?.textContent === "cara hitung"));
await pg.keyboard.press("Enter");
ok("Enter membuka drawer", (await dlg()) === 1);
ok("fokus pindah ke drawer", await pg.evaluate(() => document.activeElement?.getAttribute("role") === "dialog"));
ok("drawer memuat aturan, fungsi, sumber", await pg.evaluate(() => { const t = document.querySelector('[role="dialog"]').textContent; return t.includes("Revenue dan GP P&L") && t.includes("weekOutlook") && t.includes("pl_daily_v4"); }));
await pg.keyboard.press("Escape");
ok("Esc menutup drawer", (await dlg()) === 0);
ok("fokus kembali ke tombol", await pg.evaluate(() => document.activeElement?.textContent === "cara hitung"));
await pg.keyboard.press("Space");
ok("Spasi membuka drawer", (await dlg()) === 1);
await pg.locator("text=Tutup").click();
ok("tombol Tutup menutup drawer", (await dlg()) === 0);
await browser.close();
for (const [n, c] of results) console.log(`${c ? "LULUS" : "GAGAL"}  ${n}`);
process.exitCode = results.every(([, c]) => c) ? 0 : 1;
