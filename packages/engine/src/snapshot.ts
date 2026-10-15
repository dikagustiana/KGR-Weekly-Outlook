/**
 * Deterministic snapshot: the same inputs give byte-identical JSON (needed for golden tests and releases).
 * Decimals are written as fixed-scale strings; keys keep insertion order (which is fixed by the engine).
 */
import { Decimal, toFixedString } from "./decimal";
import type { WeekResult } from "./week";

function plain(v: unknown, dp: number): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Decimal) return toFixedString(v, dp);
  if (Array.isArray(v)) return v.map((x) => plain(x, dp));
  if (v instanceof Map) return undefined;
  if (typeof v === "function") return undefined;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = plain(x, dp);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return v;
}

export interface Snapshot {
  engineVersion: string;
  week: WeekResult["week"];
  block1: unknown;
  block2: unknown;
  block3: unknown;
  block4: unknown;
  block5: unknown;
  block6: unknown;
  block7: unknown;
  block8: unknown;
  stock: unknown;
  pnl: unknown;
  bs: unknown;
  cf: unknown;
  controls: unknown;
}

export function toSnapshot(r: WeekResult, dp = 6): Snapshot {
  return plain(
    {
      engineVersion: r.engineVersion,
      week: r.week,
      block1: r.block1,
      block2: r.block2,
      block3: r.block3,
      block4: r.block4,
      block5: r.block5,
      block6: r.block6,
      block7: r.block7,
      block8: r.block8,
      stock: r.stock.rows,
      pnl: { ranges: r.statements.pnl.ranges, lines: r.statements.pnl.lines },
      bs: { dates: r.statements.bs.dates, lines: r.statements.bs.lines, planned: r.statements.bs.planned },
      cf: r.statements.cf,
      controls: r.controls,
    },
    dp,
  ) as Snapshot;
}

export function snapshotJson(r: WeekResult): string {
  return JSON.stringify(toSnapshot(r), null, 1) + "\n";
}

/**
 * v3 (PRD v3 rule 2): module outputs go under new top-level keys appended after the v1 keys — never inside the v1
 * structure. With no v3 output the JSON is byte-identical to snapshotJson().
 */
export const V3_SNAPSHOT_KEYS = ["controls_v3", "costing", "ledger", "demand", "plan", "allocation", "monthly", "drivers", "cash", "ccc", "solvency", "commercial"] as const;
export type V3SnapshotKey = (typeof V3_SNAPSHOT_KEYS)[number];
export type V3Snapshot = Partial<Record<V3SnapshotKey, unknown>>;

export function toSnapshotV3(r: WeekResult, v3: V3Snapshot, dp = 6): Snapshot & V3Snapshot {
  const out = toSnapshot(r, dp) as Snapshot & V3Snapshot;
  for (const k of V3_SNAPSHOT_KEYS) if (v3[k] !== undefined) out[k] = plain(v3[k], dp);
  return out;
}

export function snapshotJsonV3(r: WeekResult, v3: V3Snapshot): string {
  return JSON.stringify(toSnapshotV3(r, v3), null, 1) + "\n";
}
