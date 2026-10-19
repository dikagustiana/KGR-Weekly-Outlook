import { Table6 } from "@/components/v6/Table";
import { Status } from "@/components/v6/Status";
import { Drawer } from "@/components/v6/Drawer";
import { statusOf } from "@/lib/v6/status-map";

export interface UploadRow {
  id: string; kind: string; file_name: string | null; file_sha256: string | null; status: string; row_count: number | null;
  inserted: number | null; updated: number | null; deleted: number | null; uploaded_by: string | null; uploaded_at: string; date_from: string | null; date_to: string | null;
}

/**
 * PRD v6 R155 / R163: the upload history — time · kind (the glossary's name) · original file name · rows · Status. The
 * SHA-256, the stored status word and the counts per change go in the row's drawer ("Detail teknis").
 */
export function UploadHistory({ rows, kindLabel }: { rows: UploadRow[]; kindLabel: (kind: string) => string }) {
  const at = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <Table6
      label="Riwayat upload minggu ini" empty="Belum ada upload minggu ini."
      cols={[{ key: "t", label: "Waktu" }, { key: "k", label: "Jenis" }, { key: "f", label: "File" }, { key: "n", label: "Baris", num: true }, { key: "s", label: "Status" }, { key: "d", label: "Detail" }]}
      rows={rows.map((h) => ({
        id: h.id,
        cells: {
          t: at(h.uploaded_at), k: kindLabel(h.kind), f: h.file_name ?? "—", n: h.row_count === null ? "—" : String(h.row_count),
          s: <Status value={h.status === "staged" ? "pending" : h.status} label={h.status === "committed" ? "tersimpan" : h.status === "staged" ? "pratinjau" : undefined} size="sm" />,
          d: <Drawer label={`Detail teknis upload ${h.file_name ?? h.id}`} content={{
            title: `Upload ${h.file_name ?? ""}`.trim(), fn: "lib/upload.ts commit", rule: "Upload ulang rentang tanggal atau dokumen yang sama mengganti baris sebelumnya; perubahan tercatat di audit.",
            sources: [
              { label: "SHA-256", value: h.file_sha256 ?? "—" }, { label: "Jenis (kode)", value: h.kind }, { label: "Status tersimpan", value: `${h.status} (${statusOf(h.status)})` },
              { label: "Baru / diubah / dihapus", value: `${h.inserted ?? 0} / ${h.updated ?? 0} / ${h.deleted ?? 0}` }, // missing-ok: hitungan baris upload
              { label: "Rentang tanggal", value: [h.date_from, h.date_to].filter(Boolean).join(" – ") || "—" }, { label: "Oleh", value: h.uploaded_by ?? "—" },
            ],
          }} />,
        },
      }))}
    />
  );
}
