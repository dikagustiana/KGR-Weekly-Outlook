/** Load a week's JSON fixtures (fixtures/week-YYYY-MM-DD/*.json) into engine inputs. Node only — not part of the pure engine. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WeekInputs } from "./types";

export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

export function fixtureDir(weekStart: string): string {
  return join(repoRoot(), "fixtures", `week-${weekStart}`);
}

function read<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

export function loadFixtureWeek(weekStart: string, today?: string): WeekInputs {
  const dir = fixtureDir(weekStart);
  if (!existsSync(dir)) throw new Error(`Fixture minggu ${weekStart} tidak ada: ${dir}`);
  const week = read<{ week_start: string; update_date: string; tb_opening_date: string }>(dir, "week.json");
  return {
    week: { week_start: week.week_start, update_date: today ?? week.update_date, tb_opening_date: week.tb_opening_date },
    parameters: read(dir, "parameters.json"),
    sku_keys: read(dir, "sku_keys.json"),
    item_map: read(dir, "item_map.json"),
    coa_map: read(dir, "coa_map.json"),
    opening_stock: read(dir, "opening_stock.json"),
    sales_lines: read(dir, "sales_lines.json"),
    receipt_lines: read(dir, "receipt_lines.json"),
    batches: read(dir, "batches.json"),
    gl_lines: read(dir, "gl_lines.json"),
    tb_opening: read(dir, "tb_opening.json"),
    runrate: read(dir, "runrate.json"),
    cash_plan: read(dir, "cash_plan.json"),
  };
}

export function loadGolden(weekStart: string): Record<string, string | null> {
  return read(fixtureDir(weekStart), "golden.json");
}

/** v3 fixtures (fixtures/<name>/<file>.json, written by scripts/extract_fixtures.py). Node only. */
export function loadV3Fixture<T = unknown>(name: string, file: string): T {
  const dir = join(repoRoot(), "fixtures", name);
  if (!existsSync(join(dir, file))) throw new Error(`Fixture ${name}/${file} tidak ada — jalankan: python3 -I scripts/extract_fixtures.py`);
  return read<T>(dir, file);
}
