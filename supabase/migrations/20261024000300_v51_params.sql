-- v5.1 — the schema the later slices need (docs/PRD-v5.1.md K39, K46, O15; R11, R14, R33). Additive and re-runnable.
--
-- All schema objects of v5.1 ship with slice 1 (PR #32 sign-off question 1), so slices 2–4 need no migration and the
-- three files can be applied to KGR-OS together. The app starts calling advance_update_date in slice 2 and
-- lock_commitments in slice 3, and reads po_unsized_mode in slice 4; until then nothing calls or reads them.

-------------------------------------------------------------------------------- K39 update date moved by the data
-- After a journal, stock or WP upload for date d of an open week: update_date = max(update_date, d + 1), at most the
-- Monday after the week. Through this function only, so the week's RLS stays as it is.
create or replace function public.advance_update_date(p_week_id uuid, p_date date) returns date
language plpgsql security definer set search_path = '' as $$
declare w public.week%rowtype; nd date;
begin
  if not (select public.has_role('admin','finance','inventory_accounting','cost_accounting')) then
    raise exception 'Tanggal update dimajukan oleh upload Inventory Accounting, Cost Accounting atau Finance' using errcode = '42501';
  end if;
  select * into w from public.week where id = p_week_id;
  if not found then raise exception 'Minggu tidak ada'; end if;
  if w.status <> 'open' or p_date is null or p_date < w.week_start or p_date > w.week_start + 6 then return w.update_date; end if;
  nd := greatest(w.update_date, least(p_date + 1, w.week_start + 7));
  if nd <> w.update_date then update public.week set update_date = nd where id = w.id; end if;
  return nd;
end $$;
revoke all on function public.advance_update_date(uuid, date) from public, anon;
grant execute on function public.advance_update_date(uuid, date) to authenticated;

-------------------------------------------------------------------------------- K46 lock of next week's commitments
alter table public.price_list_week add column if not exists price_frozen_source text check (price_frozen_source in ('form','sku_price'));

-- One transaction: a draft that is a new version after a lock needs a reason (else nothing changes); every draft of
-- the week is locked (public.tg_commitment_guard supersedes the locked version and stamps the lock); the price list
-- row of each locked key gets the fresh price of the commitment and the frozen price from the form, else the frozen
-- reference price of the running week (sku_price, labelled). A price-list row already locked is left as it is.
-- The rebuild of the week is queued by the needs_rebuild triggers of 20261024000100.
create or replace function public.lock_commitments(p_week_start date, p_price_frozen jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0; missing text; prev_w uuid; pf numeric; src text;
begin
  if not (select public.has_role('admin','commercial_lead')) then
    raise exception 'Komitmen dikunci oleh Kepala Sales' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then raise exception 'Minggu harus hari Senin' using errcode = '22023'; end if;
  select string_agg(c.key, ', ' order by c.key) into missing
    from public.sales_commitment c
   where c.week_start = p_week_start and c.status = 'draft' and c.deleted_at is null
     and length(trim(coalesce(c.reason, ''))) < 5
     and exists (select 1 from public.sales_commitment l where l.week_start = c.week_start and l.key = c.key
                   and coalesce(l.size_kg, 0) = coalesce(c.size_kg, 0) and l.status = 'locked' and l.deleted_at is null);
  if missing is not null then
    raise exception 'Versi baru setelah kunci wajib alasan: %', missing using errcode = '23514';
  end if;
  for d in select c.id from public.sales_commitment c
            where c.week_start = p_week_start and c.status = 'draft' and c.deleted_at is null order by c.key, c.size_kg loop
    update public.sales_commitment set status = 'locked' where id = d.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Tidak ada draft komitmen untuk minggu %', p_week_start using errcode = '22023'; end if;
  select w.id into prev_w from public.week w where w.week_start = p_week_start - 7;
  for d in select c.key, c.price from public.sales_commitment c
            where c.week_start = p_week_start and c.status = 'locked' and c.deleted_at is null and c.price is not null loop
    if exists (select 1 from public.price_list_week p where p.week_start = p_week_start and p.key = d.key
                 and p.locked_at is not null and p.deleted_at is null) then continue; end if;
    pf := nullif(coalesce(p_price_frozen, '{}'::jsonb) ->> d.key, '')::numeric;
    src := case when pf is not null then 'form' end;
    if pf is null and prev_w is not null then
      select sp.ref_sell_price into pf from public.sku_price sp where sp.week_id = prev_w and sp.key = public.base_key(d.key) || '|Frozen';
      src := case when pf is not null then 'sku_price' end;
    end if;
    insert into public.price_list_week (week_start, key, price_fresh, price_frozen, price_frozen_source, locked_at, deleted_at, deleted_by)
    values (p_week_start, d.key, d.price, pf, src, now(), null, null)
    on conflict (week_start, key) do update
      set price_fresh = excluded.price_fresh, price_frozen = excluded.price_frozen, price_frozen_source = excluded.price_frozen_source,
          locked_at = excluded.locked_at, deleted_at = null, deleted_by = null;
  end loop;
  return n;
end $$;
revoke all on function public.lock_commitments(date, jsonb) from public, anon;
grant execute on function public.lock_commitments(date, jsonb) to authenticated;

-------------------------------------------------------------------------------- O15 PO lines without a size
-- warn (default): the karkas line is saved with size_kg null and counted as STD (C50); fail: the line is held
alter table public.parameter add column if not exists po_unsized_mode text not null default 'warn' check (po_unsized_mode in ('warn','fail'));
