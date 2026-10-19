-- KGR-OS: koreksi FS acuan (K70, Q-v5.2-66: koreksi = versi baru), dibangkitkan scripts/fs_correction.py (jangan disunting tangan).
-- Lama (versi 1, docs/v5.2/kgr-os-data-fs.sql): reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx sha256 7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5
-- Baru (versi 2): 09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx sha256 fb2e3cf19025c6145a973148907f1112bdafa8be82174d2b7f445faaaeb938f3 (salinan 18 Okt; tidak di-commit)
-- 12 baris berubah; baris lain tetap versi 1. App membaca versi terbaru tiap baris (lib/v5/fs-recon-data.ts).
-- Prasyarat: ke-12 baris versi 1 dari berkas lama ada dengan nilai lama; bila tidak, skrip berhenti sebelum menyisipkan.
-- Bisa dijalankan ulang. Tabel cek di akhir: semua true.

-- every corrected row must find its version 1 with the old amount (or its version 2 from this file, on a re-run): otherwise
-- nothing is inserted (a missing month or another FS file in KGR-OS would otherwise be skipped row by row, silently)
do $$
begin
  if (select count(*) from (values
    ('2026-09-01'::date, 'BS', 53, 43845011.00, -2.00),
    ('2026-09-01'::date, 'BS', 58, 10983908421.92, 10940063408.92),
    ('2026-09-01'::date, 'BS', 65, 10983908421.92, 10940063408.92),
    ('2026-09-01'::date, 'BS', 72, -1642856872.19, -1599011859.19),
    ('2026-09-01'::date, 'BS', 77, 658708461.90, 702553474.90),
    ('2026-09-01'::date, 'PL', 19, -11593192.60, -5620863.60),
    ('2026-09-01'::date, 'PL', 24, -192772535.65, -154899851.65),
    ('2026-09-01'::date, 'PL', 37, -356010180.06, -312165167.06),
    ('2026-09-01'::date, 'PL', 39, -831442595.32, -787597582.32),
    ('2026-09-01'::date, 'PL', 51, -953903552.73, -910058539.73),
    ('2026-09-01'::date, 'PL', 58, -953903552.73, -910058539.73),
    ('2026-09-01'::date, 'PL', 68, -953903552.73, -910058539.73)
  ) as v(month, statement, row_no, amount, old_amount)
  where exists (select 1 from public.fs_statement_line o where o.month = v.month and o.statement = v.statement and o.row_no = v.row_no
                  and o.version = 1 and o.source_sha256 = '7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5' and o.amount = v.old_amount)
     or exists (select 1 from public.fs_statement_line o where o.month = v.month and o.statement = v.statement and o.row_no = v.row_no
                  and o.version = 2 and o.source_sha256 = 'fb2e3cf19025c6145a973148907f1112bdafa8be82174d2b7f445faaaeb938f3' and o.amount = v.amount)) <> 12 then
    raise exception 'koreksi FS tidak dijalankan: tidak semua 12 baris versi 1 (berkas lama, nilai lama) ada; jalankan dulu docs/v5.2/kgr-os-data-fs.sql';
  end if;
end $$;

insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256, version, locked_at)
select v.month, v.statement, v.sheet, v.row_no, v.line, v.amount, '09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx', 'fb2e3cf19025c6145a973148907f1112bdafa8be82174d2b7f445faaaeb938f3', 2, now()
from (values
  ('2026-09-01'::date, 'BS', 'BS - Management Report', 53, 'Accrued Expenses - Third Parties', 43845011.00, -2.00),
  ('2026-09-01'::date, 'BS', 'BS - Management Report', 58, 'TOTAL CURRENT LIABILITIES', 10983908421.92, 10940063408.92),
  ('2026-09-01'::date, 'BS', 'BS - Management Report', 65, 'TOTAL LIABILITIES', 10983908421.92, 10940063408.92),
  ('2026-09-01'::date, 'BS', 'BS - Management Report', 72, '- Current profit or loss', -1642856872.19, -1599011859.19),
  ('2026-09-01'::date, 'BS', 'BS - Management Report', 77, 'TOTAL EQUITY', 658708461.90, 702553474.90),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 19, 'Commission Expenses', -11593192.60, -5620863.60),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 24, 'Storage Expenses', -192772535.65, -154899851.65),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 37, 'TOTAL OPERATING EXPENSES', -356010180.06, -312165167.06),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 39, 'OPERATING INCOME', -831442595.32, -787597582.32),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 51, 'INCOME (LOSS) BEFORE TAX', -953903552.73, -910058539.73),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 58, 'NET INCOME FOR THE YEAR', -953903552.73, -910058539.73),
  ('2026-09-01'::date, 'PL', 'PL - Management Report', 68, 'TOTAL COMPREHENSIVE INCOME FOR THE YEAR', -953903552.73, -910058539.73)
) as v(month, statement, sheet, row_no, line, amount, old_amount)
where exists (select 1 from public.fs_statement_line o where o.month = v.month and o.statement = v.statement and o.row_no = v.row_no and o.version = 1 and o.source_sha256 = '7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5' and o.amount = v.old_amount)
on conflict (month, statement, row_no, version) do nothing;

