-- v5.2 B5/2 — the FS as the reference of the dashboard (docs/PRD-v5.2-B-db.md B-R86; K70, O25–O27). Additive and re-runnable.
-- Registers schema version 5.2.4.
--
-- fs_statement_line: the rows of the Management Report sheets of the financial statements, per month, as they are in the
--   file (the source file name and its sha256 travel with every row). A row with locked_at never changes and is never
--   deleted, by any role (Admin included); a correction is a new version (K70). Imported by B-R91, not by this file.
-- fs_line_map: which app line is compared with which FS row, and with which sign (app amount × sign against the FS row).
--   Finance keeps it; status draft until Finance agrees. Seeded below with the 15 pairs of the minimum mapping of PRD
--   v5.2-A R68 (packages/engine/src/fs-map.ts FS_MIN_MAP), all draft.
-- Read: admin, finance, management, operations_director. Write: finance, admin. Nobody else, anon nothing.
-- release_override_policy gets C59 (Finance), by this migration only (O38).
-- audit_log is read by every app user and the audit trigger of fs_statement_line copies the old and new values (the
--   amounts) of an update or a delete: a restrictive policy keeps the trail of the two FS tables to the readers of the
--   tables. fs_line_map has no audit trigger (tg_audit names a row by id, key, item_code, account, email or week_id; this
--   table has none): updated_by and updated_at tell who wrote last.
--
-- Seed provenance. Every row number and label was read again from the workbook
-- reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx (sha256 7e68aa89…04c5), sheets "PL - Management Report" and
-- "BS - Management Report" (cells in column K = 31 Aug 2026 and L = 30 Sep 2026 of the same row); the app line is a key
-- of packages/engine/src/fs-app.ts (appPlLines / appBsLines). Both sides use the same sign (revenue and assets positive,
-- costs negative on the P&L; liabilities and equity positive on the balance sheet), hence sign 1 everywhere. Rows without
-- a pair in the app (rincian beban, aset tetap, pajak dibayar di muka, akrual, …) are left out: Finance adds them.
-- docs/v5.2/b5.md lists the cells and values per row; docs/v5.2/bukti/b5-fs-seed.txt is the check against the workbook.

-------------------------------------------------------------------------------- fs_statement_line (B-R86, K70)
create table if not exists public.fs_statement_line (
  id            uuid primary key default gen_random_uuid(),
  month         date not null check (extract(day from month) = 1),
  statement     text not null check (statement in ('PL', 'BS')),
  sheet         text not null,
  row_no        integer not null check (row_no > 0),
  line          text not null,
  amount        numeric(20,2),
  source_file   text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  version       integer not null default 1 check (version >= 1),
  locked_at     timestamptz,
  created_by    text default nullif(public.current_email(), ''),
  created_at    timestamptz not null default now(),
  unique (month, statement, row_no, version)
);
comment on table public.fs_statement_line is 'PRD v5.2 B-R86 / K70: rows of the FS Management Report per month as imported (file + sha256); a row with locked_at is never changed or deleted, a correction is a new version';
comment on column public.fs_statement_line.month is 'first day of the month the row belongs to';
comment on column public.fs_statement_line.row_no is 'Excel row of the sheet (the "b." number of fs_line_map)';
comment on column public.fs_statement_line.amount is 'Rupiah as in the file; null = the row has no number in that month';
comment on column public.fs_statement_line.locked_at is 'set = the row is final: no update, no delete, by any role';

-- a locked row does not change and is not deleted (42501), whoever asks: Admin and the service role included
create or replace function public.tg_fs_statement_line_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    raise exception 'Baris FS % % b.% versi % sudah dikunci (%): koreksi = versi baru', to_char(old.month, 'YYYY-MM'), old.statement, old.row_no, old.version, old.locked_at::text
      using errcode = '42501';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
revoke execute on function public.tg_fs_statement_line_lock() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fs_statement_line_lock' and tgrelid = 'public.fs_statement_line'::regclass) then
    create trigger fs_statement_line_lock before update or delete on public.fs_statement_line
      for each row execute function public.tg_fs_statement_line_lock();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.fs_statement_line'::regclass) then
    create trigger audit after insert or update or delete on public.fs_statement_line for each row execute function public.tg_audit();
  end if;
end $$;

-------------------------------------------------------------------------------- fs_line_map (B-R86, O25–O27)
create table if not exists public.fs_line_map (
  statement  text not null check (statement in ('PL', 'BS')),
  row_no     integer not null check (row_no > 0),
  app_line   text not null check (length(trim(app_line)) > 0),
  sign       integer not null check (sign in (-1, 1)),
  note       text,
  status     text not null default 'draft' check (status in ('draft', 'agreed')),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (statement, row_no)
);
comment on table public.fs_line_map is 'PRD v5.2 B-R86: pairs an app line with a row of fs_statement_line (compared as app amount × sign against the FS row); Finance keeps it, draft until agreed';
comment on column public.fs_line_map.row_no is 'Excel row of the FS sheet (PL or BS - Management Report), as fs_statement_line.row_no';
comment on column public.fs_line_map.app_line is 'key of an app line (packages/engine/src/fs-app.ts)';
comment on column public.fs_line_map.status is 'draft = proposed, agreed = Finance agreed the pair';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.fs_line_map'::regclass) then
    create trigger stamp before insert or update on public.fs_line_map for each row execute function public.tg_stamp();
  end if;
