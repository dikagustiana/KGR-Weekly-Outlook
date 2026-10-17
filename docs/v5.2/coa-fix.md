# B-R89 — koreksi `coa_map` KGR-OS (17 Okt 2026)

Bundel: `docs/v5.2/kgr-os-coa-fix.sql` (sha256 di log). Diterapkan agen atas delegasi Dika sesudah uji lokal (PG16, dua
kali) dan uji kering di KGR-OS (`rollback`), backup `bak_20261017t1620`. Keputusan cakupan: Q-v5.2-9.

## Sumber

`reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` (sha256 `7e68aa89…04c5`), sheet `PL` dan `BS` kolom **Q**
("Mappinganya"). Kolom ini kriteria `SUMIFS` yang membentuk Management Report, mis. `'PL - Management Report'!L12`
`=SUMIFS(PL!L:L,PL!$Q:$Q,$B12)`, `'BS - Management Report'!L14` `=SUMIFS(BS!M:M,BS!$Q:$Q,$B14)`. Nilai lama
`fs_mapping_reference` berasal dari kolom R (detail lama) dan sebagian bergeser satu-dua baris (A-LIVE-9).

## 1. `fs_mapping_reference` (48 diubah + 3 dikosongkan)

| Akun | Sebelum | Sesudah | Sel sumber |
|---|---|---|---|
| 1102007 | Cash and cash equivalents | Advance Payment | `BS!Q19` |
| 1102008 | Advance Payment | Cash and cash equivalents | `BS!Q20` |
| 2102001 | ∅ | Taxes Payable | `BS!Q106` |
| 2103012 | Accrued Expenses - Third Parties | Unearned Revenue | `BS!Q125` |
| 4101001 | Revenue - Trading | Revenue | `PL!Q8` |
| 4101002 | Service Fee | Revenue | `PL!Q9` |
| 4101003 | Sales Return | Revenue | `PL!Q10` |
| 4101004 | Revenue - Trading | Revenue | `PL!Q11` |
| 4101005 | Other Sales | Revenue | `PL!Q12` |
| 4101006 | Revenue - LB Main Product | Revenue | `PL!Q13` |
| 4101007 | Revenue - LB By Product | Revenue | `PL!Q14` |
| 4101008 | Revenue - Trading | Revenue | `PL!Q15` |
| 4101010 | Revenue - LB Main Product | Revenue | `PL!Q17` |
| 4101011 | Revenue - LB Main Product | Revenue | `PL!Q18` |
| 4101012 | Revenue - Trading | Revenue | `PL!Q19` |
| 4101013 | Revenue - LB Main Product | Revenue | `PL!Q20` |
| 5100002 | Other COGS - Expedition | Cost of Sales | `PL!Q25` |
| 5100004 | Live Bird | Cost of Sales | `PL!Q27` |
| 5100005 | Live Bird | Cost of Sales | `PL!Q28` |
| 5100006 | Live Bird | Cost of Sales | `PL!Q29` |
| 5100007 | Other COGS - Expedition | Cost of Sales | `PL!Q30` |
| 5100009 | COGS - Blasting | Cost of Sales | `PL!Q32` |
| 5100010 | COGS - Labor | Cost of Sales | `PL!Q33` |
| 5100011 | COGS - Trading | Cost of Sales | `PL!Q34` |
| 6100004 | Commission Expenses | Salaries and allowance - Sales | `PL!Q47` |
| 6100005 | Delivery Expenses - SE | Commission Expenses | `PL!Q48` |
| 6100007 | Office Transportation expenses | Delivery Expenses - SE | `PL!Q50` |
| 6100010 | Salaries and allowance | Office Transportation expenses | `PL!Q53` |
| 620000 | ∅ | Salaries and allowance | `PL!Q54` |
| 6200003 | Office Transportation expenses | Salaries and allowance | `PL!Q57` |
| 6200006 | Water and Electricity | Office Transportation expenses | `PL!Q60` |
| 6200007 | Telecomunication and Internet | Water and Electricity | `PL!Q61` |
| 6200008 | Water and Electricity | Telecomunication and Internet | `PL!Q62` |
| 6200009 | Office Supplies Expenses | Water and Electricity | `PL!Q63` |
| 6200012 | Professional Fee | Office Supplies Expenses | `PL!Q66` |
| 6200013 | Rent Expenses | Professional Fee | `PL!Q67` |
| 6200014 | Rent Expenses | Professional Fee | `PL!Q68` |
| 6200016 | Office Supplies Expenses | Rent Expenses | `PL!Q70` |
| 6200019 | Representation and Donation | Office Supplies Expenses | `PL!Q73` |
| 6200021 | Office Supplies Expenses | Representation and Donation | `PL!Q75` |
| 6200022 | ∅ | Office Supplies Expenses | `PL!Q76` |
| 6200023 | Commission Expenses | Office Supplies Expenses | `PL!Q77` |
| 6200024 | ∅ | Commission Expenses | `PL!Q78` |
| 6200025 | Maintenance Expenses | Commission Expenses | `PL!Q79` |
| 6200029 | ∅ | Maintenance Expenses | `PL!Q83` |
| 630000 | ∅ | Maintenance Expenses | `PL!Q88` |
| 6300003 | Depreciation ROU Building | Maintenance Expenses | `PL!Q91` |
| 6350001 | Other Income | Other Expense | `PL!Q93` |
| 4101009 | Sales Return | ∅ | `PL!Q16` kosong |
| 1102009 | Cash and cash equivalents | ∅ | tidak ada di sheet BS |
| 6400007 | Other Income | ∅ | `PL!Q94` kosong |

