import Link from "next/link";
import { weekContext, type PageProps } from "@/lib/page";
import { weekInputRows } from "@/lib/week-rows";
import { supabaseServer } from "@/lib/supabase";
import { WeekShell } from "@/components/WeekShell";
import { InputTable } from "@/components/InputTable";
import { N } from "@/components/ui";
import { guardInputs, lists, readOnly } from "@/lib/inputPage";

export const dynamic = "force-dynamic";

export default async function BatchInputPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const rows = await weekInputRows(await supabaseServer(), "batch", ctx.week.id);
  const byId = new Map(ctx.computed.result.prepared.batches.map((x) => [x.src.id, x]));
  return (
    <WeekShell ctx={ctx} active="input/batch">
      <h1>Batch potong RPA — aktual dan rencana</h1>
      <p className="muted">Aktual dari batch costing / data ops (kg LB = timbangan ops). Rencana = potong yang dijadwalkan (kg LB, harga penawaran, output perkiraan — boleh dari yield parameter). Upload batch costing ops lewat menu Upload. <Link href={`/w/${week}/batch`}>Lihat KPI batch →</Link></p>
      <InputTable
        table="batch" week={week} path="input/batch" rows={rows} role={ctx.viewer.role} editId={sp.edit} {...lists(ctx)}
        msg={{ ok: sp.ok, err: sp.err }} readOnly={readOnly(ctx)}
        computedHead={["Nilai LB Rp", "Total biaya Rp", "Shrink", "Output kg", "Margin Rp"]}
        computed={(row) => {
          const b = byId.get(String(row.id));
          if (!b) return ["", "", "", "", ""];
          return [<N key="1" v={b.lbValue} />, <N key="2" v={b.totalCost} />, <N key="3" v={b.shrink} percent />, <N key="4" v={b.outputKg} dp={1} />, <N key="5" v={b.margin} />];
        }}
      />
    </WeekShell>
  );
}
