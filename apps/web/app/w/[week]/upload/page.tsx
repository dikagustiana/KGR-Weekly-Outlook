import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Badge, Card } from "@/components/ui";
import { guardInputs } from "@/lib/inputPage";
import { kindsFor } from "@/lib/upload";
import { supabaseServer } from "@/lib/supabase";
import { UploadWizard } from "./UploadWizard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function UploadPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const sb = await supabaseServer();
  const { data: hist } = await sb.from("upload").select("id, kind, file_name, file_sha256, status, row_count, inserted, updated, deleted, uploaded_by, uploaded_at, date_from, date_to")
    .eq("week_id", ctx.week.id).order("uploaded_at", { ascending: false }).limit(50);
  const kinds = kindsFor(ctx.viewer.role).map((k) => ({ kind: k.kind, label: k.label, description: k.description, target: k.target, source: k.source }));
  return (
    <WeekShell ctx={ctx} active="upload">
      <h1>Upload — export Accurate dan dokumen operasional</h1>
      <p className="muted">Alur: file → pratinjau (deteksi kolom, kode belum dipetakan, rencana perubahan) → simpan. Upload ulang rentang tanggal / dokumen yang sama mengganti baris sebelumnya (idempotent, tidak dobel); perubahan tercatat di audit. Baris Accurate menggantikan baris Ops untuk dokumen yang sama (kontrol 20).</p>
      {kinds.length ? <UploadWizard week={week} kinds={kinds} keys={ctx.computed.loaded.inputs.sku_keys.map((k) => k.key)} isAdmin={ctx.viewer.role === "admin"} /> : <p>Peran Anda tidak mengunggah data.</p>}
      <Card title="Riwayat upload minggu ini">
        <table className="t compact">
          <thead><tr><th>Waktu</th><th>Jenis</th><th>File</th><th>SHA-256</th><th>Rentang</th><th className="n">Baris</th><th className="n">Baru</th><th className="n">Diubah</th><th className="n">Dihapus</th><th>Oleh</th><th>Status</th></tr></thead>
          <tbody>
            {(hist ?? []).map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.uploaded_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td>{h.kind}</td><td>{h.file_name}</td><td><code>{String(h.file_sha256).slice(0, 10)}</code></td>
                <td>{h.date_from ?? ""} {h.date_to && h.date_to !== h.date_from ? `– ${h.date_to}` : ""}</td><td className="n">{h.row_count}</td><td className="n">{h.inserted}</td><td className="n">{h.updated}</td><td className="n">{h.deleted}</td>
                <td>{h.uploaded_by}</td><td><Badge s={h.status === "committed" ? "LULUS" : h.status === "staged" ? "PERIKSA" : "BELUM DIISI"}>{h.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </WeekShell>
  );
}
