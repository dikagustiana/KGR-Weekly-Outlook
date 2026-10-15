-- v3 F3b — M3 allocation FEFO + cut-off (PRD v3 §4.4 step 7, PLAN Fase 3 PR 3b). Additive and re-runnable.

-- "Alokasi hari ini" is a page for admin, ppic, sales and commercial_lead (PRD v3 §6): ppic and commercial_lead may
-- write allocations too (the F3a policy covers admin, sales, inventory_accounting).
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'allocation' and policyname = 'allocation_ins_ops') then
    create policy allocation_ins_ops on public.allocation for insert to authenticated
      with check ((select public.has_role('ppic','commercial_lead')));
    create policy allocation_upd_ops on public.allocation for update to authenticated
      using ((select public.has_role('ppic','commercial_lead'))) with check ((select public.has_role('ppic','commercial_lead')));
  end if;
end $$;

-- an allocation changes which lot a sale takes: rebuild the ledger from its date
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.allocation'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.allocation for each row execute function public.tg_needs_rebuild();
  end if;
end $$;

create index if not exists allocation_sales_line on public.allocation (sales_line_id) where deleted_at is null;
create index if not exists blast_event_reason on public.blast_event (date, reason) where deleted_at is null;
