import Link from "next/link";
import { weekContext, type PageProps } from "@/lib/page";
import { weekInputRows } from "@/lib/week-rows";
import { supabaseServer } from "@/lib/supabase";
import { WeekShell } from "@/components/WeekShell";
import { InputTable } from "@/components/InputTable";
import { N } from "@/components/ui";
import { guardInputs, lists, readOnly } from "@/lib/inputPage";

export const dynamic = "force-dynamic";

export default async function PenerimaanPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const byId = new Map(ctx.computed.result.prepared.receipts.map((x) => [x.src.id, x]));
  const st = sp.status ?? "";
  const all = await weekInputRows(await supabaseServer(), "receipt_line", ctx.week.id);
  const rows = all.filter((x) => !st || x.status === st);
  const defaults = ctx.viewer.role === "ppic" ? { status: "Rencana", receipt_source: "Produksi RPA" } : undefined;
  return (
    <WeekShell ctx={ctx} active="input/penerimaan">
      <h1>Penerimaan barang — hasil potong RPA dan pembelian Trading</h1>
      <p className="muted">Aktual = sudah GRN di Accurate (lewat Upload). Rencana = jadwal terima (potong yang direncanakan / PO trading yang disepakati). PPIC mengisi Produksi RPA, Purchasing mengisi Beli Trading.</p>
      <div className="row noprint">
        <Link href="?" className={`b small ${st ? "sec" : ""}`}>Semua</Link>
        <Link href="?status=Rencana" className={`b small ${st === "Rencana" ? "" : "sec"}`}>Rencana</Link>
        <Link href="?status=Aktual" className={`b small ${st === "Aktual" ? "" : "sec"}`}>Aktual</Link>
      </div>
      <InputTable
        table="receipt_line" week={week} path="input/penerimaan" rows={rows} role={ctx.viewer.role} editId={sp.edit} {...lists(ctx)}
        msg={{ ok: sp.ok, err: sp.err }} readOnly={readOnly(ctx)} defaults={defaults}
        computedHead={["Key dipakai", "Nilai Rp", "Segmen", "Dihitung"]}
        computed={(row) => {
          const x = byId.get(String(row.id));
          if (!x) return ["", "", "", ""];
          return [<span key="k" className={x.key === "KODE BARU" ? "warn" : ""}>{x.key}</span>, <N key="v" v={x.value} tip="kg × Rp/kg" />, x.segment, x.counted ? "1" : "0"];
        }}
      />
    </WeekShell>
  );
}
