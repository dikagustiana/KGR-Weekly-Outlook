import { addDays, releaseVerdict } from "@kgr/engine";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { OverridePanel } from "@/components/v4/OverridePanel";
import { V4Table, type Col, type TRow } from "@/components/v4/Table";
import { plainContext } from "@/lib/page";
import { moduleSettings } from "@/lib/modules";
import { moduleSettingsGlobal } from "@/lib/rebuild";
import { supabaseServer } from "@/lib/supabase";
import { releaseContext } from "@/lib/release";
import { closeViewV4, finalMandatory } from "@/lib/v4/close";
import { monthName } from "@/lib/v4/outlook-bulan";
import { jtV4, pctV4, tglShort } from "@/lib/fmt";
import type { Viewer } from "@/lib/session";
import { adjustmentAction } from "../actions";
import { finalV4Action, overrideMonthAction } from "../actions-v4";

const KIND: Record<string, string> = { unbilled_revaluation: "revaluasi COGS unbilled", parked_cost: "biaya terparkir", inventory_adj: "penyesuaian persediaan", accrual: "akrual", other: "lain" };
const METRIC: Record<string, string> = { revenue: "Revenue", gp: "GP", nibt: "NIBT" };
const TONE: Record<string, string> = { LULUS: "better", GAGAL: "worse", PERIKSA: "worse", "BELUM DIISI": "muted", STALE: "worse", "N/A": "muted" };

/**
 * PRD v4 §6.6 Finance · Tutup buku (flag v4_design): closing adjustments (DI-xx), FINAL through public.release_month with
 * the FINAL controls and per-control overrides, accuracy of V1 / V2 against FINAL before and after the adjustments,
 * per day (forecast_accuracy_daily), and the calibration rows written to the next month's register.
 */