Label Q yang **tidak** dipakai Management Report (akunnya tidak masuk total MR mana pun): "Salaries and allowance -
Sales" (6100001–6100004), "Water and Electricity" (6200007, 6200009), "Telecomunication and Internet" (6200008),
"Representation and Donation" (6200020–6200021), serta label BS "Land", "Vehicle", "Acc. Depreciation - Vehicle",
"Acc. Depreciation - Software". Ini definisi FS, bukan diubah; rekonsiliasi C59 mencatatnya sebagai sebab "definisi"
bila akun itu bersaldo.

## 2. Akun baru (5)

| Akun | Nama (FS) | Disalin dari | Sumber | Saldo/aktivitas |
|---|---|---|---|---|
| 1102010 | Bank DKI 540-0800-0663 | 1102006 | `BS!A18` | 5 baris GL Sep |
| 1107001 | Bank Guarantee | 1105004 | `BS!A59` | 1 baris GL Sep; saldo Sep 56.689.947,75 |
| 5100015 | Other COGS - Storage Tools Rental | 5100013 | `PL!A38` | Sep 62.450.000 (sewa ABF, DI-04) |
| 6200032 | Operating Tools - KGR | 6200031 | `PL!A86` | Sep 9.284.684,40 |
| 6200033 | Operating Supplies - KGR | 6200031 | `PL!A87` | tanpa saldo Agu–Sep |

Empat akun pertama dipakai GL September (sheet `Sep 26`); tanpa baris `coa_map` jurnal September tidak terpetakan.

## 3. `pl_line` (B-CST-1)

| Akun | Sebelum | Sesudah | Dasar | Saldo Agu / Sep (FS) |
|---|---|---|---|---|
| 6100010 Travelling & Accomodation Sales | Salaries and allowance, `fixed` | Office Transportation expenses, `runrate` | `PL!Q53` | 0 / 0 |
| 6200006 Travelling & Accomodation Backend | Salaries and allowance, `fixed` | Office Transportation expenses, `runrate` | `PL!Q60` | 0 / 0 |
| 6400007 Stock Difference Expenses | Depreciation & amortisation, `fixed` | Other Income, `runrate` | FS tidak memetakan (`PL!Q94` kosong); kembarannya 7100006 Opname Adjustment → `PL!Q109` Other Income | tidak ada di FS |

**Dampak:** P&L v1 production untuk Agustus–September tidak bergeser (saldo 0). Bulan lain yang bersaldo pada akun ini
pindah baris (total NIBT sama). Golden v1 memakai `supabase/seed/04_coa_map.sql` (tidak diubah) → tidak bergeser.

## Tidak diubah (dicatat untuk rekonsiliasi)

Akun yang seksinya berbeda antara app (`pl_line`) dan FS (kolom Q): 6300004 Maintenance Software (app opex, FS Other
Income), 6350001 Tax Expense (app opex Tax expenses, FS Other Expense), 7100011 Other Income Blasting (app Other
Income, FS Tax expenses). Perbedaan ini menggeser total opex vs lain-lain (bukan NIBT); dicatat sebagai "definisi" di
rekonsiliasi bila bersaldo.
