"use client";
/**
 * K56 (R41): a loader that cannot read (flags, release context, ledger sources …) stops the page here instead of
 * rendering a looser screen (v1 recommendation, empty grid). The message is the loader's, so Admin knows which read.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page" data-app-error>
      <h1>Halaman tidak bisa dimuat</h1>
      <p>Data yang dibutuhkan halaman ini gagal dibaca, jadi halaman tidak ditampilkan sebagian (gagal-tertutup).</p>
      <p className="reason">{error.message || "Kesalahan server"}{error.digest ? ` (kode ${error.digest})` : ""}</p>
      <button type="button" onClick={reset}>Coba lagi</button>
    </main>
  );
}
