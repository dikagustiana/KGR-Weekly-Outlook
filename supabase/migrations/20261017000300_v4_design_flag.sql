-- v4 irisan 1 — feature flag of the new design and the management page "Minggu ini" (docs/PRD-v4.md §2 rule 7, §10).
-- Default off: with the flag off every page renders as before. With it on the rebuild job also writes the weekly rows
-- of pl_daily_v4 (§3.4). Additive and re-runnable.
insert into public.app_setting (key, value, note) values
  ('v4_design', '{"enabled": false}', 'PRD v4 irisan 1: bahasa visual baru, navigasi per peran, halaman Minggu ini')
on conflict (key) do nothing;

-- The weekly rows depend on week-level inputs without a date column (run-rate, parameter, sell prices, opening stock):
-- a change queues the Monday of its week, so the rebuild recomputes the week.
create or replace function public.tg_needs_rebuild_week() returns trigger
language plpgsql security definer set search_path = '' as $$
declare w uuid := coalesce((to_jsonb(coalesce(new, old)) ->> 'week_id')::uuid, null); d date;
begin
  select week_start into d from public.week where id = w;
  if d is not null and not exists (select 1 from public.rebuild_queue q where q.date = d and q.status = 'queued') then
    insert into public.rebuild_queue (date, reason) values (d, tg_table_name || ' ' || lower(tg_op));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.tg_needs_rebuild_week() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['runrate','parameter','sku_price','opening_stock'] loop
    if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild_week' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger needs_rebuild_week after insert or update or delete on public.%I for each row execute function public.tg_needs_rebuild_week()', t);
    end if;
  end loop;
end $$;
