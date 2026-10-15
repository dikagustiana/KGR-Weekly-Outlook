import Link from "next/link";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { InputTable, markDelivered } from "@/components/InputTable";
import { N } from "@/components/ui";
import { guardInputs, lists, readOnly } from "@/lib/inputPage";
import { canWriteRow, TABLES } from "@/lib/tables";
import { moduleEnabled } from "@/lib/modules";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function PenjualanPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const r = ctx.computed.result;
  const byId = new Map(r.sales.map((s) => [s.src.id, s]));
  const st = sp.status ?? "";
  const rows = ctx.computed.loaded.db.sales.filter((x) => !st || x.status === st);
  const today = r.week.today;
  // M3 (PRD v3 §4.1): PO columns shown when the module is on; they are written by the "PO lines" upload
  const m3 = await moduleEnabled("m3_planning", ctx.viewer);
  return (
    <WeekShell ctx={ctx} active="input/penjualan">
      <h1>Penjualan — aktual (Accurate) dan order (sales)</h1>
      <p className="muted">Aktual = sudah dikirim/diinvoice. Order = order pelanggan yang belum dikirim (tanggal kirim rencana). Order yang lewat tanggal dan belum dikirim tidak dihitung (kontrol 7). Penjualan aktual masuk lewat Upload (Accurate / surat jalan).</p>
      <div className="row noprint">
        <Link href="?" className={`b small ${st ? "sec" : ""}`}>Semua ({ctx.computed.loaded.db.sales.length})</Link>
        <Link href="?status=Order" className={`b small ${st === "Order" ? "" : "sec"}`}>Order</Link>
        <Link href="?status=Aktual" className={`b small ${st === "Aktual" ? "" : "sec"}`}>Aktual</Link>
        <Link href={`/w/${week}/upload`}>Upload Sales by Item Detail / surat jalan →</Link>
      </div>
      <InputTable
        table="sales_line" week={week} path="input/penjualan" rows={rows} role={ctx.viewer.role} editId={sp.edit} {...lists(ctx)}
        msg={{ ok: sp.ok, err: sp.err }} readOnly={readOnly(ctx)}
        computedHead={[...(m3 ? ["Tgl kirim", "Status demand", "Sales"] : []), "Key dipakai", "Nilai Rp", "HPP dipakai Rp", "GP Rp", "Segmen", "Dihitung"]}
        computed={(row) => {
          const s = byId.get(String(row.id));
          const po = m3 ? [row.delivery_date ? tgl(String(row.delivery_date)) : "", String(row.demand_status ?? ""), String(row.sales_rep ?? "")] : [];
          if (!s) return [...po, "", "", "", "", "", ""];
          return [...po,
            <span key="k" className={s.key === "KODE BARU" ? "warn" : ""}>{s.key}</span>,
            <N key="v" v={s.value} tip="kg × harga" />,
            <N key="h" v={s.hpp} tip={s.hppActual ? "HPP aktual Accurate (DO)" : "kg × biaya rata-rata stok minggu ini"} />,
            <N key="g" v={s.gp} tip="nilai − HPP" />,
            s.segment,
            s.counted ? "1" : <span key="c" className={s.status === "Order" && s.date && s.date < today ? "warn" : "muted"}>0</span>,
          ];
        }}
        extraActions={(row) => row.status === "Order" && canWriteRow(ctx.viewer.role, TABLES.sales_line, { ...row, status: "Aktual" }) ? (
          <form action={markDelivered}>
            <input type="hidden" name="week" value={week} /><input type="hidden" name="id" value={String(row.id)} />
            <button className="b sec small" title="Order sudah dikirim → Aktual">Terkirim</button>
          </form>
        ) : null}
      />
    </WeekShell>
  );
}
