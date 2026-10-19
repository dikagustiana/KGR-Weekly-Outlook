/**
 * PRD v6 irisan 4 evidence harness (not part of `pnpm test`: `npx vitest run -c scripts/vitest.harness.config.ts`).
 * Renders Minggu ini (fixture week 2026-08-24) inside the v6 shell to a static HTML file with the app's stylesheets, for
 * screenshots and axe-core in Chromium (docs/v6/irisan-4.md). Client components render their first frame.
 */
import { it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/minggu-ini/2026-08-24", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/view/actions", () => ({ setViewMode: async () => undefined }));

it("v6 harness", async () => {
  const { fixtureInput } = await import("../test-support/minggu-ini-fixture");
  const { mingguIniModel } = await import("../lib/v4/minggu-ini");
  const { TilePage } = await import("../components/v4/TilePage");
  const { Shell6 } = await import("../components/v6/Shell");
  const { v4Nav } = await import("../lib/v4/nav");
  const { base } = fixtureInput();
  const model = mingguIniModel(base);
  const settings = Object.fromEntries(["v4_design", "m1_costing", "m2_ledger", "m3_planning", "m4_monthly", "m6_cash", "m7_commercial", "v5_input", "v5_management"].map((k) => [k, { enabled: true }]));
  const tabs = v4Nav("management", settings as never, { week: "2026-08-24", month: "2026-08", today: "2026-08-27" });
  const weeks = [{ id: "w2", week_start: "2026-08-31", week_end: "2026-09-06", status: "open", update_date: "2026-08-31" }, { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", status: "released", update_date: "2026-08-27" }] as never[];
  const html = renderToStaticMarkup(
    <Shell6 viewer={{ email: "lenny@x.id", role: "management", fullName: "Bu Lenny" }} weeks={weeks} week={weeks[1]} tabs={tabs} active="minggu-ini" view="management"
      viewAs={[]} viewAsActive={null} release={{ date: "28 Agu 2026", passed: 19, total: 20, pdfHref: "#" }} canToggle={false} longDates>
      <TilePage tiles={model.tiles} label="Minggu ini" v6 />
    </Shell6>,
  );
  const css = ["globals.css", "v4.css", "v6.css"].map((f) => readFileSync(join(__dirname, "../app", f), "utf8")).join("\n");
  const out = process.env.V6_HARNESS_OUT ?? join(__dirname, "../../../tests/e2e/out/v6");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "minggu-ini-v6.html"), `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minggu ini</title><style>${css}</style></head><body>${html}</body></html>`);
});
