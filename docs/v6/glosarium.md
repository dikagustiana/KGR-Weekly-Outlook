# Glosarium v6 (K95)

Satu sumber kata yang dibaca user. Kode spesifikasi dan istilah internal hanya muncul di drawer "cara hitung". Sumber kode:
`apps/web/lib/v6/glossary.ts` (`ROLE_NAME`, `CODE_NAME`, `TERMS`, `plain()`); dokumen ini salinannya untuk ditinjau **Finance dan Kepala Sales**
sebelum irisan 5 di-merge (risiko "istilah pelatihan 19 Okt"). Istilah finance Inggris yang baku tetap: GP, NIBT, COGS, run-rate, outlook.

## Role (K96)

| Kunci | Tampilan |
| --- | --- |
| `management` | Manajemen |
| `operations_director` | Direktur Operasional |
| `finance` | Keuangan |
| `cost_accounting` | Akuntansi Biaya |
| `inventory_accounting` | Akuntansi Persediaan |
| `ppic` | PPIC |
| `commercial_lead` | Kepala Sales |
| `sales` | Sales |
| `purchasing` | Pembelian |
| `admin` | Admin |

## Istilah internal

| Internal | Tampilan |
| --- | --- |
| grid kelengkapan | kelengkapan data harian |
| gagal-tertutup | halaman tidak dimuat sebagian |
| data mart | data harian terhitung |
| mart | data harian terhitung |
| committed | tersimpan |
| tempelan | tempel dari Excel |
| supplier\_invoice | faktur pemasok |
| costing\_wp | WP potong |
| idempotent | aman diulang |
| STD (ukuran) | ukuran standar 2,0 kg |
| K35 override | rilis dengan pengecualian |

## Kode aturan → nama aturan

Di teks layar kode dihapus bila hanya rujukan ("(C55)"), atau diganti nama aturannya bila kalimat memakainya.

| Kode | Nama di layar |
| --- | --- |
| C21 | alokasi biaya batch lengkap |
| C22 | hasil SKU sesuai hasil potong |
| C23 | cost pool sama dengan buku besar |
| C24 | alokasi batch sudah diposting |
| C25 | keluar tanpa lot |
| C26 | saldo stok sama dengan kartu stok |
| C27 | nilai persediaan sama dengan neraca |
| C28 | PO lewat tanggal kirim |
| C29 | alokasi tidak melebihi PO |
| C30 | rencana harian dalam kapasitas |
| C31 | blast tanpa lot tujuan |
| C32 | jembatan V1 ke V2 menutup |
| C33 | setiap biaya punya driver |
| C34 | biaya tetap sesuai jadwal |
| C35 | saldo rekening sama dengan kas neraca |
| C36 | hari kerja tanpa upload kas |
| C37 | utang bersaldo debit |
| C38 | order di bawah harga lantai |
| C39 | SKU terjual tanpa order |
| C40 | sales tanpa penugasan |
| C41 | by-product kurang dari order |
| C42 | yield bukan angka contoh |
| C43 | biaya tetap bulan ini diperbarui |
| C44 | forecast SKU tersedia |
| C45 | data harian stok diperbarui |
| C46 | harga fresh dan frozen terisi |
| C47 | kapasitas tanggal rencana terisi |
| C48 | batch punya output SKU |
| C49 | P&L harian sama dengan P&L bulan |
| C50 | ukuran karkas wajib di PO |
| C51 | kelas berat terdaftar |
| C52 | komitmen dikunci tepat waktu |
| C53 | WP potong tepat waktu |
| C54 | biaya per kg di bawah harga acuan |
| C55 | beban tetap tanpa jadwal |
| C56 | costing final tepat waktu |
| C57 | harga live bird diputuskan |
| C58 | supply LB menutup kebutuhan |
| C59 | rekonsiliasi dengan laporan keuangan |
| K20 | status biaya |
| K25 | keputusan Direktur Operasional |
| K32 | kunci komitmen |
| K35 | rilis dengan pengecualian |
| K36 | sumber angka |
