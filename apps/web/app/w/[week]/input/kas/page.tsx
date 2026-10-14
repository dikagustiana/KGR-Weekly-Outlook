import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { InputTable } from "@/components/InputTable";
import { guardInputs, lists, readOnly } from "@/lib/inputPage";

export const dynamic = "force-dynamic";

export default async function KasPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const byId = new Map(ctx.computed.result.prepared.cashPlan.map((x) => [x.src.id, x]));
  return (
    <WeekShell ctx={ctx} active="input/kas">
      <h1>Rencana kas — penerimaan dan pembayaran di luar model</h1>
      <p className="muted">Penagihan pelanggan, gaji, pajak, bunga, pinjaman, utang lama. Pembayaran live bird, pembelian trading, angkut dan maklon untuk rencana minggu ini sudah dihitung dari Batch / Penerimaan sesuai termin — jangan diinput lagi di sini. Pos neraca lawan wajib (kontrol 18).</p>
      <InputTable
        table="cash_plan" week={week} path="input/kas" rows={ctx.computed.loaded.db.cashPlan} role={ctx.viewer.role} editId={sp.edit} {...lists(ctx)}
        msg={{ ok: sp.ok, err: sp.err }} readOnly={readOnly(ctx)}
        computedHead={["Dihitung"]}
        computed={(row) => [byId.get(String(row.id))?.counted ? "1" : "0"]}
      />
    </WeekShell>
  );
}
