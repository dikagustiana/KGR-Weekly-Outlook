-- v4 irisan 5 — M7 commercial (docs/PRD-v4.md §3.8, §6.7, K8, P3.9, §8 S5, journey B). Additive and re-runnable.
--
-- C38 in the database, not only in the form (S5). The guard of 20261017000200 checked an Order line before insert but
-- never used the approval up, so one approved discount could cover any number of lines sent straight to the API. From
-- here:
--   * the check runs after the row is written (floor_guard_v4) and links the covering approval to the line under a row
--     lock: one approval, one line, also for parallel requests;
--   * it covers every Order line, PO and spot alike (§7.1: C38 is for saving an order). Aktual lines (signed DOs from
--     Ops, invoices from Accurate) are delivery facts of an order that was checked when it was saved (Q74);
--   * an Order line under the floor without an approval cannot be allocated (journey B: "tidak bisa dialokasi sampai
--     approval sah"), e.g. a line entered while m7_approval was off;
--   * a spot sale (K8, P3.9): no PO number, today, before the cut-off time, parameter spot_enabled on, the key's
--     commercial status "jual hari ini" and at most its free fresh kg.
-- Everything stays inactive while the module flag m7_approval is off (C38) / spot_enabled is off (spot).

-------------------------------------------------------------------------------- helpers
-- Key of a sales line: key_manual, else the item map.
create or replace function public.sales_key(p_item_code text, p_key_manual text) returns text
language sql stable security definer set search_path = '' as $$
  select case when nullif(trim(coalesce(p_key_manual, '')), '') is not null then trim(p_key_manual)
              else (select m.key from public.item_map m where upper(trim(m.item_code)) = upper(trim(p_item_code)) and m.deleted_at is null limit 1) end;
$$;
revoke all on function public.sales_key(text, text) from public, anon;

-- Price floor of a key on a day: the latest commercial row within 14 days (lib/v3/discount.ts floors).
create or replace function public.floor_of(p_key text, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select c.price_floor from public.commercial_daily c
   where c.key = p_key and c.date <= p_date and c.date >= p_date - 14 and c.price_floor is not null
   order by c.date desc limit 1;
$$;
revoke all on function public.floor_of(text, date) from public, anon;

create or replace function public.m7_approval_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value ->> 'enabled')::boolean from public.app_setting s where s.key = 'm7_approval'), false);
$$;
revoke all on function public.m7_approval_on() from public, anon;

