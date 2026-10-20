# PRD v6 — KGR Weekly Outlook: performa, UI/UX, aksesibilitas

Oct 19, 2026 · @Dika

## Ringkasan dan cara baca

PRD v6 memindahkan seluruh perhitungan minggu dari jalur request ke rebuild worker ("hitung sekali, baca banyak"), menetapkan satu grammar UI untuk semua halaman, dan menaikkan app ke WCAG 2.1 AA. Rumus engine tidak berubah satu sel pun; parity 17.161 sel tetap menjadi gate.

Tiga masalah yang diselesaikan, dengan akar masalah yang sudah diverifikasi dari kode dan log produksi:

1. **Lambat.** `weekContext()` memuat 15 tabel plus `gl_line` sebulan dan menjalankan engine penuh di setiap request untuk 23 halaman; auth dicek dua kali lewat jaringan; Vercel di Tokyo, database di Seoul; tidak ada loading state. Satu halaman Komersial membutuhkan \~1,8 detik waktu server untuk \~18 panggilan Supabase.
2. **Tidak profesional.** Dua stylesheet dan dua generasi halaman hidup bersamaan; angka utama kartu salah pilih (revenue, bukan GP; ekuitas nominal, bukan rasio); headline mencetak angka ganda; kartu "Siap rilis: ya" di layar yang menolak rilis; kode spesifikasi (C50, K35, O8) bocor ke user.
3. **Tidak aksesibel.** Kontras teks muted v1 3,55:1; border input 1,25:1; input grid tanpa nama; hasil simpan tidak diumumkan; drawer tanpa focus trap; header 9 baris di HP sebelum angka pertama.

