import "server-only";
/**
 * Everything the v3 modules add to one week: their controls (C21–C40) and their snapshot keys. Only modules whose
 * flag is on contribute — with every flag off the weekly snapshot and release are exactly v1.
 */
import type { ControlV3, V3Snapshot } from "@kgr/engine";
import type { Supa } from "../supabase";
import type { WeekRow } from "../data";
import type { ModuleSettings } from "../modules-core";
import { groupsOfWeek, loadCostingWeek, weekCostingControls } from "./costing";

export interface WeekV3 {
  controls: ControlV3[];
  snapshot: V3Snapshot;
}

export async function v3ForWeek(sb: Supa, week: WeekRow, settings: ModuleSettings): Promise<WeekV3> {
  const controls: ControlV3[] = [];
  const snapshot: V3Snapshot = {};
  if (settings.m1_costing?.enabled) {
    const d = await loadCostingWeek(sb, week);
    const c = weekCostingControls(d);
    controls.push(...c);
    snapshot.costing = {
      batches: [...d.latestRun.values()].map((r) => ({
        batch_ref: d.batches.find((b) => b.id === r.batch_id)?.batch_ref ?? r.batch_id, mode: r.mode, status: r.status,
        total_cost: r.total_cost, total_allocated: r.total_allocated, diff: r.diff,
      })).sort((a, b) => String(a.batch_ref).localeCompare(String(b.batch_ref))),
      groups: groupsOfWeek(d),
    };
  }
  if (controls.length) snapshot.controls_v3 = controls;
  return { controls, snapshot };
}
