import { addDays, stepGates } from "@kgr/engine";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage } from "@/components/v4/TilePage";
import type { WeekCtx } from "@/lib/page";
import { supabaseServer } from "@/lib/supabase";
import { fetchAll } from "@/lib/data";
import { stockMartControl } from "@/lib/v3/stale";
import { loadPlanning, ppicBlockers, ppicWeekControls, proposePlan, unitBuyPrice } from "@/lib/v3/planning";
import { rencanaModel } from "@/lib/v4/rencana";
import { moduleEnabled } from "@/lib/modules";
import { num, tglShort } from "@/lib/fmt";
import { approvePlanAction, copyPlanAction, reasonAction, savePlanAction, setCapacityAction } from "./actions";
import type { ReactNode } from "react";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** PRD v4 §6.4 PPIC · Rencana (flag v4_design): steps 1–4 as tile groups; actions beside the tile they belong to. */
export async function RencanaV4({ ctx, kelas }: { ctx: WeekCtx; kelas: string | null }) {
  const week = ctx.week.week_start;
  const sb = await supabaseServer();
  const src = await loadPlanning(sb, ctx.week);
  const c45 = await stockMartControl(sb, addDays(week, -1));
  const p = proposePlan(src, { classCode: kelas });
  const controls = [...ppicWeekControls(src, p, ctx.week.update_date), c45];
  const gates = stepGates(controls, src.reasons.map((r) => r.code));
  const latest = (src.plans[0] ?? null) as Row | null;
  const variance = await fetchAll<Row>((a, b) => sb.from("plan_variance_daily").select("*").gte("date", week).lte("date", addDays(week, 6)).order("date").order("key").range(a, b));
  const lb = new Map<string, number>();
  for (const r of src.lbSupply.filter((x) => x.status === "confirmed" || x.status === "received")) lb.set(String(r.date), (lb.get(String(r.date)) ?? 0) + Number(r.head_count ?? 0));
  const bl = (a: "save" | "approve" | "copy") => ppicBlockers(controls, a).map((b) => `${b.code} ${b.status}`);
  const role = ctx.viewer.role;
  const canPlan = role === "admin" || role === "ppic", canApprove = role === "admin" || role === "finance";
  const model = rencanaModel({
    week: { start: week, update: ctx.week.update_date }, demand: p.demand, proposal: p.proposal, days: p.days, cls: p.cls, supplyHeads: p.supplyHeads,
    saved: latest ? {
      id: String(latest.id), version: Number(latest.version), head_count: Number(latest.head_count), yield_provisional: latest.yield_provisional === true,
      needs_approval: latest.needs_approval === true, approved: !!latest.approved_by, copied: !!latest.copied_to_batch_at,
      output: (latest.output_kg_by_key ?? {}) as Record<string, string>, surplus: (latest.surplus_kg_by_key ?? {}) as Record<string, string>, rp_downgrade: String(latest.frozen_planned_rp_downgrade ?? 0),
    } : null,
    savedDays: src.planDays.map((d) => ({ date: String(d.date), head_count: Number(d.head_count ?? 0), weight_class: s(d.weight_class), cut_pattern: s(d.cut_pattern), supplier: s(d.supplier), target_kg_by_key: (d.target_kg_by_key ?? {}) as Record<string, string>, limited_by: s(d.limited_by) })),
    capacity: (d) => src.capacity.get(d)?.cut_capacity_head ?? null, lbSupply: (d) => lb.get(d) ?? null,
    controls, gates, reasons: src.reasons, block2: ctx.computed.result.block2, k25: await moduleEnabled("v5_costing", ctx.viewer),
    variance: variance.map((v) => ({ date: String(v.date), key: String(v.key), planned_kg: s(v.planned_kg), actual_kg: s(v.actual_kg), variance_kg: s(v.variance_kg), planned_heads: v.planned_heads === null ? null : Number(v.planned_heads), actual_heads: v.actual_heads === null ? null : Number(v.actual_heads) })),
    blockers: { save: bl("save"), approve: bl("approve"), copy: bl("copy") }, alokasiHref: `/hari/${ctx.week.update_date}/alokasi`, buyPrice: (u) => unitBuyPrice(src, u),
  });
  const reasonOf = (tile: string, action: string) => model.actions.find((a) => a.tile === tile && a.action === action)?.disabledReason ?? null;
  const has = (tile: string, action: string) => model.actions.some((a) => a.tile === tile && a.action === action);
  const bar = (children: ReactNode, reason: string | null) => <div className="actionbar">{children}{reason ? <span className="reason">{reason}</span> : null}</div>;
  const extras: Record<string, ReactNode> = {};
  if (canPlan && has("t-demand", "reason")) {
    extras["t-demand"] = bar(<ActionForm v4 action={reasonAction} submit="Simpan alasan C41"><input type="hidden" name="week" value={week} /><input type="hidden" name="code" value="C41" /><input name="reason" size={40} placeholder="mis. kekurangan dibeli trading dari pemasok X" aria-label="alasan C41" /></ActionForm>, null);
  }
  if (canPlan || canApprove) {
    extras["t-rencana"] = bar(<>
      {canPlan ? <ActionForm v4="primary" action={savePlanAction} submit={`Simpan rencana versi ${(latest ? Number(latest.version) : 0) + 1}`} disabled={reasonOf("t-rencana", "save") !== null}>
        <input type="hidden" name="week" value={week} /><input type="hidden" name="weight_class" value={p.cls?.code ?? ""} />
        <input name="supply_heads" size={8} placeholder={`supply ${p.supplyHeads}`} aria-label="supply komitmen ekor" />
      </ActionForm> : null}
      {canApprove && has("t-rencana", "approve") && latest ? <ActionForm v4 action={approvePlanAction} submit="Setujui downgrade" disabled={reasonOf("t-rencana", "approve") !== null} confirm="Setujui rencana dengan downgrade di atas batas?"><input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={String(latest.id)} /></ActionForm> : null}
    </>, reasonOf("t-rencana", "save") ?? (controls.find((c) => c.code === "C42")?.status !== "LULUS" ? "yield sementara: boleh disimpan, tidak boleh disalin ke batch" : null));
  }
  if (canPlan) {
    extras["t-harian"] = bar(<ActionForm v4 action={copyPlanAction} submit="Salin ke batch rencana" disabled={reasonOf("t-harian", "copy") !== null} confirm="Batch rencana minggu ini (salinan sebelumnya) diganti. Lanjut?"><input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={latest ? String(latest.id) : ""} /></ActionForm>, reasonOf("t-harian", "copy"));
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return (
    <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={ctx.week} active="rencana">
      <h1 className="sr-only">{model.title}</h1>
      <TilePage tiles={model.tiles} label={model.title} extras={extras} />
      {canPlan ? (
        <section className="fin" aria-label="Kapasitas">
          <h2>Kapasitas potong minggu ini (ekor per hari)</h2>
          <ActionForm v4 action={setCapacityAction} submit="Simpan kapasitas">
            <input type="hidden" name="week" value={week} />
            {days.map((d) => <label key={d}>{tglShort(d)} <input name={`head_${d}`} size={6} defaultValue={src.capacity.get(d)?.cut_capacity_head === null || src.capacity.get(d)?.cut_capacity_head === undefined ? "" : num(src.capacity.get(d)!.cut_capacity_head!, 0)} placeholder="belum diisi" /></label>)}
          </ActionForm>
        </section>
      ) : null}
    </Shell>
  );
}
