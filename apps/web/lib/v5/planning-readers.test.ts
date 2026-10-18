/**
 * PRD v5.2-A irisan A1c, Q-v5.2-15: the register of every place in apps/web that reads PPIC's plan or demand tables
 * (plan_week, plan_week_class, plan_day, demand_weekly, demand_class_weekly) or calls a loader that does. For each: who runs it,
 * and why that is never a Sales session (or what Sales get instead). The test finds the places by scanning the source and fails
 * when a file reads these tables and is not in the register — a new reader has to say who runs it before it can be merged.
 * What each entry claims is proved in sales-plan-reads.test.tsx (the Sales paths) and in the page / action role lists named here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/** Files that read the tables or call the loaders, with who runs them and what Sales get. */
const REGISTER: Record<string, string> = {
  "app/komersial/actions-v5.ts": "answerSurplusAction: Admin and the lead read plan_week; Sales read the view surplus_for_sales_v52 (surplusOfSales)",
  "app/w/[week]/rencana/actions.ts": "PPIC actions (roles admin, ppic; approve: admin, finance): writes plan_week, plan_week_class; Sales are refused by requireModuleAction",
  "app/w/[week]/rencana/page.tsx": "page roles admin, ppic, finance (+ management readers when v5_management): Sales get a 404",
  "app/w/[week]/rencana/v4.tsx": "rendered by rencana/page.tsx only",
  "app/w/[week]/rencana/v5.tsx": "rendered by rencana/page.tsx only",
  "app/w/[week]/demand/page.tsx": "Sales get the notice 'tidak ditampilkan untuk Sales' before anything is read; the other readers read as before",
  "app/w/[week]/kontrol/page.tsx": "v3ForWeek with the viewer's role: for Sales the planning block is left out",
  "app/api/w/[week]/snapshot.json/route.ts": "v3ForWeek with the viewer's role: for Sales the snapshot has no demand and no plan",
  "app/w/[week]/outlook/page.tsx": "managementV3 with the viewer's role: for Sales (management preview) the demand card says 'tidak ditampilkan untuk Sales'",
  "lib/release.ts": "release by Admin or Finance (can(role, 'release')): v3ForWeek without a role = the whole snapshot",
  "lib/v3/week.ts": "v3ForWeek(…, role): role 'sales' skips the planning block",
  "lib/v3/management.ts": "managementV3(…, role): role 'sales' sets demandHidden and reads neither demand_weekly nor plan_week",
  "lib/v3/planning.ts": "the loaders themselves (loadPlanning, demandWeekly, savePlan, approvePlan) and the demand builder (service client); callers are in this register",
  "lib/v4/minggu-ini-data.ts": "Minggu ini: roles admin, management, operations_director, finance (MINGGU_INI_ROLES); others get a 404",
  "lib/v5/copy-plan.ts": "Salin ke batch: PPIC actions (admin, ppic) and the Rencana pages; not reachable by Sales",
  "lib/v5/input-data.ts": "demand_class_weekly only for a viewer who is not Sales (the card says 'tidak ditampilkan'); the plan_week task fact is the builder (service client)",
  "lib/v5/komersial-data.ts": "loadPlanning / loadPpicV5 only when the viewer is not Sales (ppic: sales ? null); Sales get loadSurplusForSales",
  "lib/v5/management-data.ts": "Minggu ini / Manajemen (MINGGU_INI_ROLES): not Sales",
  "lib/v5/ppic-data.ts": "loadPpicV5 for the Rencana page, Minggu ini and the Commercial screen of a non-Sales viewer; the demand_class_weekly builder runs with the service client",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === ".next") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.|test-support/.test(p) ? [p] : [];
  });
}

const TABLE = /\.from\(\s*"(plan_week|plan_week_class|plan_day|demand_weekly|demand_class_weekly)"\s*\)/;
const LOADER = /\b(loadPlanning|demandWeekly|loadPpicV5|managementV3|v3ForWeek|loadManagementV5)\(/;

describe("Q-v5.2-15: every reader of the planning tables is registered, with who runs it", () => {
  const found = ["app", "lib", "components"].flatMap((d) => files(join(ROOT, d))).map((p) => ({ file: relative(ROOT, p).split("\\").join("/"), text: readFileSync(p, "utf8") }))
    .filter((f) => TABLE.test(f.text) || LOADER.test(f.text)).map((f) => f.file).sort();

  it("the files that read plan_week, plan_week_class, plan_day, demand_weekly, demand_class_weekly or call their loaders are exactly the register", () => {
    expect(found).toEqual(Object.keys(REGISTER).sort());
  });
  it("every entry says who runs it and what Sales get (no entry without a reason)", () => {
    for (const [file, why] of Object.entries(REGISTER)) expect(why.length, file).toBeGreaterThan(20);
  });
});