| Butir | Isi |
| --- | --- |
| Owner | Dika (Group Project Finance, SAMB) |
| Repo | `dikagustiana/KGR-Weekly-Outlook`, basis `main` `cb50a4c` (merge PR #73) |
| Database | KGR-OS `pczjhmzpkknzkziipvit` (ap-northeast-2), `schema_version()` 5.2.6; perubahan hanya lewat bagian B |
| Hosting | Vercel `kgr-weekly-outlook`, region `hnd1` |
| Mengamendemen | PRD v4 §5 (grammar visual), v5 §6 (layar), v5.2-A (kode), v5.2-B (DB), v5.3 |
| Penomoran | Keputusan K77+, kode R119+, database B-R119+, tes T29+, pertanyaan terbuka Q-v6-n. Flag baru `v6_*`, admin saja sampai sign-off per irisan. |
| Bukti | Log Supabase 19 Okt 2026 (24 jam), `pg_stat_user_tables` KGR-OS, screenshot e2e `docs/v5.2/bukti/a6`, `a7`, kode di `apps/web` |

Cara baca untuk agen coding:

- Bab Keputusan (di dalam tiap bagian A–I, ID K) mengikat. Butir Q-v6-n dibangun di belakang parameter dan tidak difinalkan.
- Bagian A dikerjakan lebih dulu dan menjadi prasyarat C. Bagian D–F boleh paralel dengan A di cabang sendiri karena tidak menyentuh loader.
- Aturan v5.2-A Bab 4, v5.2-B, dan REVIEW-CONTEXT §3 berlaku penuh: backup sebelum setiap perubahan KGR-OS, flag hanya dengan persetujuan Dika, CI hijau, berhenti di akhir tiap irisan untuk sign-off.
- Konvensi angka: titik ribuan, koma desimal, "jt", minus U+2212.
- Setiap R menyebut file yang disentuh. Setiap T menyebut cara ukur dan angka lolosnya. Angka target yang belum diukur diberi label "estimasi".

## Bukti

Semua temuan di bawah diukur, bukan diperkirakan; sumbernya disebut per baris supaya agen bisa mengulang pengukurannya sebelum dan sesudah perubahan.

### Performa (log Supabase KGR-OS, 24 jam sampai 19 Okt 2026 19.40 WIB)

| Ukuran | Nilai | Sumber |
| --- | --- | --- |
| Panggilan REST | 10.026; p50 origin 43 ms, p90 97 ms; waktu DB p50 3 ms | `edge_logs`, `response.origin_time`, `x_envoy_upstream_service_time` |
| Panggilan `auth/v1/user` | 1.180; p50 141 ms, p90 382 ms | `edge_logs` |
| Rasio REST : getUser | 8,5 : 1 (≈ 17 REST per tampilan halaman karena getUser 2× per request) | hitung dari dua baris di atas |
| Per sesi, jendela 5 detik | median 38 panggilan, rentang 2,6 detik; p90 145 panggilan, 4,8 detik | bucketing `session_id`, perkiraan kasar |
| Satu render Komersial | 18 panggilan, 7 pertama berurutan @ \~110 ms, total \~1,8 detik server | trace sesi `8e5e9233…` 12.40.56–58 UTC |
| Set query yang sama berulang | 3× dalam 4,5 detik di satu sesi | trace yang sama; penyebab belum dipastikan (Q-v6-1) |
| Region | Vercel `hnd1` (Tokyo) ↔ Supabase `ap-northeast-2` (Seoul); user di Bandung/Jakarta | `vercel.json`, `list_projects` |
| Ukuran data | `gl_line` 6.211, `audit_log` 12.953, `upload_row` 4.373, tabel operasional lain < 1.300 baris | `pg_stat_user_tables` |

### Kode (apps/web, basis `cb50a4c`)

| Temuan | Lokasi |
| --- | --- |
| Compute penuh per request: `loadWeek` 15 tabel + `gl_line` → `computeWeek` | `lib/data.ts:86-238`, dipanggil `weekContext` di 23 halaman |
| `fetchAll` memaginasi 1.000 baris berurutan | `lib/data.ts:27-36` |
| `getUser()` di middleware dan lagi di `getViewer()` | `middleware.ts:22`, `lib/session.ts:17` |
| `week` dan `app_setting` dibaca dua kali per request dengan query berbeda | `lib/page.ts`, `lib/modules-read.ts`, `v5CostingSetting` |
| 54 halaman `force-dynamic`, 0 `loading.tsx`, 0 `Suspense` di level tile | `app/**` |
| Dua stylesheet global dimuat di semua halaman | `app/globals.css` (v1, 13 px, radius 6) dan `app/v4.css` (v4, 14 px, radius 10) |
| Halaman v1 dirender di dalam `V4Frame` dengan kelas v1 | `components/Shell.tsx:60-80`; contoh `w/[week]/upload`, `neraca`, `laba-rugi`, `input/harga` |
| 16 flag modul × 10 role; cabang v4/v5 per halaman | `lib/modules-core.ts`, `app/w/[week]/rencana/v4.tsx` + `v5.tsx`, `app/komersial/v4.tsx` |
| Headline mencetak NIBT dua kali tanpa cek kesamaan | `lib/v5/pl-tiles.ts:221` |
| "Siap rilis" dibaca dari grid kelengkapan, headline dari `input_task` | `lib/v5/input-data.ts:403` vs headline Input |
| Keputusan harga LB lewat `window.confirm` | `components/ActionForm.tsx:29` |
| Drawer `aria-modal` tanpa focus trap dan `inert` | `components/v4/CaraHitung.tsx` |
| Seluruh kartu adalah `<Link className="cover">` tanpa afordans | `components/v4/Card.tsx:46` |
| `ROLE_LABEL` campur bahasa | `lib/roles.ts:10-21` |
| `parseNumber`: titik dengan tepat tiga digit = ribuan (`0.725` → 725) | `packages/parsers/src/values.ts:54` |
| 74 `placeholder` sebagai pengganti label; input angka `type="text"` tanpa `inputMode` | `grep placeholder=` di `app`, `components` |
| Live region hanya di 6 tempat (UploadPanel, TilePage error, satu banner); `ActionForm` tanpa `role="status"` | `components/v5/UploadPanel.tsx`, `components/ActionForm.tsx` |
| `error.tsx` memakai kelas `.page` yang tidak ada di CSS | `app/error.tsx` |

### Kontras (dihitung dari token CSS)

| Pasangan | Rasio | Syarat | Hasil |
| --- | --- | --- | --- |
| v4 muted `#69707d` / surface `#ffffff` | 4,98 : 1 | 4,5 : 1 | lolos |
| v4 muted / bg `#f4f5f7` | 4,57 : 1 | 4,5 : 1 | lolos tipis |
| v1 `--ink-3` `#7a8396` / bg `#f6f7f9` | 3,55 : 1 | 4,5 : 1 | gagal |
| v1 `--ink-3` / white | 3,81 : 1 | 4,5 : 1 | gagal |
| v4 border input `--line` `#e3e6eb` / white | 1,25 : 1 | 3 : 1 (non-text) | gagal |
| v4 accent `#0f6cbd` / white | 5,38 : 1 | 4,5 : 1 | lolos |
| v4 bad `#c4314b` / white | 5,40 : 1 | 4,5 : 1 | lolos |

### Layar (screenshot e2e `docs/v5.2/bukti/a6`, data fixture)

- 1366 px: nav terpotong di Komersial ("Ap"), PPIC ("In"), Kas (sliver); headline konteks dan headline temuan berbobot sama; celah \~60 px di bawah headline; tile kosong setinggi 300 px (Kas, 4 dari 6 area).
- 390 px: 9 baris kontrol sebelum headline; angka pertama di y≈690; halaman Minggu ini setinggi 6.405 px (≈ 8 layar); unit "Rp jt" terpotong di kartu dua kolom.
- Upload v1 di frame v4: banner krem, input file native, kolom SHA-256, nama tabel mentah (`supplier_invoice`), status `committed`, paragraf berkata "idempotent".
- Input v5 (Sales): paragraf dampak diulang 4×; kode C50/C56/C38/K32/O8 di kalimat kerja; "lolos" berwarna link; kartu "tidak ditampilkan"; catatan "belum dibangun" di production.
- Kartu Outlook minggu: angka besar = revenue, GP di baris kecil. Kartu Solvabilitas: ekuitas nominal besar, "modal disetor 36%" kecil. Kartu Kas: "tanpa pinjaman afiliasi −910,3 jt" kecil.
- Δ GP vs minggu lalu 293,9 vs selisih angka tampil 294,0 (delta dihitung dari desimal penuh).

## Tujuan, non-tujuan, metrik

Selesai berarti tujuh angka di bawah tercapai di production dengan user sungguhan, bukan di fixture.

| ID | Metrik | Sekarang | Target | Cara ukur |
| --- | --- | --- | --- | --- |
| M1 | Panggilan Supabase per tampilan halaman (median, semua halaman) | ≈ 17 | ≤ 4 | `edge_logs` per `session_id` per jendela 5 detik, sesudah 1 minggu pemakaian |
| M2 | Waktu server halaman Minggu ini dan Komersial (p50) | \~1,8 s (trace) | ≤ 400 ms (estimasi) | header `Server-Timing` yang ditambahkan R121, dibaca dari Vercel logs |
| M3 | Waktu sampai headline terlihat di HP (390 px, 4G) | tidak terukur; layar diam sampai HTML utuh | ≤ 1,5 s, dan skeleton tampil ≤ 300 ms | Lighthouse mobile di `/minggu-ini/<week>` dengan sesi login (T31) |
| M4 | Posisi angka pertama di 390 px | y ≈ 690 | y ≤ 300 | screenshot A6 390 px, baca `data-tile-value` pertama |
| M5 | Pelanggaran axe-core serius/kritis | tidak diukur (perkiraan > 20) | 0 | `@axe-core/playwright` di journey A6 |
| M6 | Halaman yang memakai `globals.css` v1 | 23 | 0 (stylesheet tunggal) | `grep className="card"\|table.t` = 0 di `app/` |
| M7 | Teks user yang memuat kode spesifikasi (`C\d\d`, `K\d\d`, `O\d`) di luar drawer "cara hitung" | > 40 kemunculan | 0 | lint `scripts/lint.py` aturan baru K-K43 (R135) |

Tujuan kualitatif yang diuji manual (bagian J): satu penyusun sungguhan mengisi harga satu minggu tanpa bertanya, dan Direktur Operasional membaca keputusan harga LB dari HP tanpa membuka tabel.

Non-tujuan v6:

- Tidak mengubah rumus engine, mart, atau skema costing (v5.3 tetap otoritas untuk rumus).
- Tidak mengganti palet, tipografi, atau token v4; tidak ada restyle, grain, animasi dekoratif, atau ganti font.
- Tidak migrasi framework atau library (Next 15.5, React 19, `@supabase/ssr` 0.12 tetap).
- Tidak membangun fitur baru selain dialog keputusan dan komponen status, yang keduanya pengganti elemen yang ada.
- Migrasi region Supabase ke Singapura disebut sebagai opsi (Q-v6-3), bukan bagian dari v6.

## Pengguna dan skenario

Dua populasi dengan kebutuhan berlawanan memakai satu app: pembaca (manajemen, dari HP, beberapa menit per hari) dan penyusun (tujuh role, dari laptop, berjam-jam per minggu). v6 memberi keduanya shell yang sama tetapi default layar yang berbeda.

| Role (`lib/roles.ts`) | Perangkat utama | Tugas inti tiap minggu | Layar awal v6 | Yang sekarang menghalangi |
| --- | --- | --- | --- | --- |
| management (Pak Jo, Bu Lenny) | HP, link WhatsApp | Baca GP minggu ini, kas terendah, keputusan yang menunggu | Minggu ini | Header 9 baris; angka utama kartu salah; kartu kas menyembunyikan kekurangan afiliasi |
| operations\_director | HP dan laptop | Putuskan harga LB harian; lihat simulasi | Minggu ini (tile keputusan di atas) | `window.confirm` tanpa detail keputusan; simulasi pakai angka contoh (V4 v5.3) |
| finance | Laptop | Rilis mingguan, beban tetap, kas (Sheet), tutup buku | Input (Finance) | Upload v1 bergaya lama; "Siap rilis" bertentangan dengan headline; kode C55 di kartu |
| cost\_accounting | Laptop | WP potong per batch, costing final | Input (Cost Accounting) | Grid input tanpa label; angka pakai keyboard teks |
| inventory\_accounting | Laptop | Jurnal Accurate harian, kartu stok | Input (Inventory Accounting) | Wizard upload v1: SHA-256, nama tabel mentah, status `committed` |
| ppic | Laptop | Demand → rencana mingguan → harian → alokasi | Rencana (langkah aktif) | Stepper dan kartu per kelas terbaca rapat; nav terpotong |
| commercial\_lead (Kepala Sales) | Laptop dan HP | Kunci komitmen, price list, approval diskon, penugasan | Komersial | Dua headline bersaing; tile kosong setinggi tile berisi |
| sales | HP dan laptop | PO harian, komitmen, upload | Input (Sales) | Paragraf dampak diulang 4×; kode C50/K32; "lolos" seperti link |
| purchasing | Laptop | Supply LB, harga beli pengganti | Input (Purchasing) | Sama dengan cost\_accounting |
| admin | Laptop | Minggu, pengguna, flag, audit | Admin | "Lihat sebagai" memenuhi header semua role |

Skenario yang menjadi tes penerimaan (bagian J, T37–T40):

1. **Senin 06.30, HP.** Bu Lenny membuka link Minggu ini. Dalam satu layar tanpa scroll: headline, GP minggu, kas terendah tanpa afiliasi, dan jumlah keputusan menunggu. Satu ketukan membuka tabel P&L.
2. **Senin 08.00, laptop.** Finance membuka Input. Daftar tugas satu baris per tugas dengan status berwarna; tugas terlambat di atas; satu status kesiapan rilis yang sama dengan headline.
3. **Selasa 09.00, laptop.** Cost Accounting mengisi harga 41 SKU. Keyboard angka di Android, nilai hasil parse tampil di bawah sel, kesalahan format terlihat sebelum simpan, hasil simpan diumumkan.
4. **Rabu 11.00, HP.** Direktur Operasional memutuskan harga LB. Dialog menampilkan harga, volume, dampak GP, dan nama pemutus; keputusan tercatat di audit dengan isi yang sama.

## A — Arsitektur data: hitung sekali, baca banyak (R119–R124, B-R119–B-R121)

Setiap halaman membaca satu baris `week_snapshot` dan mart, tidak pernah memanggil `loadWeek` atau `computeWeek`; perhitungan hanya terjadi di rebuild worker yang sudah ada, dipicu oleh write.

&#91;embedded content: alur data v6 · write → rebuild → snapshot → baca\]

Semua yang menulis input mengantre minggu itu; cron dan worker menghitung dan menulis snapshot; halaman, rilis, dan PDF hanya membaca. Mart harian v5 tetap dibangun oleh worker yang sama.

### Keputusan

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K77 | `WeekResult` disimpan utuh sebagai JSON di `week_snapshot` (satu baris per `week_id` per versi). Halaman membaca snapshot; engine hanya dijalankan oleh `processRebuildQueue` dan rilis. Minggu berstatus `released` atau `closed` tidak pernah dihitung ulang. | Dika | diusulkan |
| K78 | Pemicu rebuild adalah write: setiap server action yang mengubah tabel input minggu (upload commit, parameter, harga, batch, cash\_plan, runrate, stok awal) mengantre `week_id` ke `rebuild_queue` dan memproses inline maksimal satu minggu (aturan 7 tanggal v5.2 tetap untuk mart harian). | Dika | diusulkan |
| K79 | Snapshot menyimpan `engine_version`, `inputs_hash` (sha256 dari seluruh baris input yang dibaca `loadWeek`), dan `built_at`. Halaman menampilkan "dihitung \<jam>" dari `built_at`, menggantikan "dihitung dalam N ms". | Dika | diusulkan |
| K80 | Jika snapshot minggu belum ada (minggu baru, migrasi), halaman memakai jalur lama satu kali, menulis snapshot, lalu jalur lama tidak dipakai lagi untuk minggu itu. Tidak ada fallback diam-diam: baris sumber tile menulis "snapshot belum ada, dihitung langsung". | Dika | diusulkan |
| K81 | Mart v5 (`pl_daily_v4`, `commercial_daily`, `sku_balance_daily`, `lot_balance_daily`) tetap sumber untuk tile v5. Snapshot tidak menggandakan mart; snapshot = hasil `computeWeek` saja. | Dika | diusulkan |

### Requirement kode

| ID | Requirement | File |
| --- | --- | --- |
| R119 | `lib/snapshot.ts`: `readSnapshot(sb, weekId)` mengembalikan `{result, meta}` dari `week_snapshot` versi terbaru; `writeSnapshot(sb, weekId, result, meta)` memakai klien servis. Tipe `WeekResult` tidak berubah. | `apps/web/lib/snapshot.ts` (baru) |
| R120 | `weekContext()` mengganti `computeForWeek` dengan `readSnapshot`; `computed.result` diisi dari snapshot, `computed.loaded` tidak lagi tersedia di jalur request. Semua pemakaian `ctx.computed.loaded.db.*` di 23 halaman dipetakan ke pembacaan tabel langsung yang sempit (hanya kolom yang dipakai halaman itu) atau dihapus bila hanya untuk tampilan. Daftar pemetaan ditulis di `docs/v6/loaded-map.md` sebelum kode. | `apps/web/lib/page.ts`, `app/w/[week]/**` |
| R121 | Header `Server-Timing` di setiap halaman: `auth;dur=`, `ctx;dur=`, `data;dur=`, `render;dur=`. Dipakai M2 dan tes T30. | `apps/web/lib/timing.ts` (baru), `middleware.ts` |
| R122 | `processRebuildQueue` memanggil `loadAndCompute` lalu `writeSnapshot` untuk setiap `week_id` di antrean; `inputs_hash` dibandingkan: hash sama → tidak tulis ulang, status `done (unchanged)`. | `apps/web/lib/rebuild.ts` |
| R123 | `fetchAll` di rebuild worker memakai `size = 5000` (PostgREST `max-rows` dinaikkan di B-R121) dan paginasi paralel bila `count` diketahui (`select ... , count: 'exact'` satu kali, lalu `Promise.all` halaman). Jalur request tidak memakai `fetchAll` sama sekali. | `apps/web/lib/data.ts` |
| R124 | `release.ts`: rilis membekukan snapshot versi terakhir (`release.snapshot_id`), bukan menghitung ulang. PDF dan `snapshot.json` dibaca dari snapshot yang sama. | `apps/web/lib/release.ts`, `app/api/w/[week]/pdf/route.ts`, `snapshot.json/route.ts` |

### Requirement database

| ID | Requirement |
| --- | --- |
| B-R119 | Tabel `week_snapshot(id uuid, week_id uuid fk, version int, engine_version text, inputs_hash text, result jsonb, built_at timestamptz, built_by text)`; unik `(week_id, version)`; indeks `(week_id, version desc)`. RLS: baca untuk semua role aktif, tulis hanya service role. |
| B-R120 | `release.snapshot_id uuid` fk ke `week_snapshot`; migrasi mengisi dari snapshot pertama yang dibangun sesudah deploy (satu kali, lewat rebuild semua minggu `released`). |
| B-R121 | PostgREST `max-rows` 1000 → 5000 di config project (bukan migrasi SQL; dicatat di `docs/v5.2/kgr-os-log.md`). |

### Ukuran dampak (estimasi, dikonfirmasi T30)

| Halaman | Query sekarang | Query sesudah A | Keterangan |
| --- | --- | --- | --- |
| Minggu ini (management) | \~18 + mart | 1 snapshot + 3 mart + konteks | tile status putaran tetap 5 query paralel |
| Neraca, Laba Rugi, Arus Kas, Stok | 15 tabel + `gl_line` paginasi | 1 snapshot | halaman murni tampilan |
| Input harga / parameter | 15 tabel + `gl_line` + tabel input | tabel input + snapshot (untuk acuan) | `loaded.db.prices` → `sku_price` langsung |
| Rilis | compute + unggah | baca snapshot + RPC | V7 v5.3 ikut selesai |

## B — Request context, auth lokal, region (R125–R129)

Satu request membaca identitas, flag, daftar minggu, dan status skema sekali, secara paralel, tanpa panggilan jaringan ke GoTrue; rantai tujuh panggilan berurutan di awal setiap halaman hilang.

### Keputusan

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K82 | Middleware memverifikasi sesi dengan `supabase.auth.getClaims()` (JWT ES256, verifikasi lokal dengan JWKS yang di-cache), bukan `getUser()`. `getUser()` hanya dipanggil di `/auth/callback` dan di server action yang mengubah akun (`/akun`, `/admin/pengguna`). | Dika | diusulkan |
| K83 | `RequestContext` adalah satu objek per request (`React.cache`): `viewer`, `settings`, `weeks`, `schema`, `view`, `today`. Semua halaman dan `Shell` membacanya; tidak ada halaman yang memanggil `requireViewer`, `moduleSettings`, `weeksCached`, atau `schemaStatus` sendiri. | Dika | diusulkan |
| K84 | Vercel `regions` diganti ke `icn1` (Seoul) sekarang, satu lokasi dengan KGR-OS. Migrasi keduanya ke Singapura adalah keputusan terpisah (Q-v6-3) karena memerlukan project Supabase baru. | Dika | diusulkan |

### Requirement

| ID | Requirement | File |
| --- | --- | --- |
| R125 | `middleware.ts`: `getClaims()` menggantikan `getUser()`; redirect ke `/login` bila klaim tidak valid atau kedaluwarsa; refresh token tetap ditangani `@supabase/ssr` lewat `setAll`. Tes: sesi kedaluwarsa → `/login?next=`, bukan 500. | `apps/web/middleware.ts` |
| R126 | `lib/request-context.ts`: `getRequestContext()` memuat `app_user` (by email dari klaim), `app_setting` (semua kunci, satu query), `week` (satu query `select *`), `schema_version()` dengan `Promise.all`; `getViewer`, `moduleSettings`, `weeksCached`, `schemaStatus`, `v5CostingSetting` menjadi pembungkus tipis di atasnya (tidak ada query tambahan). | `apps/web/lib/request-context.ts` (baru), `lib/session.ts`, `lib/modules.ts`, `lib/modules-read.ts`, `lib/page.ts`, `lib/schema-session.ts` |
| R127 | `app/page.tsx`: redirect dihitung dari `RequestContext` tanpa query tambahan; tujuan redirect ditulis ke cookie `kgr_home` (30 hari) sehingga kunjungan berikutnya ke `/` menjadi redirect 307 dari middleware tanpa render. | `apps/web/app/page.tsx`, `middleware.ts` |
| R128 | Hapus pembacaan ganda: `week?select=update_date` dan `app_setting?key=eq.v5_costing` tidak boleh muncul di `edge_logs` sesudah deploy (T30 memeriksa). | `lib/v5/*`, `lib/v4/*` |
| R129 | `vercel.json` `regions: ["icn1"]`; `NEXT_PUBLIC_SUPABASE_URL` tidak berubah. Catatan di `docs/handover.md`. | `apps/web/vercel.json` |

### Anggaran latensi per halaman sesudah A dan B (estimasi dari log, dikonfirmasi T30)

| Tahap | Sekarang | Sesudah |
| --- | --- | --- |
| Middleware auth | 141 ms p50 (jaringan) | < 5 ms (verifikasi lokal) |
| Konteks (viewer, flag, minggu, skema) | 4 panggilan berurutan ≈ 440 ms | 1 putaran paralel ≈ 60 ms (Seoul↔Seoul ≈ 10–20 ms per panggilan) |
| Data halaman | 10–15 panggilan, sebagian berurutan ≈ 1.000 ms | 1 snapshot + ≤ 3 mart paralel ≈ 80 ms |
| Total server | ≈ 1.800 ms | ≈ 150–250 ms |

## C — Streaming, loading state, anggaran waktu (R130–R133)

Layar tidak pernah diam: shell dan skeleton tile tampil sebelum data, headline dan kartu tiba lebih dulu, tabel menyusul; tiap tile menampilkan empat keadaan (memuat, kosong, gagal, terisi) dengan bentuk yang sama.

| ID | Requirement | File |
| --- | --- | --- |
| R130 | `loading.tsx` di `app/(v6)/` (segmen rute bersama semua halaman v6): shell dari `RequestContext` plus `TileSkeleton` yang membaca `layout` tile halaman tujuan (posisi dan ukuran sama dengan tile sebenarnya, teks diganti blok abu-abu). Skeleton tidak beranimasi. | `apps/web/app/(v6)/loading.tsx`, `components/v6/TileSkeleton.tsx` |
| R131 | `TilePage` membungkus setiap tile dalam `<Suspense fallback={<TileSkeleton pos>}>`; loader tile (`tileData`) dipanggil di dalam komponen tile, bukan dikumpulkan di `loadMingguIni` sebelum render. Urutan prioritas: headline dan kartu baris pertama tanpa Suspense (data dari snapshot, sudah ada), tabel dan chart di Suspense. | `components/v4/TilePage.tsx`, `lib/v5/management-data.ts`, `lib/v4/minggu-ini-data.ts` |
| R132 | Empat keadaan tile dengan komponen yang sama: `memuat` (skeleton), `kosong` (satu baris teks + tautan tindakan, tile menyusut ke `min-height` 76 px, lihat E), `gagal` (teks merah + tombol "Muat ulang" yang memanggil `router.refresh()` untuk tile itu saja), `terisi`. Tidak ada tile yang menampilkan "tidak ada data untuk periode ini" setinggi 300 px. | `components/v6/TileState.tsx`, `v4.css` |
| R133 | Navigasi: `<Link prefetch={false}>` untuk semua tautan ke halaman dinamis (sampai Q-v6-1 dijawab); indikator progres tipis 2 px di atas shell saat transisi (`useLinkStatus` / `NavigationProgress`), sehingga klik menu selalu memberi umpan balik ≤ 100 ms. | `components/v6/Shell.tsx`, `components/v6/NavProgress.tsx` |

Anggaran waktu yang diuji T31 (HP 390 px, throttling 4G Lighthouse):

| Momen | Target |
| --- | --- |
| Skeleton tampil (first contentful paint) | ≤ 300 ms sesudah respons pertama |
| Headline dan kartu baris pertama terbaca | ≤ 1,5 s |
| Tabel dan chart terisi | ≤ 2,5 s |
| Klik menu → indikator progres | ≤ 100 ms |

## D — Shell dan navigasi (R134–R138)

Header dua tingkat di desktop (konteks di atas, tab halaman di bawah), satu baris di HP (brand, minggu, menu), dan headline halaman selalu berada di 150 px pertama layar HP.

### Keputusan

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K85 | Tiga konsep dipisah: **konteks** (minggu, akun, keluar) di baris atas; **halaman** (tab per role, maksimal 7, aturan v4 §5.4 tetap) di baris bawah; **Lihat sebagai** (preview role, hanya admin dan role yang boleh toggle) pindah ke menu akun, bukan di nav. | Dika | diusulkan |
| K86 | Pemilih minggu satu komponen sendiri (`WeekPicker`): tombol "Minggu 24–30 Agu · rilis" membuka daftar minggu dengan status; menggantikan `<select>` native dan chip "Minggu 24–30 Agu" di badan halaman (chip dihapus). | Dika | diusulkan |
| K87 | Headline halaman adalah satu kalimat temuan. Konteks cut-off ("28 Agu · 17.00. Cut-off pembelian LB 12.00") turun jadi satu baris `note` di bawah headline, bukan headline kedua. | Dika | diusulkan |
| K88 | Baris rilis ("Rilis 28 Agu 2026 · 19/20 kontrol lulus · Unduh PDF") menyatu ke baris konteks di desktop dan ke menu di HP. Tidak ada elemen di atas headline selain shell. | Dika | diusulkan |

### Requirement

| ID | Requirement | File |
| --- | --- | --- |
| R134 | `components/v6/Shell.tsx` menggantikan `Shell.tsx` dan `V4Frame`: `<header>` dengan dua `<div>` (konteks, tab), `<nav aria-label="Halaman">` dengan `aria-current="page"`, `<main id="isi">`. Skip link "Lewati ke isi" sebagai elemen pertama `<body>`, terlihat saat fokus. | `components/v6/Shell.tsx`, `app/layout.tsx` |
| R135 | Lebar: tab tidak pernah `overflow-x: auto` di desktop; bila jumlah tab melebihi ruang, tab ke-6 dan seterusnya masuk menu "Lainnya" (`<details>`), diuji T33 di 1280 dan 1366 px untuk semua role. | `components/v6/Shell.tsx`, `v6.css` |
| R136 | HP (≤ 899 px): baris tunggal brand · `WeekPicker` ringkas ("24–30 Agu") · tombol menu. Menu = `<dialog>` native dengan tab halaman, akun, Lihat sebagai (bila boleh), rilis dan PDF, keluar. Tinggi header ≤ 56 px + safe-area. | `components/v6/Shell.tsx`, `components/v6/MobileMenu.tsx` |
| R137 | `WeekPicker`: `<button aria-haspopup="listbox" aria-expanded>` + `<ul role="listbox">`; panah atas/bawah memindah fokus, Enter memilih, Esc menutup; label minggu memakai `tgl()` panjang untuk management, pendek untuk penyusun (aturan R11 v2 tetap). | `components/v6/WeekPicker.tsx` |
| R138 | Halaman Minggu ini di HP: urutan DOM = headline → kartu keputusan → kartu GP → kartu kas → sisa; tombol "Unduh PDF" di menu; chip "Aktual s.d. kemarin / Proyeksi minggu" tetap, di bawah headline. Diukur M4: `data-tile-value` pertama di y ≤ 300. | `lib/v5/management.ts`, `lib/v4/minggu-ini.ts` |

### Tata letak header desktop (≥ 900 px)

| Baris | Kiri | Tengah | Kanan |
| --- | --- | --- | --- |
| Konteks (40 px) | KGR · `WeekPicker` | Rilis 28 Agu · 19/20 kontrol · PDF | Nama · Role · menu akun |
| Tab (40 px) | Minggu ini · Outlook bulan · Kas · … (≤ 7) |  |  |

## E — Grammar komponen (R139–R148)

Sembilan komponen v6 menggantikan semua varian v1, v4, dan v5 yang setara; token warna, tipografi, dan spasi v4 (`reference/design/tokens.css`) tetap, yang berubah adalah anatomi dan keadaan tiap komponen.

### Keputusan

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K89 | Kartu (`Card`) punya empat baris tetap: nama metrik → nilai + satuan → satu baris temuan bertone → sumber sebagai ikon ⓘ. Nilai besar selalu metrik yang diputuskan, bukan yang terbesar (GP, bukan revenue; rasio, bukan nominal ekuitas). | Dika | diusulkan |
| K90 | Satu komponen status (`Status`) dengan empat keadaan: `lolos`, `catatan`, `terlambat`, `belum`. Selalu ikon + kata + warna, tidak pernah salah satunya saja. Dipakai di tugas, grid kelengkapan, riwayat upload, kontrol, cek upload. Kosakata lain (`committed`, `masuk, ada catatan`, `LULUS/PERIKSA/GAGAL`) dipetakan ke empat ini di tampilan; nilai di DB tidak berubah. | Dika | diusulkan |
| K91 | Kartu yang bisa dibuka menampilkan chevron dan nama aksesibel "Buka \<nama metrik>"; kartu yang tidak bisa dibuka tidak dibungkus link. | Dika | diusulkan |
| K92 | Input angka: `inputMode="decimal"`, desimal selalu koma, titik hanya ribuan; `parseNumber` menolak titik dengan tepat tiga digit tanpa koma bila nilai < 10 (ambigu) dan sel menampilkan "dibaca: Rp 24.600" saat blur. Aturan dicetak sekali di atas tabel input. | Dika | diusulkan |
| K93 | Keputusan bernilai uang (harga LB, tutup buku, rilis, override) memakai `DecisionDialog`, bukan `window.confirm`. Dialog menampilkan apa yang diputuskan dan dampaknya; tombol utama menyebut keputusan ("Putuskan Rp 25.000"). | Dika | diusulkan |
| K94 | Empty state satu baris: apa yang kosong + tautan tindakan ("Tarif simpan belum ada · isi di Parameter"). Tile menyusut ke 76 px. | Dika | diusulkan |

### Spesifikasi komponen

| ID | Komponen | Anatomi dan perilaku | Aksesibilitas |
| --- | --- | --- | --- |
| R139 | `Card` (`components/v6/Card.tsx`) | Baris 1 `tile-t` nama metrik (13/600 muted). Baris 2 nilai (30/600 tabular) + satuan (13 muted) di baseline yang sama; bungkus satuan ke bawah bila lebar < 200 px, tidak pernah terpotong. Baris 3 temuan ≤ 1 kalimat, tone `plain`/`good`/`warn`/`bad` hanya pada teks temuan, nilai tetap `--text`. Baris 4 ikon ⓘ membuka drawer sumber + cara hitung. Maksimal 3 baris pembanding (`dl`) di antara baris 2 dan 3, aturan v4 tetap. | `section aria-labelledby=<id nama>`; link kartu = `<a aria-label="Buka Outlook minggu">` membungkus hanya nilai + chevron, bukan seluruh kartu; ikon ⓘ `button aria-label="Sumber dan cara hitung Outlook minggu"` |
| R140 | `Status` (`components/v6/Status.tsx`) | `lolos` ✓ hijau, `catatan` ◐ amber, `terlambat` ✕ merah, `belum` ○ muted. Ukuran `sm` (11/600 di sel) dan `md` (13/600 di daftar). Pemetaan dari kosakata lama di `lib/v6/status-map.ts`. | `<span role="img" aria-label="terlambat">` + kata terlihat; kontras ikon ≥ 3:1, teks ≥ 4,5:1 |
| R141 | `Table` (`components/v6/Table.tsx`) | Dari `V4Table`: `nowrap` hanya pada kolom angka; kolom teks `wrap` default; `<caption>` tersembunyi dari `label`; di HP kolom pertama sticky dan tabel ≤ 4 kolom berubah jadi daftar kartu (`data-mobile="cards"`). Baris total `scope="row"`. | `scope` di `th`, `caption`; negatif merah + tanda −, tidak warna saja |
| R142 | `TileState` (`components/v6/TileState.tsx`) | Empat keadaan (bagian C R132). Empty = `<p class="note">` + `<a>` tindakan. Gagal = `role="alert"` + tombol muat ulang. | `aria-busy="true"` saat memuat; pesan gagal menyebut tile |
| R143 | `DecisionDialog` (`components/v6/DecisionDialog.tsx`) | `<dialog>` native, dibuka `showModal()`; isi: judul keputusan, tabel ringkas (harga, volume, dampak GP minggu, pemutus, jam dari `RequestContext.today`), catatan opsional, tombol "Putuskan …" (primary) dan "Batal". Submit = server action yang sama dengan sekarang; audit menyimpan isi tabel ringkas sebagai `payload`. | Focus trap native `dialog`; Esc membatalkan; fokus kembali ke tombol pembuka; `aria-labelledby` judul |
| R144 | `NumberInput` (`components/v6/NumberInput.tsx`) | `type="text" inputMode="decimal" autoComplete="off"`; saat blur menampilkan `<output>` "dibaca: 24.600" atau "tidak terbaca: 0.725, pakai koma untuk desimal"; sel salah mendapat `aria-invalid` dan border merah; submit ditahan bila ada sel salah (client) dan ditolak lagi di server dengan pesan per sel. | `aria-label` wajib ("Harga jual BLD frozen"); `aria-describedby` ke `<output>`; `aria-invalid` |
| R145 | `Drawer` (`components/v6/Drawer.tsx`) | Dari `CaraHitung`: isi dan perilaku tetap, ditambah focus trap (fokus berputar di dalam panel), `inert` pada `<main>` saat terbuka, scroll latar dikunci. Label tombol pembuka unik per tile ("Cara hitung Outlook minggu"). | `role="dialog" aria-modal`, `inert`, Esc, fokus kembali |
| R146 | `ActionForm` | Tambah `<div role="status" aria-live="polite">` untuk `ok` dan `role="alert"` untuk `error`; pesan error menyebut field bila server mengembalikan `field`; tombol submit `aria-disabled` saat pending, teks "Memproses…" tetap. `confirm` dihapus; pemakai `confirm` beralih ke `DecisionDialog`. | 4.1.3, 3.3.1 |
| R147 | `Stepper` | Setiap langkah = `<li>` dengan tiga baris terpisah (nomor, nama, status) baik berupa link maupun bukan; status memakai `Status`. Lebar langkah min 160 px; di HP langkah bertumpuk vertikal. | `aria-current="step"`, `<ol aria-label="Langkah">` |
| R148 | `Headline` | Satu `<h1>` terlihat (menggantikan `h1.sr-only`), 20/600, maks 2 baris di desktop, 3 di HP; teks dari engine, aturan konten F. Baris `note` konteks di bawahnya. | `h1` terlihat; `h2` per tile |

### Token tambahan (satu-satunya perubahan di `tokens.css`)

| Token | Nilai | Alasan |
| --- | --- | --- |
| `--line-input` | `#9aa3b2` | border input 3,1:1 di atas putih (1.4.11); `--line` tetap untuk pemisah |
| `--warn` | `#8a5a00` | tone `warn` (sudah ada di v1 sebagai `--amber`, dipindah ke token v6) |
| `--focus` | `--accent` | ring fokus 2 px, offset 2 px, di semua kontrol termasuk sel tabel dan link kartu |

## F — Konten dan kosakata (R149–R156)

Setiap kalimat yang dibaca user ditulis untuk orang yang mengambil keputusan dari angkanya; kode spesifikasi, nama tabel, dan jargon PRD hanya tampil di drawer "cara hitung".

### Keputusan

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K95 | Satu glosarium `docs/v6/glosarium.md` memetakan setiap istilah internal ke kata user; lint (R156) menolak istilah internal di teks tampilan. | Dika | diusulkan |
| K96 | Label role dan status seluruhnya Indonesia: Manajemen, Direktur Operasional, Keuangan, Akuntansi Biaya, Akuntansi Persediaan, PPIC, Kepala Sales, Sales, Pembelian, Admin. Istilah finance Inggris yang sudah baku (GP, NIBT, COGS, run-rate, outlook) tetap. | Dika | diusulkan |
| K97 | Headline mencetak satu angka per klaim; dua angka yang sama tidak pernah tercetak bersebelahan. Delta ditampilkan dari selisih angka yang tampil (pembulatan dulu, baru kurang), bukan dari desimal penuh. | Dika | diusulkan |
| K98 | Baris akrual yang nol di level periode ("Beban tetap belum dijurnal (estimasi)" −8,7 / +8,7 / 0,0) ditampilkan sebagai memo di bawah tabel manajemen, bukan baris P&L. Di tampilan penyusun tetap baris. | Dika | diusulkan |

### Requirement

| ID | Requirement | File |
| --- | --- | --- |
| R149 | Headline Outlook bulan: `… NIBT Rp X jt menurut jurnal` + (`, Rp Y jt setelah beban tetap` hanya bila Y ≠ X setelah pembulatan 1 desimal) + (`; beban tetap bulan ini belum ada` bila `missing`). | `lib/v5/pl-tiles.ts:221` |
| R150 | Angka utama kartu (lihat G untuk daftar lengkap): Outlook minggu = GP (Rp jt, %), pembanding revenue dan Δ GP; Solvabilitas = ekuitas ÷ modal disetor (%), pembanding ekuitas Rp jt dan utang berelasi ÷ ekuitas (×); Kas terendah = kekurangan kas tanpa afiliasi (Rp jt, tanggal), pembanding saldo dengan afiliasi. | `lib/v5/management.ts`, `lib/v4/minggu-ini.ts`, `lib/v4/kas.ts` |
| R151 | Satu fungsi `releaseReadiness(ctx)` di `lib/v6/readiness.ts` menjadi sumber tunggal "Siap rilis": membaca `input_task` terlambat dan grid kelengkapan, mengembalikan `{ready, reasons[]}`. Kartu dan headline Input memakainya. Kartu memakai `Status`, bukan kata "ya". | `lib/v6/readiness.ts`, `lib/v5/input-data.ts:403` |
| R152 | Daftar tugas: satu baris per tugas = nama · tenggat (`tgl` + jam) · `Status`; kolom dampak dihapus dari tabel, dampak muncul sekali di `note` di atas daftar bila ada tugas bermasalah; baris dapat dibuka (`details`) untuk teks lengkap. Tugas terlambat diurutkan pertama. | `lib/v5/input.ts`, `components/v6/TaskList.tsx` |
| R153 | Kartu yang nilainya kata ("ya", "estimasi", "tidak ditampilkan", "wizard v4") diganti: `Status` untuk keadaan, angka untuk jumlah, atau kartu dihapus bila tidak berlaku untuk role itu. Daftar per kartu di G. | `lib/v5/input-data.ts` |
| R154 | Semua kode spesifikasi (`C\d\d`, `K\d\d`, `O\d+`, `R\d+`, `Q-…`) dipindah dari teks tampilan ke `CaraHitungContent.rule` atau `.sources`; teks tampilan menyebut nama aturan dari glosarium ("ukuran karkas wajib" untuk C50). | `lib/v5/*.ts`, `lib/v4/*.ts` |
| R155 | Catatan backlog ("belum dibangun", "O8") dan artefak dev (SHA-256, nama tabel mentah, `tempelan`, `committed`, "dihitung dalam N ms") dihapus dari tampilan; riwayat upload menampilkan nama file asli, jenis dari glosarium, dan `Status`. | `app/w/[week]/upload/page.tsx`, `lib/v5/input.ts:162` |
| R156 | `scripts/lint.py` aturan baru: (a) regex kode spesifikasi di string JSX dan di `lib/**/*.ts` yang mengembalikan teks tile, kecuali di `CaraHitungContent`; (b) `window.confirm`, `window.alert` dilarang; (c) `placeholder=` tanpa `aria-label` atau `<label>` dilarang; (d) `ROLE_LABEL` hanya dari glosarium. Fixture `scripts/lint-fixtures/v6/`. | `scripts/lint.py` |

### Glosarium awal (dilengkapi agen, ditinjau Dika sebelum merge)

| Internal | Tampilan |
| --- | --- |
| grid kelengkapan | kelengkapan data harian |
| C50 | ukuran karkas wajib di PO |
| C55 | beban tetap tanpa jadwal |
| K35 override | rilis dengan pengecualian |
| gagal-tertutup | halaman tidak dimuat sebagian |
| mart | data harian terhitung |
| committed | tersimpan |
| tempelan | tempel dari Excel |
| supplier\_invoice | faktur pemasok |
| costing\_wp | WP potong |
| STD (ukuran) | ukuran standar 2,0 kg |

## G — Spesifikasi per layar (R157–R163)

Tiap layar disusun dari komponen E dengan aturan F; tabel di bawah menetapkan tile per layar, angka utamanya, dan apa yang dihapus. Posisi grid (x, y, w, h) mengikuti mockup v5 di `reference/design/v5/*.dc.html` kecuali disebut lain.

### R157 — Minggu ini (management, operations\_director, finance)

| Tile | Angka utama | Pembanding | Temuan (baris 3) | Perubahan dari sekarang |
| --- | --- | --- | --- | --- |
| Headline | GP minggu, % GP, kontribusi Trading, stok di atas umur |  |  | tetap, `h1` terlihat |
| Keputusan menunggu (baru, baris pertama) | jumlah keputusan | harga LB hari ini, approval diskon | "Harga LB potong 28/08 belum diputuskan" | menggabungkan `sim-lb` dan `keputusan`; tombol "Putuskan" membuka `DecisionDialog` |
| GP minggu (ganti "Outlook minggu") | GP Rp jt (14,4%) | revenue, Δ GP vs minggu lalu | "di atas / di bawah run-rate" | angka utama GP, bukan revenue |
| Kas terendah | kekurangan tanpa afiliasi Rp jt | tanggal, saldo dengan afiliasi | "butuh afiliasi Rp 1.200 jt sebelum Jumat" | yang kecil jadi besar |
| Stok di atas batas umur | Rp jt | kg, SKU | "13 SKU di bawah biaya" | tetap |
| Outlook bulan | GP bulan Rp jt (%) | revenue, NIBT | vs budget bila ada, bila tidak baris dihapus | "vs budget belum diisi" tidak tampil |
| Solvabilitas | ekuitas ÷ modal disetor % | ekuitas Rp jt, utang berelasi ÷ ekuitas × | "utang afiliasi 3,1× ekuitas" | rasio jadi angka utama; "bulan sampai ekuitas negatif" hanya bila berlaku |
| Laba rugi | tabel per minggu, toggle Actual vs run-rate / Per minggu |  |  | tambah toggle segmen RPA / Trading (data sudah ada di engine); baris akrual nol jadi memo (K98) |

### R158 — Outlook bulan (management, finance)

| Tile | Perubahan |
| --- | --- |
| Headline | R149 (tidak ada angka ganda) |
| Actual s.d. tanggal, Forecast sisa bulan, Outlook | angka utama GP, pembanding revenue dan NIBT (konsisten dengan Minggu ini) |
| Sisa bulan ber-PO | tetap |
| vs Budget | tile dihapus bila budget tidak ada; muncul saat `month_outlook.budget` terisi |
| Chart tren | setiap batang menampilkan nilai (aturan standing Dika); label sumbu tabular |

### R159 — Kas dan solvabilitas (management, finance)

| Tile | Perubahan |
| --- | --- |
| Saldo kas, Terendah 13 minggu | empty state satu baris + tautan "isi di Sheet kas" (bukan tile 300 px) |
| Utang pihak berelasi | tambah pembanding: tingkat bunga tahunan (dari bunga bulan ÷ saldo × 12), jatuh tempo bila ada di `cash_plan`; bila tidak ada, baris "jatuh tempo belum diisi" |
| Saldo akhir per minggu (chart) | empty state satu baris; chart tampil hanya bila ≥ 2 titik |
| Siklus kas | form termin memakai `NumberInput` dengan label terlihat |

### R160 — Komersial (commercial\_lead, sales)

| Tile | Perubahan |
| --- | --- |
| Headline + konteks | konteks cut-off jadi `note` (K87) |
| Stok bebas belum ke PO | paragraf penjelasan 5 baris pindah ke drawer; baris 3 = satu kalimat |
| Rugi simpan per hari, Approval diskon | empty state satu baris bila nol / belum ada |
| Tabel stok yang harus dijual | kolom `Status biaya` memakai `Status`; kolom teks `wrap` |

### R161 — PPIC Rencana (ppic)

| Tile | Perubahan |
| --- | --- |
| Stepper | R147 |
| Rencana kebutuhan | pembanding per kelas sebagai tiga baris (K 83 · S 4.208 · B 13.108), bukan satu string yang membungkus |
| Batch rencana di input | selisih di atas kebutuhan: tone `warn`, tanda + dipertahankan, bukan merah |
| Catatan panjang di bawah tabel | pindah ke drawer |

### R162 — Input (semua penyusun)

| Tile | Perubahan |
| --- | --- |
| Headline | satu kalimat; daftar tugas terlambat tidak diulang di headline |
| Kartu role | hanya kartu berangka atau `Status`: Siap rilis → `Status` dari R151; Beban tetap → "2 baris tanpa jadwal" angka; Register asumsi → "0 dari 8" tetap; "Karkas tanpa ukuran: tidak ditampilkan" dihapus untuk sales; "Upload lain: wizard v4" dihapus |
| Tugas saya | R152 |
| Kelengkapan data harian | kolom hari sejajar (tabel, bukan grid longgar); sel `Status` ukuran `sm`; nama input tidak membungkus ke 4 baris (kolom min 160 px, teks pendek dari glosarium) |
| Upload dan cek | pola v5 tetap (ini acuan); "lolos" memakai `Status`, bukan warna link; kode cek di drawer |
| Parameter yang berlaku | catatan "belum dibangun" dihapus |

### R163 — Upload (finance, inventory\_accounting) dan halaman v1 lain

| Halaman | Perubahan |
| --- | --- |
| Upload wizard | dibangun ulang dengan `UploadPanel` v5: pilih jenis (nama dari glosarium) → file atau tempel → cek per baris → simpan yang lolos; riwayat = waktu · jenis · file · baris · `Status`; SHA-256 di drawer |
| Harga, Parameter, Run-rate, Stok awal, Batch, Penjualan, Penerimaan | grid memakai `NumberInput`/`Table` v6; label kolom + `aria-label` per sel; simpan dengan `ActionForm` v6 |
| Neraca, Laba Rugi, Arus Kas, Stok, Kontrol, Rilis, Batch RPA | konten dari snapshot (A), tabel `Table` v6, tile `Tile` v6; tidak ada kelas v1 |
| error.tsx, not-found.tsx, kosong | memakai `Shell` v6 dan tombol v6; pesan menyebut tindakan ("Muat ulang", "Kembali ke Minggu ini") |

## H — Aksesibilitas WCAG 2.1 AA (R164–R172)

Target: 0 pelanggaran serius/kritis axe-core di semua journey A6 (M5), dan setiap tugas penyusun dapat diselesaikan dengan keyboard saja; yang sudah benar di v4 (`lang`, hierarki heading, `scope`, `aria-current`, `focus-visible`, 44 px di HP, chart `role="img"`) dipertahankan.

| ID | Kriteria | Requirement | File |
| --- | --- | --- | --- |
| R164 | 1.4.3 Kontras teks | Token `--ink-3` v1 dihapus bersama `globals.css` (I); semua teks muted memakai `--muted` v4 (4,98:1). Teks 11 px (`.chip`, `.q`) dinaikkan ke 11,5 px minimum. | `v6.css` |
| R165 | 1.4.11 Kontras non-teks | Border input, checkbox, tombol sekunder memakai `--line-input` (3,1:1). Ikon `Status` ≥ 3:1 terhadap latar tile. | `v6.css`, `Status.tsx` |
| R166 | 1.3.1 / 4.1.2 Nama, peran, nilai | Setiap `input`, `select`, `textarea` punya `<label>` terlihat atau `aria-label` yang menyebut baris dan kolom ("Harga jual BLD frozen"); `placeholder` tidak pernah satu-satunya label (lint R156c). Tombol ikon punya `aria-label`. | semua form |
| R167 | 4.1.3 / 3.3.1 Status dan error | `ActionForm` R146; error server menyebut field dan diumumkan `role="alert"`; sel salah `aria-invalid` + `aria-describedby`. Pesan error dalam kalimat tindakan ("Harga jual BLD frozen tidak terbaca: pakai koma untuk desimal"). | `ActionForm.tsx`, `NumberInput.tsx` |
| R168 | 2.4.1 Bypass blocks | Skip link "Lewati ke isi" (R134); landmark `header`, `nav`, `main`, `aside` untuk drawer. | `Shell.tsx` |
| R169 | 2.4.3 / 2.1.2 Fokus dan jebakan | `Drawer` dan `DecisionDialog` memerangkap fokus, `inert` pada latar, mengembalikan fokus; `WeekPicker` dan menu HP dapat dioperasikan panah dan Esc; urutan Tab = urutan visual (diuji T35). | `Drawer.tsx`, `DecisionDialog.tsx`, `WeekPicker.tsx`, `MobileMenu.tsx` |
| R170 | 2.4.4 / 2.4.6 Nama link dan heading | Nama aksesibel unik per link kartu dan tombol drawer ("Buka Kas terendah", "Cara hitung Kas terendah"); tidak ada dua link bernama sama dengan tujuan berbeda di satu halaman (axe `link-name` + aturan kustom). | `Card.tsx`, `Tile.tsx` |
| R171 | 1.4.13 / 1.4.1 Hover dan warna | Tooltip `.tip` (v1) dihapus; penjelasan angka lewat drawer yang dapat difokus. Makna tidak pernah hanya warna: negatif = tanda − + merah, forecast = italic + label kolom, status = ikon + kata. | `v6.css`, `Status.tsx` |
| R172 | 1.4.4 / 1.4.10 Zoom dan reflow | Pada zoom 200% di 1366 px dan pada 390 px: tidak ada scroll horizontal di level halaman; tabel lebar scroll di dalam tile dengan kolom pertama sticky; `Table` kolom teks `wrap`. Diuji T36. | `Table.tsx`, `v6.css` |

### Matriks keyboard (dipakai T35)

| Elemen | Tab | Enter / Space | Esc | Panah |
| --- | --- | --- | --- | --- |
| Skip link | pertama di halaman | lompat ke `#isi` |  |  |
| `WeekPicker` | fokus tombol | buka daftar | tutup | pilih minggu |
| Tab halaman | tiap tab | pindah halaman |  |  |
| Link kartu | per kartu (bukan seluruh kartu) | buka |  |  |
| Tombol ⓘ / cara hitung | per tile | buka drawer, fokus ke panel | tutup, fokus kembali |  |
| `Drawer` | berputar di dalam | tutup pada tombol Tutup | tutup |  |
| `NumberInput` di grid | per sel, urutan baris |  |  | tidak dipakai (tetap Tab) |
| `DecisionDialog` | berputar di dalam | Putuskan / Batal | batal |  |
| Menu HP | tombol menu | buka `dialog` | tutup |  |

### Screen reader (diuji manual NVDA + Chrome, T38)

| Elemen | Diumumkan sebagai |
| --- | --- |
| Kartu GP minggu | "GP minggu, heading level 2; 289,8 Rp jt; revenue 2.018,4; link Buka GP minggu; button Sumber dan cara hitung GP minggu" |
| Status terlambat | "terlambat" (satu kali, bukan "gambar terlambat terlambat") |
| Sel harga | "Harga jual BLD frozen, edit text, 41.000; dibaca 41.000" |
| Hasil simpan | "41 harga tersimpan" lewat `role="status"` tanpa memindah fokus |

## I — Konsolidasi kode (R173–R178)

Satu stylesheet, satu versi per halaman, dan flag hanya untuk fitur yang benar-benar masih dipilih per role; semua jalur v1, v3, dan v4 yang sudah digantikan v5 dihapus sesudah v6 lolos, bukan dibiarkan di belakang flag.

### Keputusan

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K99 | Flag yang sudah hidup untuk semua role di production sejak sebelum 19 Okt (`v4_design`, `m1_costing`, `m2_ledger`, `m3_planning`, `m4_monthly`, `m6_cash`, `m7_commercial`) dijadikan permanen: cabang "off"-nya dihapus. Flag yang masih per role (`v5_*`, `m5_drivers`, `m7_approval`, `v4_release`, `v53_*`) tetap. Daftar final dikonfirmasi Dika dari `app_setting` production sebelum R176. | Dika | diusulkan |
| K100 | `globals.css` dihapus; `v6.css` = `v4.css` + token E + aturan komponen v6, tanpa scope `.v4` (seluruh app adalah v6). Aturan `@media print` v1 dipindah ke `v6.css` karena PDF cetak memakainya. | Dika | diusulkan |
| K101 | Halaman v1 yang tidak punya padanan v5 (Neraca, Laba Rugi, Arus Kas, Stok, Kontrol, Rilis, Batch RPA, Print, Admin, Master, Akun, Login) dibangun ulang di komponen v6 (G R163), bukan dihapus. | Dika | diusulkan |

### Requirement

| ID | Requirement | File |
| --- | --- | --- |
| R173 | Inventaris: `docs/v6/inventaris.md` mendaftar setiap halaman di `app/`, komponen di `components/`, dan modul `lib/v3`, `v4`, `v5` dengan kolom: dipakai oleh, versi, nasib (tetap / ganti v6 / hapus), flag yang menjaganya. Ditinjau Dika sebelum R174. | `docs/v6/inventaris.md` |
| R174 | Hapus cabang v4 di halaman yang punya v5 hidup untuk semua role: `rencana/v4.tsx`, `komersial/v4.tsx`, `m/[month]/v4.tsx`, `biaya/v4.tsx`, `tutup-buku/v4.tsx`, `hari/[date]/alokasi/v4.tsx` sesuai K99; `lib/v4/*` yang hanya dipakai cabang itu ikut dihapus; tes yang menguji cabang terhapus dihapus. | `app/**/v4.tsx`, `lib/v4/*` |
| R175 | Hapus `components/v3/*`, `lib/v3/*`, `components/outlook/*` yang tidak lagi diimpor sesudah R163; `tsc --noEmit` dan `knip` (ditambahkan ke devDependencies) memverifikasi tidak ada ekspor yatim. | `apps/web/package.json`, CI |
| R176 | `MODULE_KEYS` dipangkas sesuai K99; migrasi B-R122 menghapus baris `app_setting` flag permanen; halaman `/admin/modul` hanya menampilkan flag yang tersisa dengan deskripsi dari glosarium. | `lib/modules-core.ts`, `app/admin/modul/page.tsx` |
| R177 | `v6.css` tunggal diimpor di `app/layout.tsx`; `globals.css` dan `v4.css` dihapus; `grep -r 'className="card\b\|table.t\b\|\.topbar'` = 0 di `app/` dan `components/` (M6). `reference/design/grammar.css` disinkronkan. | `app/layout.tsx`, `app/v6.css`, `reference/design/` |
| R178 | Ukuran bundel klien tidak naik: `next build` melaporkan First Load JS per rute; rute terbesar ≤ nilai sekarang + 10 kB (diukur T34). Komponen klien v6 ≤ 15 file. | CI |

### Requirement database

| ID | Requirement |
| --- | --- |
| B-R122 | Hapus baris `app_setting` untuk flag yang dipermanenkan K99, sesudah R176 di-deploy dan e2e hijau di production; backup sebelum migrasi. |

## J — Pengujian dan kriteria lolos (T29–T40)

Setiap irisan berhenti di gate-nya; angka lolos di bawah adalah syarat merge, bukan target aspiratif, dan "lulus" selalu disebut dengan lingkungannya (lokal, staging, production).

### Gate otomatis (CI, setiap PR)

| ID | Lulus bila | Cara ukur |
| --- | --- | --- |
| T29 | Golden dan parity tidak berubah: 17.161 sel reproduksi, `pnpm test` dan `pnpm parity` hijau; `week_snapshot.result` minggu 2026-08-24 identik byte-per-byte dengan `computeWeek(fixture)` (`snapshot:diff` = 0 perbedaan). | `packages/engine/test`, `scripts/snapshot-diff.ts` |
| T30 | Per halaman utama (Minggu ini, Outlook bulan, Kas, Komersial, Rencana, Input, Neraca): jumlah query Supabase ≤ 4 di luar tile Suspense, dan tidak ada `week?select=update_date`, `app_setting?key=eq.v5_costing`, atau `auth/v1/user` di log request mock e2e. `Server-Timing` `data` ≤ 120 ms di stack lokal. | `tests/e2e` log request mock + header |
| T31 | Lighthouse mobile (390 px, 4G throttling, sesi login) di `/minggu-ini/<week>`: FCP ≤ 1,5 s, LCP ≤ 2,5 s; skeleton tampil ≤ 300 ms (screenshot pada 300 ms memuat `data-tile-skeleton`). Dijalankan terhadap staging (`E2E_SKIP_UP=1`). | `tests/e2e/perf.ts` (baru) |
| T32 | axe-core: 0 pelanggaran `serious` dan `critical` di 22 screenshot A6 + Upload + Harga + Login + Admin untuk tiap role. Pelanggaran `moderate` ≤ 5, masing-masing dicatat dengan alasan di `docs/v6/a11y-exceptions.md`. | `@axe-core/playwright` di journey A6 |
| T33 | Tidak ada elemen `nav` yang terpotong atau scroll horizontal di 1280, 1366, 899, 390 px untuk 10 role (periksa `scrollWidth <= clientWidth` pada `html` dan `nav`). | journey A6 |
| T34 | Bundel: First Load JS rute terbesar ≤ baseline + 10 kB; jumlah file `"use client"` ≤ 15. | `next build` output di CI |
| T35 | Keyboard: journey per role dari skip link sampai tombol simpan/putuskan hanya dengan Tab, Enter, Esc, panah; jumlah Tab-stop sampai aksi utama ≤ 25; fokus tidak pernah hilang (`document.activeElement` ≠ `body` sesudah tiap langkah). | journey baru `K` di `tests/e2e` |
| T36 | Zoom 200% di 1366 px dan 390 px: `html.scrollWidth <= clientWidth`; semua `data-tile-value` terlihat (`getBoundingClientRect` di dalam viewport sesudah scroll vertikal). | journey A6 |

### Penerimaan manual (sebelum flag dibuka ke role, dicatat di `docs/v6/penerimaan.md`)

| ID | Skenario (bagian Pengguna) | Lulus bila |
| --- | --- | --- |
| T37 | Bu Lenny / Pak Jo, HP, Minggu ini | Tanpa scroll: headline, GP, kekurangan kas tanpa afiliasi, jumlah keputusan menunggu terbaca; satu ketukan ke tabel P\&L; dua pertanyaan "ini angka apa?" maksimal, keduanya dicatat sebagai perubahan label |
| T38 | Finance, laptop, Input + Upload | Rilis mingguan selesai tanpa bertanya ke Dika; status kesiapan di kartu = headline; NVDA mengumumkan hasil simpan |
| T39 | Cost Accounting, laptop dan Android, Harga 41 SKU | Keyboard angka muncul di Android; satu kesalahan format sengaja (`0.725`) tertangkap sebelum simpan; waktu isi ≤ 10 menit |
| T40 | Direktur Operasional, HP, keputusan harga LB | Dialog menampilkan harga, volume, dampak GP, nama; `audit_log` menyimpan payload yang sama; keputusan tampil di kartu Keputusan menunggu sebagai selesai |

### Pengukuran produksi (1 minggu sesudah flag dibuka ke semua role)

| Metrik | Target | Sumber |
| --- | --- | --- |
| M1 query per tampilan | ≤ 4 | `edge_logs` |
| M2 `Server-Timing` total p50 | ≤ 400 ms | Vercel logs |
| Set query berulang 3× dalam 5 detik | 0 kejadian | `edge_logs` (Q-v6-1 tertutup) |
| Halaman error (`data-app-error`) | 0 per minggu | Vercel logs |

## K — Urutan kerja, irisan, ketergantungan

Enam irisan, masing-masing di cabang `v6/<irisan>` dari `main`, merge berurutan kecuali yang ditandai paralel; tiap irisan berhenti di gate-nya untuk sign-off Dika, dan flag `v6_shell` serta `v6_pages` membuka UI baru per role hanya sesudah T37–T40.

&#91;embedded content: roadmap v6 · 6 irisan, 4 gate\]

Belah ketupat adalah gate merge; irisan 5 menunggu kedua jalur, dan irisan 6 hanya dimulai sesudah satu minggu pengukuran produksi.

| Irisan | Isi | Prasyarat | Gate merge | Flag |
| --- | --- | --- | --- | --- |
| 1 Snapshot | B-R119–B-R121, R119, R122, R123, R124 (rebuild menulis snapshot; halaman belum membacanya) | backup KGR-OS; migrasi diterapkan | T29; snapshot minggu 24 Agu = fixture; rebuild semua minggu `released` selesai di production | tidak ada (tulis saja) |
| 2 Baca snapshot | R120, R121, `docs/v6/loaded-map.md`; 23 halaman beralih ke snapshot | Irisan 1 di production | T29, T30 di stack lokal; e2e T7, A6, R69 hijau; angka halaman identik dengan sebelum (snapshot-diff) | `v6_snapshot_read` (admin → semua role sesudah 2 hari tanpa `tile-err`) |
| 3 Konteks dan auth | R125–R129 (`getClaims`, `RequestContext`, `icn1`) | tidak bergantung irisan 1–2; **paralel** | T30 (tidak ada `auth/v1/user` di log halaman); sesi kedaluwarsa → login; e2e matrix flag hijau | tidak ada (infra) |
| 4 Komponen dan shell | R130–R148, R164–R172, token E, `v6.css` berdampingan dengan `v4.css` sementara | tidak bergantung irisan 1–3 untuk kode; **paralel**; pengukuran T31 menunggu irisan 2–3 | T32, T33, T35, T36 di stack lokal untuk halaman yang sudah pindah; T34 | `v6_shell` (admin) |
| 5 Konten dan layar | R149–R163, glosarium, lint R156; semua halaman ke komponen v6 termasuk halaman v1 (K101) | Irisan 2 (snapshot) dan 4 (komponen) | T29–T36 penuh; T37–T40 manual dengan user sungguhan di staging; M4 | `v6_pages` per role, dibuka sesudah T37–T40 role itu |
| 6 Konsolidasi | R173–R178, B-R122; hapus v1/v3/v4, `globals.css`, flag permanen | `v6_pages` hidup untuk semua role ≥ 1 minggu; M1–M7 terukur | T29, T34, `knip` bersih; M6 = 0; backup sebelum B-R122 | flag `v6_*` dihapus (jadi default) |

Aturan merge yang sama dengan v5.2-A Bab 4: PR kode yang memakai objek DB baru di-merge sesudah migrasinya ada di `main` dan diterapkan di KGR-OS; tidak ada push ke cabang v5.3 yang sedang berjalan; CI hijau; pemakaian tim sejak 19 Okt tidak terganggu (UI lama tetap default sampai flag dibuka).

Urutan pengerjaan yang disarankan bila satu agen: 1 → 3 → 2 → 4 → 5 → 6. Bila dua agen: agen A mengerjakan 1 → 2, agen B mengerjakan 3 → 4, keduanya bertemu di 5.

## L — Pertanyaan terbuka, risiko, keputusan Dika

Lima butir butuh jawaban Dika sebelum irisan terkait dimulai; sisanya dibangun di belakang parameter.

### Pertanyaan terbuka

| ID | Pertanyaan | Dibutuhkan untuk | Default bila tidak dijawab |
| --- | --- | --- | --- |
| Q-v6-1 | Set query yang sama berulang 3× dalam 4,5 detik di satu sesi: prefetch `<Link>`, rantai redirect, atau klik ganda? Cek Vercel request logs (akun Vercel yang memegang project; akun yang terhubung di sesi review tidak memilikinya). | C R133 | `prefetch={false}` di semua link dinamis sampai terbukti aman |
| Q-v6-2 | Flag mana yang sudah hidup untuk semua role di production (daftar `app_setting` per 19 Okt)? | I K99, R176 | hanya `v4_design` dan `m1`–`m4`, `m6`, `m7_commercial` yang dipermanenkan |
| Q-v6-3 | Migrasi KGR-OS ke `ap-southeast-1` (Singapura) dan Vercel ke `sin1`: dikerjakan sekarang (project baru + dump/restore, downtime \~1 jam, sebelum data September final) atau sesudah v6? | B K84 | `icn1` saja di v6; migrasi dijadwalkan terpisah |
| Q-v6-4 | Apakah Sales boleh melihat `batch` (lb\_price, freight, maklon) lewat PostgREST (V6 v5.3)? Menentukan apakah tile Sales membaca snapshot penuh atau subset. | A R120 | subset: snapshot untuk Sales dibaca lewat RPC `snapshot_for_role` yang menghapus kolom biaya (B-R123, dibangun hanya bila jawabannya "tidak boleh") |
| Q-v6-5 | Tingkat bunga dan jatuh tempo utang pihak berelasi: dari `cash_plan` atau parameter baru? | G R159 | baris "jatuh tempo belum diisi"; tidak ada tabel baru |

### Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Snapshot basi: write yang lupa mengantre rebuild | halaman menampilkan angka lama tanpa tanda | `inputs_hash` dibandingkan oleh cron tiap jam (bukan hanya 05.00); baris sumber tile menampilkan `built_at`; C62-style kontrol baru "snapshot lebih tua dari input terakhir" → PERIKSA |
| Pemetaan `loaded.db.*` di 23 halaman terlewat | halaman 500 atau tile kosong | `docs/v6/loaded-map.md` ditinjau sebelum kode; `tsc` menolak akses `loaded` di `app/**` lewat tipe `Computed` tanpa `loaded` di jalur request |
| `getClaims()` dan refresh token | user keluar sendiri saat token kedaluwarsa | tes sesi kedaluwarsa di e2e (R125); `@supabase/ssr` tetap menangani refresh di `setAll`; `getUser()` dipertahankan di callback |
| Dua UI hidup bersamaan selama irisan 4–5 | kebingungan tim yang sedang pilot | flag per role, UI lama tetap default; Lihat sebagai memakai v6 hanya untuk admin; tidak ada perubahan di `main` yang mengubah tampilan tanpa flag |
| Glosarium mengubah istilah yang sudah dipakai tim di pelatihan 19 Okt | tim harus belajar ulang | glosarium ditinjau Finance dan Kepala Sales sebelum merge irisan 5; istilah yang sudah dipakai di pelatihan dipertahankan bila tidak termasuk kode spesifikasi |
| Penghapusan v1/v3/v4 menghapus halaman yang ternyata dipakai | fitur hilang | inventaris R173 dengan kolom "dipakai oleh" dari `audit_log` 30 hari terakhir; penghapusan hanya untuk halaman tanpa kunjungan dan dengan padanan v6 |
| Target M2–M3 adalah estimasi dari trace, bukan hasil ukur | janji meleset | diukur di stack lokal (T30) dan staging (T31) sesudah irisan 2–3 sebelum angka dipakai di laporan ke Pak Jo / Bu Lenny |

### Checklist eksekusi

- [ ] Dika menjawab Q-v6-1 sampai Q-v6-5 (atau menerima default)
- [ ] Backup KGR-OS sebelum B-R119
- [ ] Irisan 1 merge: snapshot semua minggu `released` ada di production
- [ ] Irisan 3 merge: `auth/v1/user` hilang dari log halaman
- [ ] Irisan 2 merge: T30 lolos, angka identik
- [ ] Irisan 4 merge: axe 0 serius, keyboard journey hijau
- [ ] Glosarium ditinjau Finance dan Kepala Sales
- [ ] Irisan 5: T37–T40 dengan user sungguhan, flag dibuka per role
- [ ] 1 minggu pengukuran M1–M7 di production
- [ ] Irisan 6: konsolidasi, flag `v6_*` dihapus
- [ ] `docs/handover.md` dan `README.md` diperbarui; PRD v6 dipindah ke `docs/PRD-v6.md`
