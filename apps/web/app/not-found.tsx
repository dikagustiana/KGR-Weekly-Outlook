import Link from "next/link";

/**
 * The 404 page: every `notFound()` (a page a role does not open, a week or SKU that does not exist) and every unknown route
 * landed on Next's English default ("404: This page could not be found."). Bahasa Indonesia, one way back; the status stays
 * 404, so the e2e matrix (role × page) reads it as before (review v5.3 N7).
 */
export default function NotFound() {
  return (
    <main className="page" data-not-found="">
      <h1>Halaman tidak ada atau bukan untuk peran Anda</h1>
      <p>Alamat ini tidak dikenal, atau peran Anda tidak membuka halaman ini. Minggu atau SKU yang diminta mungkin juga belum dibuat oleh Admin.</p>
      <p><Link href="/">Ke halaman awal peran Anda</Link></p>
    </main>
  );
}
