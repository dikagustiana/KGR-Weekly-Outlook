-- Rollback of 20261019000100_v4_release.sql (PRD v4 G8: one migration rolled back on a copy of the data).
-- Run by a person, on a copy first; never from the app. Restores the release path of before irisan 4: direct inserts
-- into release / month_outlook_version for Admin and Finance, the original week guard, no override tables, no C48
-- trigger, no own-mode default. The added nullable columns (overhead_rate.rate_per_head, lot_movement.revenue_date,
-- lot_movement.cost_ma_revenue) stay: PRD v4 §11 forbids dropping columns, and nothing reads them with the flag off.
begin;

drop policy if exists release_ins on public.release;
create policy release_ins on public.release for insert to authenticated with check ((select public.has_role('admin','finance')));
drop policy if exists month_outlook_version_ins on public.month_outlook_version;
create policy month_outlook_version_ins on public.month_outlook_version for insert to authenticated with check ((select public.has_role('admin','finance')));

drop function if exists public.release_week(uuid, text, text, text, jsonb);
drop function if exists public.release_month(date, text, text, text, date, jsonb, text, jsonb, numeric);
drop function if exists public.release_rejections(jsonb, text[], text, text, boolean);
drop function if exists public.release_stale_dates(date, date);
drop function if exists public.c48_batches(date, date);
drop function if exists public.nth_thursday(date, integer);

drop trigger if exists allocation_run_c48 on public.allocation_run;
drop function if exists public.tg_allocation_run_c48();
drop trigger if exists batch_cost_mode on public.batch;
drop function if exists public.tg_batch_cost_mode();

drop table if exists public.release_override;
drop function if exists public.tg_release_override_role();
drop table if exists public.release_override_policy;
drop index if exists public.lot_movement_revenue_date;
delete from public.app_setting where key = 'v4_release';

-- the week guard as 20261014000200 wrote it
create or replace function public.tg_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
begin
  if r = 'admin' or r is null then return new; end if;
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at','updated_by') or (o -> k) is not distinct from (n -> k) then continue; end if;
    if k = 'update_date' then continue; end if;
    if k = 'status' and r = 'finance' and old.status in ('open','released') and new.status in ('open','released') then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

commit;
