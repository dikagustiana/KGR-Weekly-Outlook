-- v4 irisan 3 — M3 PPIC (docs/PRD-v4.md §3.1 P3.1–P3.9, K1, K2, K8, §6.4, §6.5). Additive and re-runnable.
-- demand_weekly carries the production unit, its class (K1) and where the forecast came from (K2); plan_week records
-- that it was saved on placeholder yields (C42); plan_check_reason keeps the written reason that lets a PERIKSA
-- control open the next step of the Rencana page; capacity gets empty rows for PPIC to fill (P3.6), no numbers.

alter table public.demand_weekly add column if not exists unit text;
alter table public.demand_weekly add column if not exists product_class text;
alter table public.demand_weekly add column if not exists source_forecast text;
alter table public.plan_week add column if not exists yield_provisional boolean not null default false;
alter table public.plan_week add column if not exists controls jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demand_weekly_product_class_check' and conrelid = 'public.demand_weekly'::regclass) then
    alter table public.demand_weekly add constraint demand_weekly_product_class_check check (product_class is null or product_class in ('main','by_product'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demand_weekly_source_forecast_check' and conrelid = 'public.demand_weekly'::regclass) then
    alter table public.demand_weekly add constraint demand_weekly_source_forecast_check check (source_forecast is null or source_forecast in ('sales','stat'));
  end if;
end $$;

-- §6.4: "langkah berikutnya terkunci sampai kontrol langkah sebelumnya LULUS atau PERIKSA dengan alasan"
create table if not exists public.plan_check_reason (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  code        text not null check (code ~ '^C[0-9]{2}$'),
  reason      text not null check (length(trim(reason)) >= 5),
  deleted_at  timestamptz,
  deleted_by  text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index if not exists plan_check_reason_week_code on public.plan_check_reason (week_start, code) where deleted_at is null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.plan_check_reason'::regclass) then
    create trigger stamp before insert or update on public.plan_check_reason for each row execute function public.tg_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.plan_check_reason'::regclass) then
    create trigger audit after insert or update or delete on public.plan_check_reason for each row execute function public.tg_audit();
  end if;
end $$;
alter table public.plan_check_reason enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'plan_check_reason' and policyname = 'plan_check_reason_read') then
    create policy plan_check_reason_read on public.plan_check_reason for select to authenticated using ((select public.is_app_user()));
    create policy plan_check_reason_ins on public.plan_check_reason for insert to authenticated with check ((select public.has_role('admin','ppic')));
    create policy plan_check_reason_upd on public.plan_check_reason for update to authenticated
      using ((select public.has_role('admin','ppic'))) with check ((select public.has_role('admin','ppic')));
  end if;
end $$;

-- P3.6: capacity rows for two periods with empty values and a description; PPIC fills the numbers (C47 stays
-- BELUM DIISI while cut_capacity_head is null). Maklon until 31 Oct, RPA Rawa Terate from 1 Nov.
insert into public.capacity (date, cut_capacity_head, chiller_kg, abf_kg, note)
select d::date, null, null, null,
       case when d < date '2026-11-01' then 'Maklon (s.d. 31 Okt 2026): kapasitas potong, chiller, ABF diisi PPIC'
            else 'RPA Rawa Terate (mulai 1 Nov 2026): kapasitas potong, chiller, ABF diisi PPIC' end
from generate_series(date '2026-10-19', date '2026-11-29', interval '1 day') d
on conflict (date) do nothing;

-- K7: one delivery document per PO line once (re-uploading the delivery CSV, or two people pressing Terkirim with the
-- same DO number, cannot record it twice)
create unique index if not exists delivery_line_document on public.delivery (sales_line_id, document_ref) where deleted_at is null and document_ref is not null;
