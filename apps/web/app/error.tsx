"use client";
/**
 * K56 (R41): a loader that cannot read (flags, release context, ledger sources …) stops the page here instead of
 * rendering a looser screen (v1 recommendation, empty grid). The message is the loader's, so Admin knows which read.
 * PRD v6 R163: in the v6 frame (the class `.page` it used did not exist), with the two actions named: reload, or back to
 * the role's first page; the word "gagal-tertutup" is the glossary's ("halaman tidak dimuat sebagian").
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="v4 v6">
      <main id="isi" className="v4-main v6-main" data-app-error>
        <h1 className="hl">Halaman tidak bisa dimuat</h1>
        <p className="hl-note">Data yang dibutuhkan halaman ini gagal dibaca, jadi halaman tidak dimuat sebagian.</p>
        <p className="ts-err" role="alert">{error.message || "Kesalahan server"}{error.digest ? ` (kode ${error.digest})` : ""}</p>
        <div className="actionbar" style={{ marginTop: 12 }}>
          <button type="button" className="v4b primary" onClick={reset}>Muat ulang</button>
          <a className="v4b" href="/">Kembali ke halaman awal</a>
        </div>
      </main>
    </div>
  );
}
