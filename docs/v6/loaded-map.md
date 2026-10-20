# PRD v6 R120 — pemetaan `computed.loaded` di jalur request

Sesudah irisan 2 jalur request tidak memuat minggu utuh (`loadWeek`): `WeekCtx.computed` hanya berisi hasil (`result`), sumbernya
(`snapshot`/`live`), label "dihitung …" (K79) dan catatan K80. Tipe `PageComputed` tidak punya `loaded`, jadi `tsc` menolak
akses baru ke `loaded` dari halaman.

| Pemakai | Dulu | Sekarang |
| --- | --- | --- |
| `lib/inputPage.ts` `lists()` (daftar item dan key di form input) | `loaded.inputs.item_map`, `.sku_keys` | `result.prepared.items`, `.master` (baris yang sama, satu-satu; `master` tanpa key kosong) |
| `components/WeekShell.tsx` (jumlah baris Ops) | `loaded.inputs.*_lines` | `result.prepared.{sales,receipts,batches,opening}[].src.source` |
| `w/[week]/upload` (key untuk wizard) | `loaded.inputs.sku_keys` | `result.prepared.master` |
| `w/[week]/input/penjualan` | `loaded.db.sales` | `weekInputRows(sb, "sales_line", week.id)` |
| `w/[week]/input/penerimaan` | `loaded.db.receipts` | `weekInputRows(sb, "receipt_line", …)` |
| `w/[week]/input/batch` | `loaded.db.batches` | `weekInputRows(sb, "batch", …)` |
| `w/[week]/input/stok-awal` | `loaded.db.opening` | `weekInputRows(sb, "opening_stock", …)` |
| `w/[week]/input/kas` | `loaded.db.cashPlan` | `weekInputRows(sb, "cash_plan", …)` |
| `w/[week]/input/parameter` | `loaded.db.parameter` | `weekParameter(sb, week.id)` |
| `w/[week]/outlook` (baris sumber) | `computeMs` ("dihitung dalam N ms") | `builtLabel` ("dihitung 28 Agu 17.05") + catatan K80 |
| `master/item` (kode baru minggu ini) | `loaded.inputs.{sales_lines,receipt_lines,opening_stock}` | `result.prepared.*[].src` |
| `master/coa` (akun tanpa mapping) | `loaded.inputs.{gl_lines,tb_opening}` | `result.prepared.{gl,tb}[].src` |
| `sku` (rekonsiliasi) | `computeForWeek(…).result` | `weekResultOf` |
| `lib/v3/cash.ts` (Kas, afiliasi) | `computeForWeek(…).result` | `weekResultOf` |
| `lib/v5/komersial-data.ts` (tile PPIC) | `computeForWeek(…).result` | `weekResultOf` |
| `lib/v3/monthly.ts`, `lib/v4/month.ts` (demand_status PO) | `loaded.db.sales` | `salesDemandStatus` (satu query sempit `id, demand_status` bila klien membaca snapshot) |
| `api/w/[week]/pdf`, `snapshot.json`, `stok.csv` | `computeForWeek` | `requestWeekResult` (snapshot yang sama dengan halaman; R124) |

Yang tetap menghitung (menulis snapshot, bukan jalur request): rebuild worker (`snapshot-builder`, builder mart lain dengan klien
servis), rilis (`release.ts`), `rollover.ts`, `upload.ts` (validasi sebelum simpan).

Aturan klien (`lib/week-source.ts`): klien sesi request ditandai pembaca snapshot oleh `RequestContext` bila `v6_snapshot_read`
hidup untuk role penonton; klien servis worker tidak pernah ditandai, jadi builder yang sama tetap menghitung (Q-v5.2-51).
