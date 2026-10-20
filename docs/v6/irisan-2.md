# PRD v6 irisan 2 — halaman membaca snapshot

Isi: R120, R121, `docs/v6/loaded-map.md`. Flag `v6_snapshot_read` (Admin dulu; semua role sesudah 2 hari tanpa `tile-err`).

- `weekContext()` (`lib/page.ts`): minggu dari `RequestContext`, hasil dari `weekResultFor` (`lib/week-result.ts`) dan rilis terakhir
  dalam satu putaran paralel. Flag hidup: satu baca `week_snapshot`. Tidak ada snapshot / snapshot lebih tua dari `update_date`
  minggu: dihitung sekali dengan klien servis dan snapshot ditulis (K80), baris sumber menulis "snapshot belum ada, dihitung
  langsung". Flag mati: jalur sebelum v6.
- Loader bersama halaman dan builder (`Kas`, `Komersial`, `Bulanan`, master) memakai `weekResultOf(sb, …)`; hasil halaman
  dibagi ke loader lain di request yang sama (`primeWeekResult`), jadi snapshot dibaca sekali per request.
- R121: `Server-Timing: auth;dur=` dari middleware; `ctx` dan `data` dicatat per request (`[timing] /w/<minggu> ctx;dur=…,data;dur=…
  source=snapshot`) karena Server Component tidak bisa menulis header.
- Ukuran: snapshot minggu contoh 1,45 MB; parse + decode ≈ 66 ms, compute ≈ 91 ms di mesin agen (tanpa 15 query dan paginasi
  `gl_line`). Bila perlu lebih kecil: kompres atau buang `prepared.gl` dari snapshot (butuh keputusan, K77 menyebut "utuh").

Tes: `lib/week-result.test.ts`, `lib/rebuild-client.test.ts` (aturan klien diperluas ke `weekResultOf`/`salesDemandStatus`).
Belum: T30 di stack e2e (jumlah query per halaman dari log request mock) — stack e2e butuh PostgREST + Chromium; tidak dijalankan
di sesi ini.
