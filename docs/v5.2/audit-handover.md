# Audit handover DeepSeek → agen Claude (Fase 0), 17 Okt 2026

Sumber klaim: `HANDOVER.txt`, `HANDOFF.md` (DeepSeek), PR #38. Bukti dibaca ulang di cabang `origin/v5.2/*`
(container cloud, PG16 lokal, Node 22). Status: **lulus** (semua butir spesifikasi + bukti PRD ada) / **sebagian** /
**tidak**. Baris = nomor pada tip yang diaudit (a1 `f340e55`, a2 `81f7663`≡`242afa5`, a3 `68c3191`, a4 `6251c0b`,
a6 `ec9c33f`, bt-sep `36142b5`).

## Klaim umum

| Klaim | Bukti | Status |
|---|---|---|
| "lint K41/K42 = 0" (A1) | `lint-k41.sh` baris 29 dan seluruh `lint-k42.sh` memanggil `report()` di dalam `… \| while`, jadi `fail=1` hilang di subshell → selalu exit 0. Dengan `scripts/lint.py` (exit 1 bila hit): 4 hit K41 + 177 hit K42 di `eecf4c3`, lalu 16 hit K41 lagi (termasuk `sales_sees_cost` gagal-terbuka di 3 halaman Komersial) | **tidak bermakna** |
| "lint-missing = 0" (A3) | subshell yang sama (diuji: 2 hit tercetak, exit 0); regex tidak menangkap `?? "0";` dan `\|\| 0`; whitelist substring (`String\(`, `s\(p\.`, `a \?\?`, `count` cocok "discount"/"account") | **tidak bermakna** |
| "gate hijau di setiap commit" | CI run 39027402194 (a2 `81f7663`) **gagal**: `upload-samples.test.ts:33` golden B.5 `wp_sample` (C22 6.782,8 → 6.043,6 akibat R58) | **salah** untuk a2 |
| "engine 367 tes" (A3) | 365 + 1 todo; web 265, **0 tes web baru** di A2 dan A3 | salah angka |
| "R63 butuh kolom `batch.weight_class`" | kolom sudah ada (`20261016000200_m1_costing.sql:8`, juga di KGR-OS) | salah |
| "selisih 43,8 jt: kemungkinan fixtures memakai versi FS/DI berbeda" | fixture `fs-2026-09` = salinan setia `reference/09._Laporan_…_v2.xlsx` (sha256 `7e68aa89…04c5`, identik). Angka bt-sep dari berkas lain bernama sama di `C:\Users\USER\Downloads\Back test\` | **arah terbalik** (lihat §bt-sep) |

## A1 `v5.2/a1-fail-closed` (R41–R47)

| R | Status di `f340e55` | Kekurangan (diperbaiki agen di A1 sebelum merge #38) |
|---|---|---|
| R41 | sebagian | tidak ada tes mock error → throw / 42P01 → `{}`; tidak ada tes layar Outlook; tidak ada `app/error.tsx` |
| R42 | sebagian | `release.test.ts` tidak ada |
| R43 | sebagian | `param.data ?? {}` di ledger/costing/planning/commercial/allocation; `month_outlook` di `m/[month]/page.tsx`, `v3/management.ts`; `discount_limit` di 2 halaman; `sales_sees_cost` di 3 halaman Komersial (gagal-terbuka); tulisan tanpa cek error di `costing.ts:211`, `rollover.ts:93`, `upload/actions.ts:48`; `orMissingTable` memberi `schema=true` untuk semua error |
| R44 t1 | sebagian | `classifySchemaError` tidak dipakai/dites; rebuild, rilis, aksi tulis tidak menolak lebih awal |
| R45 | sebagian | tes F19 dan tes reset `running` tidak ada; siklus baru terdeteksi saat rebuild; `after` per modul |
| R46 | **tidak** (fungsi) | `middleware.ts` me-redirect `/api/cron` ke `/login`; setting dibaca dengan client anon → `{}` → `skip`; tes route dan README "Operasi" tidak ada |
| R47 | sebagian | `fetchAll` tanpa urutan unik di 116+ builder (diperbaiki `f340e55`); 2 sisa lolos regex generic bersarang; `data.test.ts` tidak ada |

## A2 `v5.2/a2-loop` (R48–R58) — basis salah (dari `main`), di-rebase ke A1 oleh agen (`242afa5`)

| R | Status | Kekurangan utama |
|---|---|---|
| R48 | sebagian | tes loader komitmen 300 kg > PO 100 kg tidak ada |
| R49 | sebagian | netting stok hilang (kolom stok PPIC selalu 0); forecast tanpa `forecast_weight` dan aturan K2, di `week_start` bukan per tanggal; bobot tidak di-clip ≥ 0; probe 70%/fulfilled60/forecast-only tidak ada |
| R50 | sebagian | pesan "n baris" bukan "n kg tanpa kelas"; probe `C58_UNSIZED` tidak ada |
| R51 | sebagian | tidak ada `copyGate` di `copyPlanToBatches` (C57/C58 diduplikasi di dua action); alasan C58 terikat minggu, bukan versi rencana; harga LB batch masih supply/`lbPriceToday`; UI v4 membaca blocker lain; v4 bisa jalan buntu oleh C58 saat `v5_ppic_class` mati |
| R52 | sebagian | hanya ID hasil insert; `copyPlanToBatches` tidak membaca `plan_week_class`; yield v1 |
| R53 | **tidak** | form dipasang di `extras["t-approval"]`, tile itu tidak ada → tidak pernah tampil |
| R54 | sebagian | hanya kunci; simpan/surplus/WP tidak meng-queue; error baca `input_task_rule` diabaikan; tes dilonggarkan |
| R55 | **tidak** | belum dikerjakan |
| R56 | **tidak** (regresi) | form tidak punya field `key` → key `""`; Sales ber-assignment ditolak trigger |
| R57 | **lulus** | `lb-decision.ts:26-28` |
| R58 | sebagian | C22 tanpa "output lama dipertahankan" (golden B.5 merah); filter Sales `base_key`+pelanggan dan commit atomik tidak ada |

## A3 `v5.2/a3-costing-pl` (R59–R67)

| R | Status | Kekurangan utama |
|---|---|---|
| R59 | **lulus** | tes `pl-v5.test.ts:61-77`; B.2 −87,0 jt tetap |
| R60 | sebagian | loader `allPriced = postedIds.has(id)` (tautologis); costCheck "faktur tie, alokasi belum diposting" dan langkah posting tidak ada; pesan upload masih "biaya batch final" |
| R61 | sebagian | `price_ref = 0` lolos; tolak per minggu bukan per batch; override Finance dan ledger tidak ada; K42 `costing.ts:209` |
| R62 | sebagian | C54 tidak menilai batch `result = null`; C42 tidak tersambung; `target_shrink ?? "0"` |
| R63 | sebagian | keputusan LB mengabaikan `weight_class`; label "yield STD dipakai" tidak ada |
| R64 | sebagian | 12 lokasi PRD masih `?? 0`; lint tidak bermakna dan tidak di CI |
| R65 | **tidak** | penyusutan diset 0 → nonkas justru mengurangi kas; fallback NIBT jurnal/0 |
| R66 | sebagian (stub) | memo memindahkan baris v5 ke opex; blok memo dan NIBT manajemen tidak ada; mode tidak pernah dibaca |
| R67 | sebagian | override tak pernah cocok (key huruf besar); memakai keputusan LB tertua; golden `fixtures/pl-v5-lbprice` tidak ada |

## A4 `v5.2/a4-fs-recon` (R68) — sebagian

`fsRecon` murni + C59 ada (3 tes sintetis). Input `fs` berbentuk `{key, amount}` bukan `{statement, line, row_no,
amount}`; pemetaan minimum PL/BS tidak ada; mode memo tidak ditangani; `fixtures/fs-recon-2026-08/09` dan
`docs/v5.2/fs-recon-fixture.md` tidak ada. R69: belum (⛓ B-R86).

## A6 `v5.2/a6-ui` (R75–R79)

| R | Status | Kekurangan |
|---|---|---|
| R75 | sebagian | posisi y tile v5 tidak diubah; screenshot tidak ada |
| R76 | **tidak** | `loadSources` tetap baris terbaru sepanjang waktu; tidak ada tes |
| R77 | sebagian | tautan wizard v4 tidak dipindah ke panel Input Finance |
| R78 | belum sesuai keputusan | Q-v5-42 kini disetujui: `.xls` harus diterima (web masih xlsx 0.18.5 mini) |
| R79a | sebagian | "1,234" → `null` (dibaca kosong), bukan fail "format ribuan ambigu" |
| R79b | **tidak** (regresi) | `buildInputDay` dengan client pengguna → `mart_replace` hanya `service_role` → rilis gagal izin saat `v5_input` hidup |
| R79c | **lulus** | `minggu-ini/[week]/page.tsx:22-24` |

## Backtest `v5.2/bt-sep`

- **BT-1**: hanya alias `Nilai Debit/Kredit` (`tables.ts:101`); debit/kredit tetap tidak wajib, parser tidak throw
  (header `Nilai Mutasi D/K` → `debit=null`, `credit=null`, tanpa issue). Tes lulus-gagal ada tetapi untuk alias.
- **52 baris tanpa tanggal**: dihitung `stage.ts:123-125` hanya sebagai jumlah; Σ dan jenisnya tidak dihitung; Σ debit
  81.300.134.506,31 hanya baris bertanggal. Berkas `GL KGR Rev 1.xls` tidak ada di repo (BUTUH-DIKA D6).
- **Selisih 43,8 jt** (sel berkas repo vs berkas Downloads DeepSeek, `PL/BS - Management Report` kolom L):

| Sel | Downloads (bt-sep) | Repo = fixture | Δ |
|---|---|---|---|
| PL L19 Commission | −11.593.192,60 | −5.620.863,60 | −5.972.329,00 |
| PL L24 Storage | −192.772.535,65 | −154.899.851,65 | −37.872.684,00 |
| PL L51 NIBT | −953.903.552,73 | −910.058.539,73 | −43.845.013,00 |
| BS L53 Accrued Exp. – Third Parties | 43.845.011 | −2 | +43.845.013 |
| BS L77 Ekuitas | 658.708.461,90 | 702.553.474,90 | −43.845.013,00 |

  Sebab: berkas Downloads memuat tambahan beban Commission 5,97 jt dan Storage 37,87 jt dengan lawan Accrued Expenses.
  Acuan v5.2 = berkas di repo (sha256 tercatat); angka tidak diubah. `expected.json` bt-sep merujuk sel salah
  (`PL!B{r}` padahal kolom L sheet "… - Management Report").
