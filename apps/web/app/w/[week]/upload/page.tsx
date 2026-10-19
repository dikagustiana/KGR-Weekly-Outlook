import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Badge, Card } from "@/components/ui";
import { guardInputs } from "@/lib/inputPage";
import { kindsFor } from "@/lib/upload";
import { supabaseServer } from "@/lib/supabase";
import { mustRows } from "@/lib/loader";
import { UploadWizard } from "./UploadWizard";
import { moduleSettings } from "@/lib/modules";
import { v6PagesOn } from "@/lib/v6/flags";
import { Headline } from "@/components/v6/Headline";
import { UploadHistory, type UploadRow } from "./History";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function UploadPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const sb = await supabaseServer();
  const hist = mustRows(await sb.from("upload").select("id, kind, file_name, file_sha256, status, row_count, inserted, updated, deleted, uploaded_by, uploaded_at, date_from, date_to")
    .eq("week_id", ctx.week.id).order("uploaded_at", { ascending: false }).limit(50), "upload.history") as any[];
  const kinds = kindsFor(ctx.viewer.role, await moduleSettings()).map((k) => ({ kind: k.kind, label: k.label, description: k.description, target: k.target, source: k.source }));
  if (await v6PagesOn()) {
    // PRD v6 R163: the v6 page — the wizard in tiles, the history with Status, technical details in a drawer
    const label = (k: string) => kinds.find((x) => x.kind === k)?.label ?? k.replace(/_/g, " ");
    const n = (hist ?? []).length;
    return (
      <WeekShell ctx={ctx} active="upload">
        <Headline note="File Excel atau CSV dari Accurate dan dokumen operasional. Upload ulang data yang sama mengganti baris sebelumnya, tidak dobel.">
          {n ? `${n} upload minggu ini; terakhir ${label(hist[0].kind)}.` : "Belum ada upload minggu ini."}
        </Headline>
        {kinds.length ? <UploadWizard week={week} kinds={kinds} keys={ctx.computed.result.prepared.master.map((k) => k.key)} isAdmin={ctx.viewer.role === "admin"} v6 /> : <p className="ts-empty">Peran Anda tidak mengunggah data.</p>}
        <section className="tile" aria-labelledby="riwayat-h" style={{ marginTop: 12 }}>
          <h2 className="tile-t" id="riwayat-h">Riwayat upload minggu ini</h2>
          <UploadHistory rows={(hist ?? []) as UploadRow[]} kindLabel={label} />
        </section>
      </WeekShell>
    );
  }
  return (
    <WeekShell ctx={ctx} active="upload">
      <h1>Upload — export Accurate dan dokumen operasional</h1>
      <p className="muted">Alur: file → pratinjau (deteksi kolom, kode belum dipetakan, rencana perubahan) → simpan. Upload ulang rentang tanggal / dokumen yang sama mengganti baris sebelumnya (idempotent, tidak dobel); perubahan tercatat di audit. Baris Accurate menggantikan baris Ops untuk dokumen yang sama (kontrol 20).</p>
      {kinds.length ? <UploadWizard week={week} kinds={kinds} keys={ctx.computed.result.prepared.master.map((k) => k.key)} isAdmin={ctx.viewer.role === "admin"} /> : <p>Peran Anda tidak mengunggah data.</p>}
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
