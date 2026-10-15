-- v3 F4a — M5 cost drivers (PRD v3 §4.1 coa_map / cash_plan, §4.6, PLAN Fase 4 PR 4a). Additive and re-runnable.

-------------------------------------------------------------------------------- existing tables: new columns only
alter table public.coa_map add column if not exists driver_type text not null default 'none';
alter table public.coa_map add column if not exists rp_per_kg numeric(18,4);
alter table public.coa_map add column if not exists intercompany boolean not null default false;
alter table public.coa_map add column if not exists driver_basis text;
alter table public.cash_plan add column if not exists account_no text;
alter table public.cash_plan add column if not exists fixed_cost_schedule_id uuid;
alter table public.cash_plan add column if not exists kind text not null default 'plan';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coa_map_driver_type_check' and conrelid = 'public.coa_map'::regclass) then
    alter table public.coa_map add constraint coa_map_driver_type_check check (driver_type in ('fixed','variable','runrate','none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coa_map_driver_basis_check' and conrelid = 'public.coa_map'::regclass) then
    alter table public.coa_map add constraint coa_map_driver_basis_check check (driver_basis is null or driver_basis in ('kg_cut','kg_sold','kg_lb'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_plan_kind_check' and conrelid = 'public.cash_plan'::regclass) then
    alter table public.cash_plan add constraint cash_plan_kind_check check (kind in ('plan','actual'));
  end if;
end $$;

-------------------------------------------------------------------------------- fixed cost schedule (Finance)
create table if not exists public.fixed_cost_schedule (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                    -- stable seed / upload reference
  pl_line           text not null,
  account           text,
  description       text not null,
  amount_per_month  numeric(18,2),                  -- null = not set yet (Finance fills it); amortised prepaid: total / months
  start_date        date not null,
  end_date          date,
  amortize          boolean not null default false,
  prepaid_total     numeric(18,2),
  intercompany      boolean not null default false,
  vendor            text,
  cash_day_of_month integer check (cash_day_of_month is null or cash_day_of_month between 1 and 31),
  active            boolean not null default true,
  note              text,
  source            text not null default 'Manual' check (source in ('Accurate','Ops','Manual')),
  deleted_at        timestamptz,
  deleted_by        text,
  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  updated_by        text
);
create index if not exists fixed_cost_schedule_line on public.fixed_cost_schedule (pl_line, start_date) where deleted_at is null;
create index if not exists cash_plan_fixed_cost on public.cash_plan (fixed_cost_schedule_id) where fixed_cost_schedule_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_plan_fixed_cost_fk' and conrelid = 'public.cash_plan'::regclass) then
    alter table public.cash_plan add constraint cash_plan_fixed_cost_fk foreign key (fixed_cost_schedule_id) references public.fixed_cost_schedule(id);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.fixed_cost_schedule'::regclass) then
    create trigger stamp before insert or update on public.fixed_cost_schedule for each row execute function public.tg_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.fixed_cost_schedule'::regclass) then
    create trigger audit after insert or update or delete on public.fixed_cost_schedule for each row execute function public.tg_audit();
  end if;
  alter table public.fixed_cost_schedule enable row level security;
  -- finance detail (salaries, rent, interest): not for sales (PRD v3 Q17)
  if not exists (select 1 from pg_policies where tablename = 'fixed_cost_schedule' and policyname = 'fixed_cost_schedule_read') then
    create policy fixed_cost_schedule_read on public.fixed_cost_schedule for select to authenticated using ((select public.is_app_user()) and not (select public.has_role('sales')));
    create policy fixed_cost_schedule_ins on public.fixed_cost_schedule for insert to authenticated with check ((select public.has_role('admin','finance')));
    create policy fixed_cost_schedule_upd on public.fixed_cost_schedule for update to authenticated using ((select public.has_role('admin','finance'))) with check ((select public.has_role('admin','finance')));
  end if;
  -- Finance sets the driver of an account (driver columns only, see guard); the chart itself stays Admin's
  if not exists (select 1 from pg_policies where tablename = 'coa_map' and policyname = 'coa_map_upd_driver') then
    create policy coa_map_upd_driver on public.coa_map for update to authenticated using ((select public.has_role('finance'))) with check ((select public.has_role('finance')));
  end if;
end $$;

create or replace function public.tg_coa_driver_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null or r = 'admin' then return new; end if;
  if (to_jsonb(new) - array['driver_type','rp_per_kg','intercompany','driver_basis','updated_at','updated_by'])
     is distinct from (to_jsonb(old) - array['driver_type','rp_per_kg','intercompany','driver_basis','updated_at','updated_by']) then
    raise exception 'Peran % hanya boleh mengubah driver biaya akun', r using errcode = '42501';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'coa_driver_guard' and tgrelid = 'public.coa_map'::regclass) then
    create trigger coa_driver_guard before update on public.coa_map for each row execute function public.tg_coa_driver_guard();
  end if;
end $$;

-------------------------------------------------------------------------------- default drivers (V24; only accounts still 'none')
update public.coa_map set driver_type = case
    when pl_line like 'COGS%' or pl_line = 'Other COGS - Expedition' then 'variable'
    when pl_line in ('Delivery Expenses','Commission Expenses','Packaging') then 'variable'
    when pl_line in ('Salaries and allowance','Rent Expenses','Depreciation & amortisation','Interest Expense','Storage Expenses') then 'fixed'
    else 'runrate' end,
  driver_basis = case
    when pl_line like 'COGS%' or pl_line = 'Other COGS - Expedition' then 'kg_cut'
    when pl_line in ('Delivery Expenses','Commission Expenses','Packaging') then 'kg_sold'
    else driver_basis end
where type = 'LabaRugi' and driver_type = 'none' and pl_line is not null
  and pl_line not like 'Revenue%' and pl_line <> 'Other Income';

-------------------------------------------------------------------------------- seed from FS September 2026 (PRD v3 §4.6; amounts only where certain)
insert into public.fixed_cost_schedule (code, pl_line, description, amount_per_month, start_date, end_date, amortize, prepaid_total, intercompany, vendor, note, active) values
  ('SEWA-RPA-RAWA-TERATE', 'Rent Expenses', 'Sewa RPA Rawa Terate 1 tahun (amortisasi prepaid)', null, '2026-11-01', '2027-10-31', true, 1133790000, false,
   'PUSPEL KESEHATAN HEWAN DAN PETERNAKAN', 'FS PREPAID RENT baris 11: 1.133.790.000 dibayar 24 Agu 2026, amortisasi mulai 1 Nov 2026 (grace 2 bln) → 94.482.500 / bulan', true),
  ('DEPRESIASI', 'Depreciation & amortisation', 'Depresiasi aset tetap (bangunan, peralatan kantor)', 10393461.35, '2026-01-01', null, false, null, false,
   null, 'FS PL Jan–Agu 10.393.461,35 / bulan; September 0 di FS (belum dijurnal?) — Finance konfirmasi', true),
  ('GAJI', 'Salaries and allowance', 'Gaji dan tunjangan', null, '2026-01-01', null, false, null, false,
   null, 'Isi oleh Finance. FS: Agu 85.565.549, Sep 82.677.332', true),
  ('SEWA-ABF-NMG', 'Storage Expenses', 'Sewa ABF NMG', null, '2026-09-01', null, false, null, false,
   'NMG', 'Isi oleh Finance. DI-04 September: 62.450.000 (cost baru)', true),
  ('BUNGA', 'Interest Expense', 'Bunga pinjaman', null, '2026-05-01', null, false, null, true,
   null, 'Isi oleh Finance. FS: Agu 31.911.111, Sep 54.022.222; diasumsikan ke afiliasi (Other Payable - Related Parties 9.845,9 jt)', true),
  ('DEPOSIT-DS-CS', 'Storage Expenses', 'Deposit sewa cold storage 20FT 2 bulan (DS Solutions)', null, '2026-07-22', null, false, 38400000, false,
   'PT DS SOLUTIONS INTERNATIONAL', 'FS PREPAID OTHER: deposit, dipakai 2 bulan sebelum masa sewa berakhir — bukan biaya bulanan', false),
  ('DEPOSIT-DS-ABF', 'Storage Expenses', 'Deposit ABF 20FT 2 bulan (DS Solutions)', null, '2026-07-22', null, false, 41000000, false,
   'PT DS SOLUTIONS INTERNATIONAL', 'FS PREPAID OTHER: deposit, dipakai 2 bulan sebelum masa sewa berakhir — bukan biaya bulanan', false)
on conflict (code) do nothing;
