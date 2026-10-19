/**
 * Backtest COGS LB Aug–Sep 2026 with the real workbooks (docs/v5.3/backtest-cogs/REPORT.md): the costing_wp parser reads
 * every Pot_* sheet into exactly the inputs stored in fixtures/backtest-cogs-2026-08-09/expected.json. Runs only where the
 * owner's files are present (BACKTEST_DIR, default /home/user/backtest-data) with the sha256 recorded in the fixture; they
 * are never in the repo, so CI skips it and packages/engine/test/backtest-cogs.test.ts carries the numbers.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { D, costComponentOf } from "@kgr/engine";
import { loadV3Fixture } from "@kgr/engine/fixtures";
import { parseCostingWorkbook, parseWpSheet, readWorkbook } from "../src";

interface FxBatch { month: string; sheet: string; hidden: boolean; inputs: { date: string | null; lb_kg: string | null; processed_kg: string | null; cost: { LB: string; freight: string; maklon: string; bl: string | null }; rows: { row: number; item_code: string | null; kg: string; price: string | null }[] } }
const fx = loadV3Fixture<{ sources: { file: string; sha256: string }[]; batches: FxBatch[] }>("backtest-cogs-2026-08-09", "expected.json");
const dir = process.env.BACKTEST_DIR ?? "/home/user/backtest-data";
const present = fx.sources.every((s) => existsSync(join(dir, s.file)) && createHash("sha256").update(readFileSync(join(dir, s.file))).digest("hex") === s.sha256);
if (!present) console.info(`backtest-cogs: dilewati — berkas WP COGS LB dengan sha256 fixture tidak ada di ${dir} (berkas asli tidak di repo; set BACKTEST_DIR)`);

describe.skipIf(!present)("backtest COGS LB: parser costing_wp vs fixture (berkas asli)", () => {
  for (const src of fx.sources) {
    it(`${src.file}: every Pot_* batch sheet parses to the fixture inputs`, () => {
      const sheets = readWorkbook(readFileSync(join(dir, src.file)), src.file);
      const res = parseCostingWorkbook(sheets);
      const m = src.file.startsWith("202608") ? "2026-08" : "2026-09";
      const month = fx.batches.filter((b) => b.month === m);
      expect(res.hidden.sort()).toEqual(month.filter((b) => b.hidden).map((b) => b.sheet).sort());
      for (const f of month) {
        const b = f.hidden ? parseWpSheet(sheets.find((s) => s.name === f.sheet)!)! : res.batches.find((x) => x.sheet === f.sheet)!;
        expect(b, f.sheet).toBeTruthy();
        const comp = (k: string) => b.costs.filter((c) => costComponentOf(c.label) === k).reduce((a, c) => a.plus(D(c.amount)), D(0)).toString();
        expect([b.date, b.lb_kg, b.processed_kg, comp("LB"), comp("freight"), comp("maklon"), b.cost_bl], f.sheet)
          .toEqual([f.inputs.date, f.inputs.lb_kg, f.inputs.processed_kg, f.inputs.cost.LB, f.inputs.cost.freight, f.inputs.cost.maklon, f.inputs.cost.bl]);
        expect(b.rows.map((r) => [r.row, r.item_code, D(r.kg_non_blasting).plus(D(r.kg)).toString(), r.price]), f.sheet)
          .toEqual(f.inputs.rows.map((r) => [r.row, r.item_code, r.kg, r.price]));
      }
    });
  }
});
