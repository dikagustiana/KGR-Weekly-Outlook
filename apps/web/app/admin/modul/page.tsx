import { redirect } from "next/navigation";
import { clock } from "@/lib/clock";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Badge, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { MODULE_KEYS, MODULE_LABEL, moduleSettings } from "@/lib/modules";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase";
import { processQueue, queueDates, setFlag } from "./actions";

export const dynamic = "force-dynamic";

interface QueueRow { id: string; date: string; reason: string | null; status: string; error: string | null; requested_at: string; finished_at: string | null; created_by: string | null }

export default async function ModulesAdmin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  if (viewer.role !== "admin") redirect("/");
  const settings = await moduleSettings();
  const sb = await supabaseServer();
  const { data: q } = await sb.from("rebuild_queue").select("id, date, reason, status, error, requested_at, finished_at, created_by")
    .order("requested_at", { ascending: false }).limit(60);
  const queue = (q ?? []) as QueueRow[];
  const queued = queue.filter((r) => r.status === "queued").length;
  const today = (await clock(sb)).data;
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="admin/modul">
      <h1>Modul v3</h1>
      <p className="muted">Setiap modul baru dimatikan sampai fasenya diterima (PRD v3 §4.9). Modul yang mati: halamannya tidak ada (404), aksi simpannya ditolak, dan tidak muncul di menu. Urutan menyalakan: Admin dulu, lalu peran pemakai, lalu semua.</p>
      <Card title="Flag per modul">
        <table className="t">
          <thead><tr><th>Modul</th><th>Status</th><th>Atur</th></tr></thead>
          <tbody>
            {MODULE_KEYS.map((k) => {
              const s = settings[k];
              const on = !!s?.enabled;
              return (
                <tr key={k}>
                  <td><b>{MODULE_LABEL[k]}</b><div className="muted"><code>{k}</code></div></td>
                  <td>{on ? <Badge s="LULUS">aktif{s?.roles?.length ? `: ${s.roles.map((r) => ROLE_LABEL[r]).join(", ")}` : ": semua peran"}</Badge> : <Badge s="BELUM DIISI">nonaktif</Badge>}</td>
                  <td>
                    <ActionForm action={setFlag} submit="Simpan" className="row">
                      <input type="hidden" name="key" value={k} />
                      <label className="row" style={{ gap: 4 }}><input type="checkbox" name="enabled" value="1" defaultChecked={on} /> aktif</label>
                      {ROLES.map((r) => (
                        <label key={r} className="row" style={{ gap: 2 }}>
                          <input type="checkbox" name={`role_${r}`} value="1" defaultChecked={!!s?.roles?.includes(r)} /> <span className="muted">{ROLE_LABEL[r]}</span>
                        </label>
                      ))}
                    </ActionForm>
                    <div className="muted">Tanpa centang peran = semua peran.</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="grid2">
        <Card title="Bangun ulang data mart">
          <p className="muted">Menghitung ulang tabel harian (stok per lot/SKU, P&amp;L harian, kas, komersial) untuk rentang tanggal, dengan modul yang aktif. Aman diulang: hari yang tidak berubah tidak ditulis.</p>
          <ActionForm action={queueDates} submit="Bangun ulang" className="row">
            <div className="field"><label>Dari</label><input className="in" type="date" name="from" defaultValue={today} required /></div>
            <div className="field"><label>Sampai</label><input className="in" type="date" name="to" defaultValue={today} /></div>
          </ActionForm>
        </Card>
        <Card title={`Antrian rebuild (${queued} menunggu)`}>
          <ActionForm action={processQueue} submit="Proses antrian sekarang" />
        </Card>
      </div>
      <Card title="Riwayat antrian (60 terakhir)">
        <table className="t compact">
          <thead><tr><th>Tanggal</th><th>Alasan</th><th>Status</th><th>Hasil</th><th>Diminta</th><th>Oleh</th></tr></thead>
          <tbody>
            {queue.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td><td>{r.reason}</td>
                <td><Badge s={r.status === "done" ? "LULUS" : r.status === "failed" ? "GAGAL" : "PERIKSA"}>{r.status}</Badge></td>
                <td className="muted">{r.error}</td>
                <td className="muted">{new Date(r.requested_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                <td className="muted">{r.created_by}</td>
              </tr>
            ))}
            {queue.length === 0 ? <tr><td colSpan={6} className="muted">Belum ada.</td></tr> : null}
          </tbody>
        </table>
      </Card>
    </Shell>
  );
}
