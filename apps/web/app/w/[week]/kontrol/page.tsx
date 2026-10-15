import Link from "next/link";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Msg, N } from "@/components/ui";
import { can } from "@/lib/roles";
import { release } from "./actions";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import { moduleSettings } from "@/lib/modules";
import { moduleSettingsGlobal } from "@/lib/rebuild";
import { supabaseServer } from "@/lib/supabase";
import { v3ForWeek } from "@/lib/v3/week";

export const dynamic = "force-dynamic";

const LINK: Record<number, string> = {
  1: "input/penjualan", 2: "input/penerimaan", 3: "input/stok-awal", 4: "input/penjualan", 5: "input/penerimaan", 6: "input/penjualan",
  7: "input/penjualan", 8: "input/parameter", 9: "input/parameter", 10: "input/batch", 11: "stok?status=KURANG", 12: "upload",
  13: "upload", 14: "../../master/coa", 15: "neraca", 16: "arus-kas", 17: "arus-kas?cat=%3F", 18: "input/kas", 19: "neraca", 20: "input/penjualan",
};

export default async function KontrolPage({ params }: PageProps) {
  const { week } = await params;
  const ctx = await weekContext(week);
  const c = ctx.computed.result.controls;
  const canRelease = can(ctx.viewer.role, "release");
  const v3 = await v3ForWeek(await supabaseServer(), ctx.week, moduleSettingsGlobal(await moduleSettings()), ctx.computed.result);
  return (
    <WeekShell ctx={ctx} active="kontrol">
      <h1>Kontrol — cek sebelum outlook dikirim</h1>
      <p className="muted">Rilis butuh semua kontrol LULUS; PERIKSA dan BELUM DIISI boleh dirilis dengan peringatan; GAGAL memblokir rilis.</p>
      <Card>
        <table className="t">
          <thead><tr><th>#</th><th>Kontrol</th><th className="n">Nilai</th><th className="n">Pembanding</th><th className="n">Selisih</th><th>Status</th><th>Tindakan kalau GAGAL</th></tr></thead>
          <tbody>
            {c.controls.map((x) => (
              <tr key={x.no}>
                <td>{x.no}</td>
                <td>{x.name} <span className="muted">({x.scope})</span></td>
                <td className="n"><N v={x.value} dp={x.no === 8 || x.no === 10 ? 2 : 0} /></td>
                <td className="n">{x.comparator === null ? <span className="muted">—</span> : <N v={x.comparator} dp={x.no === 8 || x.no === 10 ? 2 : 0} />}</td>
                <td className="n">{x.difference === null ? "" : <N v={x.difference} dp={2} />}</td>
                <td><Badge s={x.status} /></td>
                <td>{x.status === "LULUS" ? <span className="muted">{x.action}</span> : <Link href={`/w/${week}/${LINK[x.no] ?? "outlook"}`}>{x.action}</Link>}</td>
              </tr>
            ))}
            <tr className="total"><td /><td>Ringkasan</td><td /><td /><td /><td><Badge s={c.overall === "ADA GAGAL" ? "GAGAL" : c.overall}>{c.overall}</Badge></td><td /></tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11 }}>Kontrol 14, 17 dan 18 mengikuti Excel (lulus bila ≤ 1) — lihat docs/open-questions.md A1. Kontrol 20 membandingkan baris Ops dengan posting Accurate untuk dokumen yang sama.</p>
      </Card>
      {v3.controls.length ? (
        <Card title="Kontrol modul v3 (C21–C40)">
          <p className="muted">Kontrol modul yang aktif. Tidak memengaruhi status rilis mingguan; C24 dipakai rilis bulanan.</p>
          <ControlsV3Table controls={v3.controls} management={ctx.view === "management"} />
        </Card>
      ) : null}
      <Card title="Rilis outlook">
        {!c.releasable ? <Msg kind="err">Ada kontrol GAGAL — perbaiki dulu sebelum rilis.</Msg> : c.overall !== "LULUS" ? <Msg kind="info">Rilis diizinkan dengan peringatan ({c.counts.PERIKSA} PERIKSA, {c.counts["BELUM DIISI"]} BELUM DIISI).</Msg> : <Msg kind="ok">Semua kontrol LULUS.</Msg>}
        {canRelease ? (
          <ActionForm action={release} submit="Rilis outlook (simpan snapshot JSON + PDF)" confirm="Rilis outlook minggu ini sekarang?">
            <input type="hidden" name="week" value={week} />
          </ActionForm>
        ) : <p className="muted">Rilis dilakukan oleh Admin atau Finance.</p>}
        <p><Link href={`/w/${week}/rilis`}>Riwayat rilis →</Link></p>
      </Card>
    </WeekShell>
  );
}
