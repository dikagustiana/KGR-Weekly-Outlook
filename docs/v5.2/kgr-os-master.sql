-- KGR-OS data master v5.2 (PRD v5.2-B B-R88), bundel DATA (bukan migrasi skema). Dijalankan agen atas delegasi Dika.
-- Sumber setiap angka: reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx
--   (sha256 7e68aa89751cd8938bd5c9cd4f961ebbbf8eed56ac55cf3ad1faf0d8fc3504c5, sama dengan fixtures/fs-2026-09/source.json).
-- Kenapa SQL, bukan upload template 8.3: jalur upload app tidak terjangkau dari lingkungan agen (Q-v5.2-6). Baris yang
-- ditulis sama dengan hasil upload template 8.3 (kolom template, source 'Manual'); baris template lama (amount null)
-- tidak diubah, sehingga bulan lain tetap "estimasi bulan lalu" / C55 PERIKSA sampai Finance mengisi.
-- Idempoten: on conflict (code) do nothing. Cek di akhir: semua baris true.
-- Tidak diisi (tidak ada sumber; BUTUH-DIKA D7/D8): rentang & rata-rata kelas K/S/B, yield per kelas, size_class_map,
-- capacity (PRD v5 baris 280/491/621: nilai mockup = ilustrasi, tidak boleh jadi seed), parameter.accurate_sales_kg /
-- accurate_opening_stock_value (C8/C9; Z_Kontrol model Excel juga "BELUM DIISI").
begin;
insert into public.fixed_cost_schedule (code, pl_line, account, description, amount_per_month, start_date, end_date, amortize, intercompany, vendor, cash_day_of_month, active, note, source)
select v.code, t.pl_line, t.account, t.description || ' ' || v.label, v.amount, v.start_date, v.end_date, t.amortize, t.intercompany, t.vendor, t.cash_day_of_month, true, v.note, 'Manual'
  from (values
    ('GAJI',         'GAJI-2026-08',         'Agustus 2026',   85565549.00::numeric, date '2026-08-01', date '2026-08-31', 'FS v2 ''PL - Management Report''!K23 = −85.565.549'),
    ('GAJI',         'GAJI-2026-09',         'September 2026', 82677332.00,          date '2026-09-01', date '2026-09-30', 'FS v2 ''PL - Management Report''!L23 = −82.677.332'),
    ('BUNGA',        'BUNGA-2026-08',        'Agustus 2026',   31911111.00,          date '2026-08-01', date '2026-08-31', 'FS v2 ''PL - Management Report''!K43 = −31.911.111'),
    ('BUNGA',        'BUNGA-2026-09',        'September 2026', 54022222.22,          date '2026-09-01', date '2026-09-30', 'FS v2 ''PL - Management Report''!L43 = −54.022.222,22'),
    ('SEWA-ABF-NMG', 'SEWA-ABF-NMG-2026-09', 'September 2026', 62450000.00,          date '2026-09-01', date '2026-09-30', 'FS v2 ''DI - Note''!D46 = 62.450.000 (DI-04 September, cost baru)')
  ) as v(template, code, label, amount, start_date, end_date, note)
  join public.fixed_cost_schedule t on t.code = v.template and t.deleted_at is null
on conflict (code) do nothing;

select c.cek, c.ok from (values
  ('5 baris jadwal Agu–Sep terisi',
     (select count(*) from public.fixed_cost_schedule where code in ('GAJI-2026-08','GAJI-2026-09','BUNGA-2026-08','BUNGA-2026-09','SEWA-ABF-NMG-2026-09') and amount_per_month is not null and active and deleted_at is null) = 5),
  ('total = 316.626.214,22',
     (select sum(amount_per_month) from public.fixed_cost_schedule where code in ('GAJI-2026-08','GAJI-2026-09','BUNGA-2026-08','BUNGA-2026-09','SEWA-ABF-NMG-2026-09')) = 316626214.22),
  ('baris template tidak berubah',
     (select count(*) from public.fixed_cost_schedule where code in ('GAJI','BUNGA','SEWA-ABF-NMG') and amount_per_month is null) = 3)
) as c(cek, ok);
commit;
