import { redirect } from "next/navigation";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { supabaseServer } from "@/lib/supabase";
import { mustRows } from "@/lib/loader";
import { ROLE_LABEL } from "@/lib/roles";
import { AssignmentLink } from "@/components/v5/AssignmentLink";
import { saveUser, setPassword, toggleActive } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_HELP: Record<string, string> = {
  admin: "Parameter, master data, run-rate, pengguna, rollover — semua",
  inventory_accounting: "Upload Accurate (penjualan, GRN, valuation, jurnal, TB); HPP aktual",
  sales: "Order; tandai terkirim; harga jual acuan",
  ppic: "Rencana potong dan batch aktual; rencana terima produksi",
  purchasing: "Harga LB hari ini, rencana beli trading, harga beli pengganti, termin, rencana kas (pembayaran)",
  finance: "Rencana kas, run-rate, rilis outlook",
  management: "Baca saja (tanpa halaman input)",
  commercial_lead: "Semua hak Sales; approval diskon di bawah harga lantai; scorecard dan target per sales; penugasan SKU dan pelanggan Sales",
  cost_accounting: "Upload WP potong per batch, cost pool, tarif overhead, alokasi biaya ke SKU",
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  if (viewer.role !== "admin") redirect("/");
  const sb = await supabaseServer();
  const data = mustRows(await sb.from("app_user").select("*").order("role").order("email"), "pengguna.app_user") as any[];
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="admin/pengguna">
      <h1>Pengguna dan peran</h1>
      <p className="muted">Hanya e-mail di daftar ini yang bisa masuk (login dengan kata sandi, atau Google Workspace bila diaktifkan). Peran menentukan input yang boleh diisi; semua pengguna aktif bisa membaca outlook.</p>
      <AssignmentLink className="muted" />
      <div className="grid2">
        <Card title="Tambah / ubah pengguna">
          <ActionForm action={saveUser} submit="Simpan pengguna" className="row">
            <div className="field"><label>E-mail</label><input className="in" name="email" type="email" required style={{ width: 240 }} /></div>
            <div className="field"><label>Nama</label><input className="in" name="full_name" style={{ width: 180 }} /></div>
            <div className="field"><label>Peran</label><select className="in" name="role">{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </ActionForm>
        </Card>
        <Card title="Buat login / atur ulang kata sandi">
          <ActionForm action={setPassword} submit="Atur kata sandi sementara" className="row">
            <div className="field"><label>E-mail (harus sudah di daftar)</label><input className="in" name="email" type="email" required style={{ width: 240 }} /></div>
            <div className="field"><label>Kata sandi sementara</label><input className="in" name="password" type="password" minLength={10} required autoComplete="new-password" /></div>
          </ActionForm>
          <p className="muted" style={{ fontSize: 11 }}>Tidak ada e-mail yang dikirim. Pengguna mengganti kata sandi sendiri di menu Akun setelah masuk.</p>
        </Card>
      </div>
      <Card title={`Daftar pengguna (${data.length})`}>
        <table className="t">
          <thead><tr><th>E-mail</th><th>Nama</th><th>Peran</th><th>Hak tulis</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.email} className={u.active ? "" : "dim"}>
                <td>{u.email}</td><td>{u.full_name}</td><td>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}</td><td className="muted">{ROLE_HELP[u.role]}</td>
                <td>{u.active ? "aktif" : "nonaktif"}</td>
                <td>{u.email !== viewer.email ? (
                  <form action={toggleActive}><input type="hidden" name="email" value={u.email} /><input type="hidden" name="active" value={u.active ? "0" : "1"} />
                    <button className={`b small ${u.active ? "danger" : "sec"}`}>{u.active ? "Nonaktifkan" : "Aktifkan"}</button></form>
                ) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Shell>
  );
}