-- Take the approved discount that covers a line (already linked to it, else a free one), lock it, link it; null = none.
create or replace function public.take_approval(p_line uuid, p_key text, p_customer text, p_price numeric, p_kg numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid;
begin
  select a.id into aid from public.discount_approval a
   where a.status = 'approved' and a.key = p_key and coalesce(a.customer, '') = coalesce(p_customer, '')
     and a.requested_price <= p_price and a.kg >= p_kg and (a.sales_line_id = p_line or a.sales_line_id is null)
   order by (a.sales_line_id is not null) desc, a.decided_at, a.id
   limit 1 for update;
  if aid is not null then
    update public.discount_approval set sales_line_id = p_line where id = aid and sales_line_id is null;
  end if;
  return aid;
end $$;
revoke all on function public.take_approval(uuid, text, text, numeric, numeric) from public, anon, authenticated;

-------------------------------------------------------------------------------- C38 on sales lines
create or replace function public.tg_floor_guard_v4() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r text := public.app_role(); k text; fl numeric;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if r is null then return null; end if;                     -- server jobs and migrations
  if new.deleted_at is not null or new.price is null or new.kg is null then return null; end if;
  if coalesce(new.status, 'Order') <> 'Order' then return null; end if;
  if not public.m7_approval_on() then return null; end if;
  -- a change that does not touch the priced terms (fulfilled kg, demand status) is not checked again
  if tg_op = 'UPDATE' and old.deleted_at is null and new.price is not distinct from old.price and new.kg is not distinct from old.kg
     and new.item_code is not distinct from old.item_code and new.key_manual is not distinct from old.key_manual
     and new.customer is not distinct from old.customer and new.channel is not distinct from old.channel then
    return null;
  end if;
  k := public.sales_key(new.item_code, new.key_manual);
  if k is null then return null; end if;
  fl := public.floor_of(k, today);
  if fl is null or new.price >= fl then return null; end if;
  if public.take_approval(new.id, k, new.customer, new.price, new.kg) is null then
    raise exception 'C38: harga Rp % untuk % di bawah harga lantai Rp % tanpa approval diskon yang belum terpakai', round(new.price), k, round(fl)
      using errcode = '42501', hint = 'Ajukan approval diskon; satu approval untuk satu baris order.';
  end if;
  return null;
end $$;
revoke execute on function public.tg_floor_guard_v4() from public, anon, authenticated;

-------------------------------------------------------------------------------- C38 on allocation (journey B)
create or replace function public.tg_allocation_floor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.sales_line%rowtype; k text; fl numeric;
  today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if public.app_role() is null or new.deleted_at is not null then return new; end if;
  if not public.m7_approval_on() then return new; end if;
  select * into l from public.sales_line where id = new.sales_line_id;
  if not found or coalesce(l.status, 'Order') <> 'Order' or l.price is null or l.kg is null then return new; end if;
  k := public.sales_key(l.item_code, l.key_manual);
  if k is null then return new; end if;
  fl := public.floor_of(k, today);
  if fl is null or l.price >= fl then return new; end if;
  if public.take_approval(l.id, k, l.customer, l.price, l.kg) is null then
    raise exception 'C38: order % di bawah harga lantai (Rp % < Rp %) belum disetujui; tidak bisa dialokasi', k, round(l.price), round(fl) using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_allocation_floor() from public, anon, authenticated;

-------------------------------------------------------------------------------- spot (K8, P3.9)
create or replace function public.tg_spot_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r text := public.app_role(); p public.parameter%rowtype; c public.commercial_daily%rowtype; k text;
  now_j timestamp := now() at time zone 'Asia/Jakarta';
begin
  -- a new spot sale is an Order line; its delivery (Aktual) and later changes were checked when the sale was made
  if r is null or new.channel is distinct from 'spot' or new.deleted_at is not null or coalesce(new.status, 'Order') <> 'Order' then return new; end if;
  if tg_op = 'UPDATE' and old.channel = 'spot' then return new; end if;
  if r not in ('admin','sales','commercial_lead') then
    raise exception 'Penjualan spot oleh Sales atau commercial lead' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(new.po_ref, '')), '') is not null then
    raise exception 'Penjualan spot tanpa nomor PO' using errcode = '23514';
  end if;
  select * into p from public.parameter where week_id = new.week_id;
  if not coalesce(p.spot_enabled, false) then
    raise exception 'Jalur spot belum diaktifkan untuk minggu ini (parameter spot_enabled)' using errcode = '42501';
  end if;
  if new.date is distinct from now_j::date then
    raise exception 'Penjualan spot hanya untuk hari ini (%)', now_j::date using errcode = '23514';
  end if;
  if now_j::time >= coalesce(p.cut_off_time, time '14:00') then
    raise exception 'Cut-off % sudah lewat: sisa fresh diblast, bukan dijual spot', coalesce(p.cut_off_time, time '14:00') using errcode = '23514';
  end if;
  k := public.sales_key(new.item_code, new.key_manual);
  select * into c from public.commercial_daily d where d.key = k and d.date between now_j::date - 1 and now_j::date order by d.date desc limit 1;
  if not found or c.urgency is distinct from 'jual_hari_ini' then
    raise exception 'SKU % tidak berstatus jual hari ini di Komersial', coalesce(k, new.item_code) using errcode = '23514';
  end if;
  if new.kg is null or new.kg <= 0 or new.kg > coalesce(c.free_fresh_kg, 0) then
    raise exception 'Spot % kg melebihi stok fresh bebas % kg', new.kg, coalesce(c.free_fresh_kg, 0) using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_spot_guard() from public, anon, authenticated;

-------------------------------------------------------------------------------- triggers
do $$
begin
  -- the before-insert guard of 20261017000200 is replaced by the after-row guard that also uses the approval up
  if exists (select 1 from pg_trigger where tgname = 'floor_guard' and tgrelid = 'public.sales_line'::regclass) then
    drop trigger floor_guard on public.sales_line;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'floor_guard_v4' and tgrelid = 'public.sales_line'::regclass) then
    create trigger floor_guard_v4 after insert or update on public.sales_line for each row execute function public.tg_floor_guard_v4();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'spot_guard' and tgrelid = 'public.sales_line'::regclass) then
    create trigger spot_guard before insert or update on public.sales_line for each row execute function public.tg_spot_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'allocation_floor' and tgrelid = 'public.allocation'::regclass) then
    create trigger allocation_floor before insert on public.allocation for each row execute function public.tg_allocation_floor();
  end if;
end $$;

-------------------------------------------------------------------------------- scorecard: kg spot (§3.8)
alter table public.sales_scorecard_weekly add column if not exists kg_spot numeric(12,2);

