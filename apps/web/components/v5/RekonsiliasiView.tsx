import type { ReactNode } from "react";
import type { Decimal, ReconLine } from "@kgr/engine";
import { V4Table, type Col, type TRow } from "@/components/v4/Table";
import { minus, num, tglShort } from "@/lib/fmt";
import { monthName } from "@/lib/v4/outlook-bulan";
import { inFsReconScope, type FsReconModel } from "@/lib/v5/fs-recon";

const TONE: Record<string, string> = { LULUS: "better", GAGAL: "worse", "BELUM DIISI": "muted" };
const STATUS_TONE: Record<string, string> = { sama: "better", beda: "worse", "tidak ada di app": "muted", "tidak ada di FS": "muted" };

/** Exact rupiah, two decimals, minus U+2212 (a difference of Rp 2,71 must stay visible); a missing number is said, never 0. */
export const rupiah = (v: Decimal | null): string => (v === null ? "belum ada" : `Rp ${minus(num(v, 2))}`);

const cols: Col[] = [
  { key: "b", label: "Baris FS", kind: "key", wrap: true }, { key: "a", label: "Baris app", wrap: true },
  { key: "p", label: "App", num: true }, { key: "f", label: "FS", num: true }, { key: "s", label: "Selisih (app − FS)", num: true },
  { key: "t", label: "Status" }, { key: "c", label: "Sebab", wrap: true, kind: "sup" },
];