end $$;

-------------------------------------------------------------------------------- the audit trail of the FS rows is for their readers
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_fs_redact') then
    create policy audit_log_fs_redact on public.audit_log as restrictive for select to authenticated
      using (table_name <> all (array['fs_statement_line', 'fs_line_map'])
             or (select public.has_role('admin', 'finance', 'management', 'operations_director')));
  end if;
end $$;

-------------------------------------------------------------------------------- RLS and privileges (both tables)
alter table public.fs_statement_line enable row level security;
alter table public.fs_line_map enable row level security;

-- the default privileges of a Supabase database hand every table to anon, authenticated and service_role
revoke all on public.fs_statement_line from public, anon, authenticated, service_role;
revoke all on public.fs_line_map from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.fs_statement_line to authenticated, service_role;
grant select, insert, update, delete on public.fs_line_map to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['fs_statement_line', 'fs_line_map'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.has_role(''admin'', ''finance'', ''management'', ''operations_director'')))', t || '_read', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_ins') then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_role(''finance'', ''admin'')))', t || '_ins', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_upd') then
      execute format('create policy %I on public.%I for update to authenticated using ((select public.has_role(''finance'', ''admin''))) with check ((select public.has_role(''finance'', ''admin'')))', t || '_upd', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_del') then
      execute format('create policy %I on public.%I for delete to authenticated using ((select public.has_role(''finance'', ''admin'')))', t || '_del', t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------- seed: the minimum mapping (all draft)
-- PL = "PL - Management Report", BS = "BS - Management Report"; labels as read from column B of the workbook.
insert into public.fs_line_map (statement, row_no, app_line, sign, note, status, updated_by) values
  ('PL', 12, 'revenue',                   1, 'Σ Revenue - LB Main Product, LB By Product, Trading (jurnal + penyesuaian tutup buku)', 'draft', 'migrasi v52_fs'),                                   -- "Revenue"
  ('PL', 13, 'cogs',                      1, 'Σ COGS dan Other COGS; mode memo (O24 b): tanpa Selisih costing dan Biaya kapasitas idle', 'draft', 'migrasi v52_fs'),                              -- "Cost of Sales"
  ('PL', 15, 'gp',                        1, 'Revenue + COGS (mode memo: tanpa baris v5)', 'draft', 'migrasi v52_fs'),                                                                           -- " GROSS PROFIT "
  ('PL', 37, 'opex',                      1, 'semua baris selain Revenue, COGS, dan pendapatan/beban lain (termasuk penyusutan dan pajak)', 'draft', 'migrasi v52_fs'),                           -- "TOTAL OPERATING EXPENSES"
  ('PL', 49, 'other',                     1, 'Interest Expense, Other Income, Other Expense', 'draft', 'migrasi v52_fs'),                                                                        -- "TOTAL OTHER INCOME (EXPENSE)"
  ('PL', 51, 'nibt',                      1, 'NIBT jurnal; mode memo: tanpa NIBT manajemen', 'draft', 'migrasi v52_fs'),                                                                         -- "INCOME (LOSS) BEFORE TAX"
  ('BS', 14, 'kas',                       1, 'saldo kas dan bank akhir bulan (TB awal + jurnal)', 'draft', 'migrasi v52_fs'),                                                                    -- "Cash and cash equivalents"
  ('BS', 17, 'piutang_pihak_ketiga',      1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Receivables - Third Parties"
  ('BS', 18, 'piutang_pihak_berelasi',    1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Receivables - Related Parties"
  ('BS', 23, 'persediaan_produk',         1, 'saldo buku besar (bs_line Inventory - Product)', 'draft', 'migrasi v52_fs'),                                                                       -- "Inventory - Product"
  ('BS', 24, 'persediaan_trading',        1, 'saldo buku besar (bs_line Inventory - Trading)', 'draft', 'migrasi v52_fs'),                                                                       -- "Inventory - Trading"
  ('BS', 47, 'utang_dagang_pihak_ketiga', 1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Payables - Third Parties"
  ('BS', 48, 'utang_dagang_afiliasi',     1, null, 'draft', 'migrasi v52_fs'),                                                                                                                   -- "Trade Payables - Affiliates"
  ('BS', 51, 'utang_lain_afiliasi',       1, 'pinjaman dan utang lain afiliasi', 'draft', 'migrasi v52_fs'),                                                                                     -- "Other Payable - Related Parties"
  ('BS', 77, 'ekuitas',                   1, 'Shareholder Equity + Retained earnings + laba tahun berjalan', 'draft', 'migrasi v52_fs')                                                          -- "TOTAL EQUITY"
on conflict (statement, row_no) do nothing;

-------------------------------------------------------------------------------- C59: Finance's override of the FS reconciliation
insert into public.release_override_policy (code, allowed_roles, note)
values ('C59', array['finance'], 'PRD v5.2 O25–O27: rekonsiliasi dashboard dengan FS (selisih di atas toleransi, atau FS belum diimpor); Finance dengan alasan dan bukti')
on conflict (code) do nothing;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.4') on conflict (version) do nothing;
