# F7 — Rilis bulanan, PDF, mobile, management view v3 (desain 1 halaman)

Acuan: PRD v3 §3 (rilis bulanan), §6 (management view mingguan wajib: Input dan COGS), §8 "Semua"; PLAN Fase 7. Tanpa migrasi baru.

## Rilis bulanan

Versi V1 / V2 / FINAL (F4b) = snapshot JSON terkunci + SHA-256 (`month_outlook_version`). F7 menambah:
`/api/m/[month]/pdf` (2 halaman A4 landscape, pdfmake, pola `lib/pdf.ts`: ringkasan + per hari; versi + bridge + akurasi + penyesuaian + asumsi; `?version=` = dari snapshot terkunci, tanpa = data mart saat ini) dan `/api/m/[month]/snapshot.json?version=` (JSON tersimpan, header `X-Snapshot-SHA256`). Tautan di `/m/[month]` (Unduh PDF; PDF/JSON per versi).

## Management view mingguan (PRD v3 §6)

Engine `management.ts`: `inputSummary` (LB kg/Rp aktual + rencana, trading, ekspedisi, maklon, overhead, biaya/kg LB), `cogsBySegment` (P&L proyeksi minggu ÷ kg proyeksi: RPA = LB main + by-product vs COGS - Live Bird; Trading; COGS lain), `rollForward` (ledger M2: awal + masuk − keluar − blast ± penyesuaian = akhir, vs neraca), `urgentStock`, `demandTotals`.
Web `lib/v3/management.ts` + `components/v3/ManagementV3.tsx`: headline + (outlook bulan vs budget — M4, kas terendah 13 minggu — M6, SKU jual hari ini + Rp — M7) dan seksi; `OutlookBody` dipecah menjadi bagian, urutan manajemen = headline → segmen → keputusan RPA + batch → **Input** → **COGS** (+ grup SKU M1, roll-forward M2) → trading → stok → kas (+ M6) → demand (M3) → akurasi (M4) → peringatan → laporan keuangan. **Input dan COGS selalu ada** (dari hasil engine minggu itu); seksi lain hanya bila modulnya on untuk peran itu. Tampilan penyusun dan cetak tidak berubah (diuji: HTML identik dengan sebelum refactor; urutan v3 diuji di `components/OutlookBody.test.tsx`).

## Mobile

`/sku`, `/komersial`, `/m/[month]` baca-saja di layar < 760 px: form tulis (opname/blast, kunci versi, budget) memakai kelas `desktop-only` yang sudah ada; tabel lebar menggulir di dalam kartunya (aturan C6). Tampilan manajemen tidak menampilkan email (versi bulanan: "dikunci").

## Lain

`docs/handover.md` §4a ritme harian v3 (cost_accounting, commercial_lead, cut-off 14:00, upload kas, tutup buku bulanan) dan peran baru; `docs/v3/SUMMARY.md`.

## Yang bisa merusak v1 dan pencegahannya

| Risiko | Pencegahan |
| --- | --- |
| Refactor `OutlookBody` mengubah tampilan v1 | render HTML penyusun / manajemen / cetak tanpa slot v3 dibandingkan dengan versi lama: identik (uji sekali saat refactor); uji urutan permanen |
| Snapshot mingguan | tidak berubah (`pnpm snapshot:diff` EMPTY) — seksi baru hanya tampilan |