const row = (l: ReconLine): TRow => ({
  id: l.key,
  cells: {
    b: l.statement ? `${l.key} · ${l.fs_line ?? l.label}` : l.key,
    a: l.mapped || l.app_line ? l.label : "belum dipetakan",
    p: rupiah(l.app), f: rupiah(l.fs), s: l.selisih === null ? "" : rupiah(l.selisih),
    t: <span className={STATUS_TONE[l.status]}>{l.status}</span>,
    c: l.cause ? `${l.cause}${l.note ? `: ${l.note}` : ""}` : "",
  },
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="fin"><h2>{title}</h2>{children}</div>;
}

/**
 * PRD v5.2-A R69 (K62, O25–O27): one table per statement, app against FS with the difference and its cause. The FS is a
 * separate reference: nothing here closes a difference. Pure: the model comes from loadRekonsiliasi.
 */
export function RekonsiliasiView({ first, model }: { first: string; model: FsReconModel | null }) {
  const month = first.slice(0, 7);
  if (!inFsReconScope(first) || !model) {
    return (
      <Section title={`Rekonsiliasi ke FS ${monthName(first)}`}>
        <p className="muted">Bulan sebelum Agustus 2026 di luar cakupan rekonsiliasi ke FS (O27). Saldo awal Agustus adalah TB 31 Juli 2026.</p>
      </Section>
    );
  }
  const r = model.result;
  const c59 = r.c59;
  const lines = r.lines;
  const mapped = (st: "PL" | "BS") => lines.filter((l) => l.mapped && l.statement === st).map(row);
  const unmapped = lines.filter((l) => !l.mapped);
  return (
    <>
      <Section title={`Rekonsiliasi ke FS ${monthName(first)}`}>
        <p className="muted">
          FS (Management Report) diimpor sebagai acuan, app menghitung sendiri, dan C59 membandingkan (K62). Selisih ditampilkan, tidak pernah ditutup. Toleransi ±Rp {num(r.tolerance, 0)} per baris (O26).
        </p>
        <p>
          <strong>C59 <span className={TONE[model.hasFs ? c59.status : "BELUM DIISI"]}>{model.hasFs ? c59.status : "BELUM DIISI"}</span></strong>
          {` · ${r.summary.sama} sama, ${r.summary.beda} beda, ${r.summary.missing} belum ada angka dari ${r.summary.mapped} baris yang dipetakan`}
          {model.hasFs ? "" : " · FS bulan ini belum diimpor"}
        </p>
        {!model.hasFs ? (
          <p className="note">FS bulan ini belum diimpor (B-R91). Kolom FS kosong, bukan 0. C59 belum dinilai dan belum menahan FINAL; setelah FS diimpor, C59 GAGAL menahan FINAL kecuali ada override Finance.</p>
        ) : c59.status === "GAGAL" ? (
          <p className="note">Ada selisih di atas toleransi. Kunci FINAL ditahan sampai selisih dijelaskan atau Finance mencatat override C59 di <a href={`/m/${month}/tutup-buku`}>Tutup buku</a>.</p>
        ) : null}
        <ul className="note">
          <li>
            {model.fs
              ? `FS acuan: versi ${model.fs.version}, berkas ${model.fs.sourceFile ?? "tidak tercatat"}, SHA-256 ${model.fs.sha256 ? `${model.fs.sha256.slice(0, 12)}…` : "tidak tercatat"}, ${model.fs.rows} baris${model.fs.lockedAt ? `, dikunci ${tglShort(model.fs.lockedAt.slice(0, 10))}` : ", belum dikunci"}.`
              : "FS acuan: belum ada."}
          </li>
          <li>
            {model.appSource === "FINAL"
              ? "Angka app laba rugi: FINAL yang sudah dikunci (jurnal bulan penuh + penyesuaian yang diposting)."
              : model.journalThrough >= model.last
                ? "Angka app laba rugi: jurnal bulan penuh + penyesuaian yang diposting; FINAL belum dikunci."
                : `Angka app laba rugi: jurnal bulan berjalan sampai ${tglShort(model.journalThrough)} (belum FINAL, bulan belum penuh).`}
          </li>
          <li>
            {model.tbDate
              ? `Angka app neraca: TB ${tglShort(model.tbDate)} + jurnal sampai ${tglShort(model.last)}.`
              : "Angka app neraca: belum ada TB awal, jadi baris neraca app kosong (bukan 0)."}
          </li>
          <li>
            {model.mode === "memo"
              ? "Mode costing memo (O24 b): COGS, GP, dan NIBT tanpa baris Selisih costing dan Biaya kapasitas idle, sama dengan FS."
              : model.v5.isZero()
                ? "Mode costing cogs (bawaan): tidak ada baris Selisih costing atau Biaya kapasitas idle bulan ini."
                : `Mode costing cogs (bawaan): COGS memuat Selisih costing dan Biaya kapasitas idle (${rupiah(model.v5)}); FS tidak, jadi selisihnya bersebab definisi (O24).`}
          </li>
        </ul>
        {model.memo.length ? (
          <V4Table label="Baris memo di luar COGS"
            cols={[{ key: "l", label: "Baris memo (di luar COGS, GP, dan NIBT)", kind: "key" }, { key: "a", label: "App", num: true }]}
            rows={model.memo.map((m) => ({ id: m.pl_line, cells: { l: m.pl_line, a: `Rp ${minus(num(m.amount as Decimal, 2))}` } }))} />
        ) : null}
        {model.unplaced.length ? (
          <p className="note worse">Akun yang belum bisa ditempatkan di COA (neraca app tidak seimbang sebesar jumlahnya): {model.unplaced.map((u) => `${u.account} (${rupiah(u.net)})`).join(", ")}.</p>
        ) : null}
      </Section>
      <Section title="Laba rugi">
        <V4Table cols={cols} rows={mapped("PL")} label="Rekonsiliasi laba rugi" empty="tidak ada baris laba rugi yang dipetakan" />
      </Section>
      <Section title="Neraca">
        <V4Table cols={cols} rows={mapped("BS")} label="Rekonsiliasi neraca" empty="tidak ada baris neraca yang dipetakan" />
      </Section>
      {c59.detail.length ? (
        <Section title="Rincian C59">
          <ul className="note">{c59.detail.map((d) => <li key={d}>{d}</li>)}</ul>
          <p className="muted">{c59.action}</p>
        </Section>
      ) : null}
      {unmapped.length ? (
        <Section title={`Baris di luar pemetaan (${unmapped.length})`}>
          <details>
            <summary>Tampilkan baris FS dan app yang belum dipetakan; tidak ikut C59 (O27: baris kunci dulu, lalu per akun TB)</summary>
            <V4Table cols={cols} rows={unmapped.map(row)} label="Baris di luar pemetaan" limit={200} />
          </details>
        </Section>
      ) : null}
    </>
  );
}

