import Link from "next/link";
import { redirect } from "next/navigation";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Badge, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { tgl } from "@/lib/fmt";
import { createEmptyWeek, loadExampleWeek, rollover, setWeekStatus } from "./actions";

export const dynamic = "force-dynamic";

export default async function WeeksAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  if (viewer.role !== "admin") redirect("/");
  const latest = weeks[0];
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="admin/minggu">
      <h1>Minggu</h1>
      <p className="muted">Satu minggu = Senin–Minggu. Setiap minggu disimpan (riwayat, tidak ditimpa). Minggu yang ditutup hanya bisa diubah Admin.</p>
      <div className="grid2">
        <Card title="Rollover Senin — buat minggu berikutnya">
          {latest ? (
            <>
              <p>Dari minggu terakhir <b>{tgl(latest.week_start)} – {tgl(latest.week_end)}</b>: parameter, harga, run-rate (penyesuaian di-nol-kan) dan TB disalin; stok awal dibawa dari proyeksi stok hari Minggu per key (ditandai sampai upload Inventory Valuation masuk); ringkasan minggu lalu dari snapshot rilis terakhir; order/rencana yang sudah bertanggal di minggu baru ikut pindah; minggu lama ditutup.</p>
              <ActionForm action={rollover} submit="Buat minggu berikutnya" confirm="Buat minggu berikutnya dan tutup minggu terakhir?" />
            </>
          ) : <p className="muted">Belum ada minggu. Muat minggu contoh atau buat minggu kosong.</p>}
        </Card>
        <Card title="Minggu contoh (reference Excel)">
          <p>Memuat contoh minggu 24–30 Agustus 2026 (update 27 Agu) dari <code>reference/KGR_Weekly_Outlook.xlsx</code>: master SKU/item/akun, parameter, harga, stok awal, penjualan, penerimaan, batch, jurnal, TB, run-rate dan rencana kas. Memuat ulang mengganti baris minggu itu (baris lama di-soft-delete, tercatat di audit).</p>
          <ActionForm action={loadExampleWeek} submit="Muat minggu contoh" confirm="Muat (ulang) minggu contoh 24–30 Agu 2026?" />
        </Card>
        <Card title="Minggu kosong">
          <ActionForm action={createEmptyWeek} submit="Buat minggu" className="row">
            <div className="field"><label>Senin minggu</label><input className="in" type="date" name="week_start" required /></div>
            <div className="field"><label>Tanggal saldo awal (TB)</label><input className="in" type="date" name="tb_opening_date" required /></div>
          </ActionForm>
          <p className="muted">Atau impor minggu dari workbook Excel lewat menu Upload (jenis: Workbook KGR Weekly Outlook).</p>
        </Card>
      </div>
      <Card title="Semua minggu">
        <table className="t">
          <thead><tr><th>Minggu</th><th>Update</th><th>TB per</th><th>Status</th><th>Catatan</th><th /></tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.id}>
                <td><Link href={`/w/${w.week_start}/outlook`}>{tgl(w.week_start)} – {tgl(w.week_end)}</Link></td>
                <td>{tgl(w.update_date, true)}</td>
                <td>{tgl(w.tb_opening_date)}</td>
                <td><Badge s={w.status === "closed" ? "BELUM DIISI" : w.status === "released" ? "LULUS" : "PERIKSA"}>{w.status}</Badge></td>
                <td className="muted">{[w.note, w.opening_stock_flag, w.lw_source ? `minggu lalu: ${w.lw_source}` : null].filter(Boolean).join(" · ")}</td>
                <td>
                  <form action={setWeekStatus} className="row">
                    <input type="hidden" name="id" value={w.id} />
                    {w.status === "closed"
                      ? <button className="b sec small" name="status" value="open">Buka lagi</button>
                      : <button className="b sec small" name="status" value="closed">Tutup</button>}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Shell>
  );
}
