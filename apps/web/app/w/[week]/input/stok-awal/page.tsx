import { weekContext, type PageProps } from "@/lib/page";
import { weekInputRows } from "@/lib/week-rows";
import { supabaseServer } from "@/lib/supabase";
import { WeekShell } from "@/components/WeekShell";
import { InputTable } from "@/components/InputTable";
import { Msg } from "@/components/ui";
import { guardInputs, lists, readOnly } from "@/lib/inputPage";
import { num } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function StokAwalPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const byId = new Map(ctx.computed.result.prepared.opening.map((x) => [x.src.id, x]));
  const rows = await weekInputRows(await supabaseServer(), "opening_stock", ctx.week.id);
  const total = ctx.computed.result.controls.controls.find((c) => c.no === 9)!;
  return (
    <WeekShell ctx={ctx} active="input/stok-awal">
      <h1>Stok awal minggu (Senin pagi) — dari Inventory Valuation Accurate per item</h1>
      <p className="muted">Umur = rata-rata umur kg yang tersisa (FIFO dari tanggal terima). Diisi ulang setiap Senin lewat Upload (Inventory Valuation saldo / ledger, atau stock count EOD bila valuation terlambat).</p>
      {ctx.week.opening_stock_flag ? <Msg kind="err">{ctx.week.opening_stock_flag}</Msg> : null}
      <p>Total nilai stok awal: <b>Rp {num(total.value)}</b> · pembanding Accurate (kontrol 9): {total.comparator === null ? "belum diisi (Parameter)" : `Rp ${num(total.comparator)}`}</p>
      <InputTable
        table="opening_stock" week={week} path="input/stok-awal" rows={rows} role={ctx.viewer.role} editId={sp.edit} {...lists(ctx)}
        msg={{ ok: sp.ok, err: sp.err }} readOnly={readOnly(ctx)}
        computedHead={["Key"]}
        computed={(row) => {
          const k = byId.get(String(row.id))?.key ?? "";
          return [<span key="k" className={k === "KODE BARU" ? "warn" : ""}>{k}</span>];
        }}
      />
    </WeekShell>
  );
}
