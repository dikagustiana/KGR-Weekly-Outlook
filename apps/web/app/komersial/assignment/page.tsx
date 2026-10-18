import Link from "next/link";
import { notFound } from "next/navigation";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { AssignmentForm } from "@/components/v5/AssignmentForm";
import { can } from "@/lib/roles";
import { requireViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";
import { supabaseService } from "@/lib/supabase-service";
import { currentView } from "@/lib/view-server";
import { moduleEnabled } from "@/lib/modules";
import { tileData, tileError, type TileData } from "@/lib/loader";
import { loadAssignments, loadSalesUsers, loadSkuKeys } from "@/lib/v5/assignment-data";
import { ASSIGNMENT_PATH, coverLines, emailOf, knownKeys, scopeText, sortAssignments, type KnownKeys, type SalesUser } from "@/lib/v5/assignment";
import { saveAssignmentAction, toggleAssignmentAction } from "./actions";

export const dynamic = "force-dynamic";

const okOrNull = <T,>(t: TileData<T>): T | null => ("ok" in t ? t.ok : null);

/**
 * A7 /komersial/assignment (K49, O21(b)): who sees and writes which SKU and customer. Admin and Kepala Sales only (area
 * `sales_assignment`, as RLS); every other role gets a 404. Not behind a module flag: it is the setup the flags' screens read.
 */
export default async function AssignmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const v = await requireViewer();
  if (!can(v.role, "sales_assignment")) notFound();
  const { viewer, weeks, week } = await plainContext();
  const mgmt = (await currentView(viewer)) === "management";
  const sb = await supabaseServer();
  // K41: the list is the page; a failed read stops it. The pickers are cards of their own and say what failed
  const rows = sortAssignments(await loadAssignments(sb));
  const users = await tileData<SalesUser[]>("penugasan: daftar Sales", () => loadSalesUsers(sb, viewer, supabaseService()));
  const keys = await tileData<KnownKeys>("penugasan: key SKU", async () => knownKeys(await loadSkuKeys(sb)));
  const known = okOrNull(keys);
  const userList = okOrNull(users);
  const edit = sp.edit ? rows.find((r) => r.id === sp.edit) : undefined;
  const lines = coverLines(userList, rows);
  const on = rows.filter((r) => r.active).length;
  const customers = [...new Set(rows.map((r) => r.customer).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
  const pickerError = tileError(users) ?? tileError(keys);
  const komersial = await moduleEnabled("m7_commercial", viewer);
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      <h1>Penugasan Sales</h1>
      <p className="muted">
        Sales hanya melihat dan menulis SKU dan pelanggan yang ditugaskan di sini; tanpa penugasan aktif Sales tidak melihat SKU apa pun.
        Key dasar tanpa bentuk (<code>RPA|Karkas</code>) mencakup semua bentuk (Fresh, Frozen, n/a); key dengan bentuk (<code>RPA|Karkas|Fresh</code>) hanya key itu (O21 b).
        Pelanggan kosong = semua pelanggan. Penugasan tidak dihapus: nonaktifkan untuk mencabut akses.{" "}
        {komersial ? <Link href="/komersial">← Komersial</Link> : null}
      </p>

      <Card title="Ringkasan per Sales">
        {lines.length ? (
          <ul data-assignment-summary="">
            {lines.map((l) => (
              <li key={l.email} data-sales={l.email}>
                <strong>{l.name}</strong> <span className="muted">({l.email})</span>:{" "}
                {l.line || <span className="muted">belum ada penugasan aktif, tidak melihat SKU apa pun di Komersial</span>}
                {l.inactive ? <span className="muted"> · {l.inactive} nonaktif</span> : null}
                {l.orphan ? <span className="muted"> · bukan pengguna Sales yang aktif</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="muted">Belum ada pengguna Sales atau penugasan.</p>}
      </Card>

      {!mgmt ? (
        <Card title={edit ? "Ubah penugasan" : "Tambah penugasan"}>
          {pickerError || !known || !userList ? <div className="msg err" role="alert">Formulir tidak bisa dipakai: {pickerError ?? "daftar Sales dan key belum terbaca"}</div> : (
            <>
              <AssignmentForm
                key={edit?.id ?? "baru"} action={saveAssignmentAction} users={userList} bases={known.bases} skus={known.skus} customers={customers}
                edit={edit ? { id: edit.id, email: emailOf(edit), key: edit.key ?? "", customer: edit.customer ?? "", note: edit.note ?? "" } : null}
              />
              {edit ? <p><Link href={ASSIGNMENT_PATH}>Batal ubah</Link></p> : null}
              <p className="muted" style={{ fontSize: 11 }}>
                Key harus ada di master (SKU aktif) atau key dasarnya. Sales yang membuat komitmen minggu depan perlu key dasar (Q-v5.2-53): komitmen dicatat per key dasar.
                Nama pelanggan harus sama dengan di PO (huruf besar/kecil tidak dibedakan). Menyimpan penugasan yang sama lagi mengaktifkannya dan memperbarui catatan.
              </p>
            </>
          )}
        </Card>
      ) : <p className="muted">Tampilan Manajemen: daftar saja. Pilih tampilan Preparer untuk mengubah penugasan.</p>}

      <Card title={`Daftar penugasan (${on} aktif, ${rows.length - on} nonaktif)`}>
        <table className="t" data-assignments="">
          <thead><tr><th>Sales</th><th>Pelanggan</th><th>Key</th><th>Mencakup</th><th>Status</th><th>Catatan</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? "" : "dim"} data-assignment={r.id} data-key={r.key ?? ""} data-active={r.active ? "1" : "0"}>
                <td>{r.sales_rep}<div className="muted" style={{ fontSize: 11 }}>{r.email ?? "tanpa e-mail (tidak berlaku untuk login mana pun)"}</div></td>
                <td>{r.customer ?? <span className="muted">semua pelanggan</span>}</td>
                <td>{r.key ?? <span className="muted">semua SKU</span>}{known && r.key && !known.skus.includes(r.key) && !known.bases.includes(r.key) ? <div className="msg err" style={{ fontSize: 11 }}>tidak ada di master</div> : null}</td>
                <td className="muted">{scopeText(r.key)}</td>
                <td>{r.active ? "aktif" : "nonaktif"}</td>
                <td className="muted">{r.note}</td>
                <td>{!mgmt ? (
                  <div className="row">
                    <Link className="b small sec" href={`${ASSIGNMENT_PATH}?edit=${r.id}`}>Ubah</Link>
                    <ActionForm action={toggleAssignmentAction} submit={r.active ? "Nonaktifkan" : "Aktifkan"} danger={r.active} confirm={r.active ? `Nonaktifkan penugasan ${r.sales_rep} · ${r.key ?? "semua SKU"}? Sales tidak lagi melihat atau menulis SKU ini lewat penugasan ini.` : undefined}>
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} />
                    </ActionForm>
                  </div>
                ) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="muted">Belum ada penugasan. Tanpa penugasan, Sales tidak melihat SKU apa pun.</p> : null}
      </Card>
    </Shell>
  );
}
