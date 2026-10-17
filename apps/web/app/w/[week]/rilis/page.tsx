import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Badge, Card } from "@/components/ui";
import { supabaseServer } from "@/lib/supabase";
import { mustRows } from "@/lib/loader";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function RilisPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  const sb = await supabaseServer();
  const data = mustRows(await sb.from("release").select("id, update_date, engine_version, snapshot_sha256, pdf_path, control_status, controls, ops_rows, released_by, released_at")
    .eq("week_id", ctx.week.id).order("released_at", { ascending: false }), "rilis.release") as any[];
  const rows = data as { id: string; update_date: string; engine_version: string; snapshot_sha256: string; pdf_path: string; control_status: string; controls: { controls?: unknown[]; counts?: Record<string, number> } | null; ops_rows: unknown[]; released_by: string; released_at: string }[];
  // R12/R13: the management view shows when and how the release stood, not who (e-mail) or the audit columns
  const mgmt = ctx.view === "management";
  const controlLine = (x: (typeof rows)[number]) => {
    const n = x.controls?.counts ?? {};
    const parts = [`${n.LULUS ?? 0}/${x.controls?.controls?.length ?? 0} lulus`];
    if (n["BELUM DIISI"]) parts.push(`${n["BELUM DIISI"]} belum diisi`);
    if (n.PERIKSA) parts.push(`${n.PERIKSA} perlu diperiksa`);
    if (n.GAGAL) parts.push(`${n.GAGAL} gagal`);
    return parts.join(" · ");
  };
  return (
    <WeekShell ctx={ctx} active="rilis">
      <h1>Riwayat rilis</h1>
      <p className="muted">{mgmt ? "Setiap rilis menyimpan outlook (PDF) seperti saat dirilis." : "Setiap rilis menyimpan snapshot JSON lengkap (byte-identik untuk input yang sama) dan PDF, sehingga outlook masa lalu bisa dibuka lagi walau input berubah."}</p>
      <Card>
        {rows.length === 0 ? <p className="muted">Belum ada rilis untuk minggu ini.</p> : mgmt ? (
          <table className="t">
            <thead><tr><th>Dirilis</th><th>Tanggal update</th><th>Kontrol</th><th>Unduh</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{tgl(new Date(x.released_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }))}</td><td>{tgl(x.update_date)}</td><td>{controlLine(x)}</td>
                  <td className="row"><a href={`/api/release/${x.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="t">
            <thead><tr><th>Dirilis</th><th>Oleh</th><th>Tanggal update</th><th>Kontrol</th><th>Baris Ops</th><th>Engine</th><th>SHA-256 snapshot</th><th>Unduh</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{new Date(x.released_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td>{x.released_by}</td><td>{tgl(x.update_date, true)}</td><td><Badge s={x.control_status === "ADA GAGAL" ? "GAGAL" : x.control_status}>{x.control_status}</Badge></td>
                  <td>{x.ops_rows.length}</td><td>v{x.engine_version}</td><td><code>{x.snapshot_sha256.slice(0, 16)}…</code></td>
                  <td className="row"><a href={`/api/release/${x.id}/pdf`} target="_blank" rel="noreferrer">PDF</a><a href={`/api/release/${x.id}/json`}>JSON</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </WeekShell>
  );
}