export async function TutupBukuV4({ first, viewer }: { first: string; viewer: Viewer }) {
  const { weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const v = await closeViewV4(sb, first, moduleSettingsGlobal(await moduleSettings()));
  const rc = await releaseContext(sb, "month", `${first}:FINAL`, first, v.last);
  const month = first.slice(0, 7), prev = addDays(first, -1).slice(0, 7), next = addDays(v.last, 1).slice(0, 7);

  const aCols: Col[] = [
    { key: "c", label: "Kode", kind: "key" }, { key: "d", label: "Keterangan", wrap: true }, { key: "l", label: "Pos P&L" }, { key: "k", label: "Jenis" },
    { key: "a", label: "Jumlah (Rp jt)", num: true }, { key: "p", label: "Posting" },
  ];
  const aRows: TRow[] = v.adjustments.map((a) => ({
    id: String(a.id),
    cells: {
      c: String(a.code), d: String(a.description), l: String(a.pl_line), k: KIND[String(a.kind)] ?? String(a.kind), a: jtV4(String(a.amount)),
      p: v.hasFinal ? (a.posted ? `diposting ${String(a.gl_voucher ?? "")}` : "tidak diposting") : (
        <ActionForm v4 action={adjustmentAction} submit={a.posted ? "Batalkan posting" : "Tandai diposting"}>
          <input type="hidden" name="month" value={first} /><input type="hidden" name="id" value={String(a.id)} /><input type="hidden" name="op" value="post" />
          <input type="hidden" name="posted" value={a.posted ? "0" : "1"} />
          <input name="gl_voucher" defaultValue={String(a.gl_voucher ?? "")} placeholder="voucher GL" size={10} aria-label="Voucher GL" />
        </ActionForm>
      ),
    },
  }));

  const p = v.preview;
  const verdict = p ? releaseVerdict({ controls: p.controls, mandatory: finalMandatory(p.controls), overrides: rc.overrides.map((o) => o.code), strict: true, staleDates: rc.staleDates, policy: rc.policy }) : null;
  const finalReason = v.hasFinal ? "FINAL sudah dikunci" : !v.afterMonthEnd ? `FINAL dikunci setelah ${tglShort(v.last)}` : verdict && !verdict.ok ? `ditolak: ${verdict.rejections.map((r) => `${r.code} ${r.status}`).join(", ")}` : null;
  const cCols: Col[] = [{ key: "c", label: "Kontrol", kind: "key" }, { key: "n", label: "Isi", wrap: true }, { key: "s", label: "Status" }, { key: "d", label: "Rincian", kind: "sup", wrap: true }];
  const cRows: TRow[] = (p?.controls ?? []).map((c) => ({ id: c.code, cells: { c: c.code, n: c.name, s: <span className={TONE[c.status] ?? ""}>{c.status}</span>, d: c.detail.slice(0, 6).join(", ") } }));
  const tCols: Col[] = [{ key: "m", label: "", kind: "key" }, { key: "b", label: "Jurnal bulan penuh", num: true }, { key: "a", label: "Penyesuaian diposting", num: true }, { key: "f", label: "FINAL", num: true, kind: "key" }];
  const tRows: TRow[] = p ? (["revenue", "gp", "nibt"] as const).map((m) => ({ id: m, cells: { m: METRIC[m], b: jtV4(p.before[m]), a: jtV4(p.adjustments[m]), f: jtV4(p.after[m]) } })) : [];

  const accCols: Col[] = [
    { key: "v", label: "Versi", kind: "key" }, { key: "m", label: "Metrik" }, { key: "x", label: "Versi (Rp jt)", num: true }, { key: "f", label: "FINAL", num: true },
    { key: "b", label: "Bias", num: true }, { key: "e", label: "Abs error", num: true }, { key: "p", label: "MAPE", num: true }, { key: "bp", label: "Bias sebelum penyesuaian", num: true, kind: "sup" },
  ];
  const accRows: TRow[] = v.accuracy.map((l) => ({
    id: `${l.version}-${l.metric}`,
    cells: { v: l.version, m: METRIC[l.metric], x: jtV4(l.value), f: jtV4(l.final), b: jtV4(l.bias), e: jtV4(l.absError), p: l.metric === "revenue" ? (l.mape === null ? "N/A" : pctV4(l.mape)) : "", bp: jtV4(l.biasPre) },
  }));
  const dCols: Col[] = [
    { key: "v", label: "Versi", kind: "key" }, { key: "k", label: "Hari" }, { key: "n", label: "Jumlah hari", num: true }, { key: "d", label: "Selisih revenue (Rp jt)", num: true },
    { key: "q", label: "dari kg kirim", num: true }, { key: "h", label: "dari harga", num: true },
  ];
  const dRows: TRow[] = v.daily.map((d) => ({ id: `${d.version}-${d.kind}`, cells: { v: d.version, k: d.kind === "po" ? "ber-PO" : "run-rate", n: String(d.days), d: d.diff === null ? "belum lengkap" : jtV4(d.diff), q: d.diffKg === null ? "" : jtV4(d.diffKg), h: d.diffPrice === null ? "" : jtV4(d.diffPrice) } }));
  const kCols: Col[] = [{ key: "c", label: "Kode", kind: "key" }, { key: "n", label: "Asumsi", wrap: true }, { key: "v", label: "Nilai", num: true }, { key: "s", label: "Status" }];
  const kRows: TRow[] = v.calibration.map((r) => ({
    id: r.id,
    cells: { c: r.code, n: r.name, v: r.value === null ? "" : r.code.includes("margin") || r.code.includes("offday") ? pctV4(r.value, 2) : jtV4(r.value), s: r.status === "agreed" ? "disepakati" : r.status === "superseded" ? "diganti" : "diusulkan" },
  }));

  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/m">
      <h1 className="sr-only">Tutup buku {monthName(first)}</h1>
      <div className="fin">
        <nav className="seg" aria-label="Bulan"><span className="seg-l">Bulan</span><a href={`/m/${prev}/tutup-buku`}>{monthName(`${prev}-01`)}</a><a href={`/m/${month}/tutup-buku`} aria-current="true">{monthName(first)}</a><a href={`/m/${next}/tutup-buku`}>{monthName(`${next}-01`)}</a></nav>
        <h2>Penyesuaian tutup buku {monthName(first)}</h2>
        <p className="muted">Catatan DI-xx sebelum FINAL. Tanda mengikuti P&amp;L: + menambah laba, − mengurangi. Hanya penyesuaian yang diposting (dengan voucher GL) masuk FINAL; revaluasi COGS unbilled (DI-01) dicatat di sini dengan jenis &quot;revaluasi COGS unbilled&quot;.</p>
        <V4Table cols={aCols} rows={aRows} label="Penyesuaian tutup buku" empty="belum ada penyesuaian" />
        {v.unbilled.map((u) => (
          <p key={u.month} className="note">
            {u.month === first
              ? `DO ${monthName(first)} yang difaktur sesudah ${tglShort(v.last)}: ${u.dos} dokumen, ${u.kg.replace(/\.00$/, "")} kg. COGS dinilai MA tanggal DO ${jtV4(u.cogsRevenue)} jt; MA tanggal faktur ${jtV4(u.cogsInvoice)} jt; revaluasi ${jtV4(u.revaluation)} jt jatuh di bulan faktur.`
              : `DO ${monthName(u.month)} yang difaktur bulan ini: ${u.dos} dokumen. COGS MA tanggal DO ${jtV4(u.cogsRevenue)} jt, MA tanggal faktur ${jtV4(u.cogsInvoice)} jt; revaluasi ${jtV4(u.revaluation)} jt (DI-01). Catat sebagai penyesuaian berjenis revaluasi COGS unbilled bila Finance menyetujui.`}
          </p>
        ))}
        {!v.hasFinal ? (
          <ActionForm v4="primary" action={adjustmentAction} submit="Tambah penyesuaian">
            <input type="hidden" name="month" value={first} />
            <input name="code" placeholder="DI-06" size={6} aria-label="Kode" /><input name="description" placeholder="keterangan" size={30} aria-label="Keterangan" />
            <input name="pl_line" placeholder="pos P&L" size={16} aria-label="Pos P&L" />
            <select name="kind" aria-label="Jenis">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input name="amount" placeholder="jumlah Rp (+/−)" size={12} aria-label="Jumlah" />
          </ActionForm>
        ) : null}
      </div>

      <div className="fin">
        <h2>FINAL</h2>
        {v.hasFinal ? (
          <p className="muted">FINAL dikunci {v.versions.find((x) => x.version === "FINAL")?.lockedAt?.slice(0, 10) ?? ""}, SHA {v.versions.find((x) => x.version === "FINAL")?.sha.slice(0, 12)}…; tidak bisa diubah.</p>
        ) : p ? (
          <>
            <p className="muted">FINAL = jurnal bulan penuh (dan DO belum difaktur, K11) ditambah penyesuaian yang diposting. Server menolak bila kontrol wajib GAGAL, BELUM DIISI, atau STALE, kecuali ada override dengan alasan dan bukti oleh peran yang diizinkan. Mulai Agustus 2026, C59 (angka app lawan FS) ikut menahan FINAL setelah FS diimpor; rinciannya di <a href={`/m/${month}/rekonsiliasi`}>Rekonsiliasi FS</a>.</p>
            <V4Table cols={tCols} rows={tRows} label="FINAL sebelum dan sesudah penyesuaian" />
            <V4Table cols={cCols} rows={cRows} label="Kontrol FINAL" empty="tidak ada kontrol FINAL" />
            {verdict && (verdict.rejections.length || rc.overrides.length) ? (
              <OverridePanel v4 rejections={verdict.rejections.map((r) => ({ code: r.code, label: r.code === "STALE" ? `STALE: mart belum dibangun ulang untuk ${rc.staleDates.join(", ")}` : `${r.code} ${r.status}: ${p.controls.find((c) => c.code === r.code)?.name ?? ""}`, overridable: r.overridable }))}
                overrides={rc.overrides} policy={rc.policy} role={viewer.role} action={overrideMonthAction} hidden={{ month: first, version: "FINAL" }} />
            ) : null}
          </>
        ) : <p className="muted">Pemeriksaan FINAL tersedia setelah {tglShort(v.last)}.</p>}
        <div className="actionbar">
          <ActionForm v4="primary" action={finalV4Action} submit="Kunci FINAL" confirm="Kunci FINAL? Versi yang dikunci tidak bisa diubah; akurasi dan kalibrasi bulan berikut dihitung." disabled={finalReason !== null}>
            <input type="hidden" name="month" value={first} />
          </ActionForm>
          {finalReason ? <span className="reason">{finalReason}</span> : null}
        </div>
      </div>

      {v.hasFinal ? (
        <div className="fin">
          <h2>Akurasi terhadap FINAL</h2>
          <p className="muted">Bias = versi − FINAL. MAPE hanya untuk revenue, N/A bila FINAL 0. Kolom terakhir membandingkan dengan FINAL sebelum penyesuaian tutup buku.</p>
          <V4Table cols={accCols} rows={accRows} label="Akurasi versi" empty="belum ada V1 atau V2 untuk dibandingkan" />
          <h2>Per hari: ber-PO lawan run-rate</h2>
          <V4Table cols={dCols} rows={dRows} label="Akurasi per hari" empty="mart forecast_accuracy_daily belum dibangun" />
        </div>
      ) : null}

      <div className="fin">
        <h2>Kalibrasi untuk {monthName(`${next}-01`)}</h2>
        <p className="muted">Ditulis ke register bulan berikut saat FINAL dikunci, berstatus diusulkan. V1 bulan itu baru bisa dikunci setelah Finance menyepakatinya di <a href={`/m/${next}`}>Outlook bulan</a>.</p>
        <V4Table cols={kCols} rows={kRows} label="Kalibrasi" empty="belum ada; ditulis saat FINAL dikunci" />
      </div>
    </Shell>
  );
}