select cek, ada from (values
  ('12 baris versi 2 dari berkas baru, terkunci',
   (select count(*) = 12 and count(locked_at) = 12 and bool_and(source_sha256 = 'fb2e3cf19025c6145a973148907f1112bdafa8be82174d2b7f445faaaeb938f3') from public.fs_statement_line where version = 2 and month in ('2026-08-01','2026-09-01'))),
  ('BS 2026-09 b.53 Accrued Expenses - Third Parties: versi terbaru = 43845011.00',
   (select amount = 43845011.00 from public.fs_statement_line where month = '2026-09-01' and statement = 'BS' and row_no = 53 order by version desc limit 1)),
  ('BS 2026-09 b.58 TOTAL CURRENT LIABILITIES: versi terbaru = 10983908421.92',
   (select amount = 10983908421.92 from public.fs_statement_line where month = '2026-09-01' and statement = 'BS' and row_no = 58 order by version desc limit 1)),
  ('BS 2026-09 b.65 TOTAL LIABILITIES: versi terbaru = 10983908421.92',
   (select amount = 10983908421.92 from public.fs_statement_line where month = '2026-09-01' and statement = 'BS' and row_no = 65 order by version desc limit 1)),
  ('BS 2026-09 b.72 - Current profit or loss: versi terbaru = -1642856872.19',
   (select amount = -1642856872.19 from public.fs_statement_line where month = '2026-09-01' and statement = 'BS' and row_no = 72 order by version desc limit 1)),
  ('BS 2026-09 b.77 TOTAL EQUITY: versi terbaru = 658708461.90',
   (select amount = 658708461.90 from public.fs_statement_line where month = '2026-09-01' and statement = 'BS' and row_no = 77 order by version desc limit 1)),
  ('PL 2026-09 b.19 Commission Expenses: versi terbaru = -11593192.60',
   (select amount = -11593192.60 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 19 order by version desc limit 1)),
  ('PL 2026-09 b.24 Storage Expenses: versi terbaru = -192772535.65',
   (select amount = -192772535.65 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 24 order by version desc limit 1)),
  ('PL 2026-09 b.37 TOTAL OPERATING EXPENSES: versi terbaru = -356010180.06',
   (select amount = -356010180.06 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 37 order by version desc limit 1)),
  ('PL 2026-09 b.39 OPERATING INCOME: versi terbaru = -831442595.32',
   (select amount = -831442595.32 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 39 order by version desc limit 1)),
  ('PL 2026-09 b.51 INCOME (LOSS) BEFORE TAX: versi terbaru = -953903552.73',
   (select amount = -953903552.73 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 51 order by version desc limit 1)),
  ('PL 2026-09 b.58 NET INCOME FOR THE YEAR: versi terbaru = -953903552.73',
   (select amount = -953903552.73 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 58 order by version desc limit 1)),
  ('PL 2026-09 b.68 TOTAL COMPREHENSIVE INCOME FOR THE YEAR: versi terbaru = -953903552.73',
   (select amount = -953903552.73 from public.fs_statement_line where month = '2026-09-01' and statement = 'PL' and row_no = 68 order by version desc limit 1))
) as t(cek, ada);
