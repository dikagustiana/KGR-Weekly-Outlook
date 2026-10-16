import { addDays } from "@kgr/engine";
import { moduleEnabled } from "@/lib/modules";
import { withSources } from "@/lib/v5/management";
import { loadSources, sourcesFor } from "@/lib/v5/management-data";
import { jakartaNow } from "@/lib/v3/allocation";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage } from "@/components/v4/TilePage";
import type { WeekCtx } from "@/lib/page";
import { supabaseServer } from "@/lib/supabase";
import { stockMartControl } from "@/lib/v3/stale";
import { loadPlanning } from "@/lib/v3/planning";
import { loadPpicV5 } from "@/lib/v5/ppic-data";
import { ppicV5Model } from "@/lib/v5/ppic";
import { num, tglShort } from "@/lib/fmt";
import { copyClassPlanAction, saveClassPlanAction, setCapacityAction } from "./actions";
import type { ReactNode } from "react";

const nowWib = () => { const n = jakartaNow(); return `${n.date}T${n.time}:00+07:00`; };

/** PRD v5 §6.3 PPIC · Rencana (flag v5_ppic_class): demand per size → class → kg LB, weekly and daily plan per class. */
export async function RencanaV5({ ctx, versi }: { ctx: WeekCtx; versi: "need" | "batch" }) {
  const week = ctx.week.week_start;
  const sb = await supabaseServer();
  const src = await loadPlanning(sb, ctx.week);
  const c45 = await stockMartControl(sb, addDays(week, -1));
  const role = ctx.viewer.role;
  const canPlan = role === "admin" || role === "ppic";
  const input = await loadPpicV5(sb, { src, result: ctx.computed.result, base: `/w/${week}/rencana`, versi, canPlan, c45 });
  const model0 = ppicV5Model(input);
  // PRD v5 K36 (flag v5_management): the source label under the main numbers
  const model = (await moduleEnabled("v5_management", ctx.viewer)) ? { ...model0, tiles: withSources(model0.tiles, sourcesFor("ppic", await loadSources(sb, nowWib()))) } : model0;
  const latest = src.plans[0] ?? null;
  const bar = (children: ReactNode, reason: string | null) => <div className="actionbar">{children}{reason ? <span className="reason">{reason}</span> : null}</div>;
  const extras: Record<string, ReactNode> = {};
  if (canPlan) {
    const c42 = input.controls.find((c) => c.code === "C42")?.status;
    extras["t-mingguan"] = bar(
      <ActionForm v4="primary" action={saveClassPlanAction} submit={`Simpan rencana versi ${(latest ? Number(latest.version) : 0) + 1}`} disabled={input.saveBlockers.length > 0}>
        <input type="hidden" name="week" value={week} />
      </ActionForm>,
      input.saveBlockers.length ? `Belum bisa disimpan: ${input.saveBlockers.join(", ")}` : c42 && c42 !== "LULUS" ? "yield sementara: boleh disimpan, tidak boleh disalin ke batch" : null,
    );
    extras["t-harian"] = bar(
      <ActionForm v4 action={copyClassPlanAction} submit="Salin ke batch rencana" disabled={!latest || input.copyBlockers.length > 0} confirm="Batch rencana minggu ini (salinan sebelumnya) diganti. Lanjut?">
        <input type="hidden" name="week" value={week} /><input type="hidden" name="plan_id" value={latest ? String(latest.id) : ""} />
      </ActionForm>,
      !latest ? "Simpan rencana dulu" : input.copyBlockers.length ? `Belum bisa: ${input.copyBlockers.join(", ")}` : null,
    );
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
