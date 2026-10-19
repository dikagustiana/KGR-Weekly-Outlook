import { addDays } from "@kgr/engine";
import { moduleEnabled } from "@/lib/modules";
import { withSources } from "@/lib/v5/management";
import { periodOf, sourcesOf } from "@/lib/v5/management-data";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage, hasHeadline } from "@/components/v4/TilePage";
import { v6PagesOn, v6ShellOn } from "@/lib/v6/flags";
import type { WeekCtx } from "@/lib/page";
import { supabaseServer } from "@/lib/supabase";
import { stockMartControl } from "@/lib/v3/stale";
import { loadPlanning } from "@/lib/v3/planning";
import { loadPpicV5 } from "@/lib/v5/ppic-data";
import { ppicV5Model } from "@/lib/v5/ppic";
import { num, tglShort } from "@/lib/fmt";
import { copyGate } from "@/lib/v5/copy-plan";
import { tileData } from "@/lib/loader";
import { setCapacityAction } from "./actions";
import { rencanaV5Extras } from "./extras";

/** PRD v5 §6.3 PPIC · Rencana (flag v5_ppic_class): demand per size → class → kg LB, weekly and daily plan per class. */
export async function RencanaV5({ ctx, versi }: { ctx: WeekCtx; versi: "need" | "batch" }) {
  const week = ctx.week.week_start;
  const sb = await supabaseServer();
  const src = await loadPlanning(sb, ctx.week);
  const c45 = await stockMartControl(sb, addDays(week, -1));
  const role = ctx.viewer.role;
  const canPlan = role === "admin" || role === "ppic";
  // PRD v5.2 R51 (K58): the copy blockers of the screen are the copyGate the action runs — one gate, v4 and v5
  const gate = await tileData("ppic: gerbang salin ke batch", () => copyGate({ sb, week: ctx.week, planId: src.plans[0] ? String(src.plans[0].id) : null, classOn: true, src, c45 }));
  const input = await loadPpicV5(sb, { src, result: ctx.computed.result, base: `/w/${week}/rencana`, versi, canPlan, c45, gate });
  const model0 = ppicV5Model(input);
  // PRD v5 K36 (flag v5_management): the source label under the main numbers, read for the week shown (R76)
  const model = (await moduleEnabled("v5_management", ctx.viewer)) ? { ...model0, tiles: withSources(model0.tiles, await sourcesOf("ppic", sb, periodOf(ctx.week.week_start, ctx.week.week_end, ctx.week.update_date))) } : model0;
  const latest = src.plans[0] ?? null;
  const extras = rencanaV5Extras({ role, week, latest, input });
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const v6 = await v6ShellOn();
  return (
    <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={ctx.week} active="rencana">
      {v6 && hasHeadline(model.tiles) ? null : <h1 className="sr-only">{model.title}</h1>}
      <TilePage tiles={model.tiles} label={model.title} extras={extras} v6={v6} plainText={v6 && (await v6PagesOn())} />
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
