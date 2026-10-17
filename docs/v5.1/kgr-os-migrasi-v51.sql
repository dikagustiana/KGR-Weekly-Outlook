-- KGR-OS: 3 migrasi v5.1 sekaligus, untuk SQL Editor Supabase (satu kali Run). Dijalankan manusia setelah sign-off.
--
-- Isi: file supabase/migrations/20261024000100 s.d. 20261024000300, disambung urut nama, isi tiap file tidak diubah.
-- Tambahan di luar file migrasi hanya dua: cek prasyarat v5 di awal dan tabel cek di akhir.
-- SQL Editor menjalankan semuanya dalam satu transaksi: error di mana pun membatalkan semuanya (tidak ada yang
-- setengah terpasang). Semua file bisa dijalankan ulang (bukti: docs/v5.1/bukti/irisan-1-migrasi-rerun.txt).
-- Hasil yang benar: tabel 12 baris, kolom ada semuanya true. Tidak ada flag yang dinyalakan.
-- Satu-satunya perubahan data: email sales_assignment ditulis huruf kecil (R9; guard sudah membandingkan lower()).
--
-- sha256 file sumber (cek: sha256sum supabase/migrations/<file>):
--   83778f71d1be563da2718e98e29c3b1047fc826d5f71221539542265e7b5388c  20261024000100_v51_release.sql
--   698ce7b6b9950abdbdde65eba022cbbf6d49a62eb0de8d15113cc7cfa113aa9a  20261024000200_v51_security.sql
--   842847ecd6edd9b794fd59b1cdaf081f03acbba54c8bd1041e3cdd3281ba38bd  20261024000300_v51_params.sql

-------------------------------------------------------------------------------- prasyarat: v5 sudah terpasang
do $$
begin
  if to_regclass('public.input_completeness_daily') is null or to_regclass('public.commercial_daily_sales_v5') is null
     or to_regclass('public.input_reminder') is null or to_regclass('public.price_list_week') is null then
    raise exception 'Migrasi v5 belum lengkap di database ini (docs/v5/kgr-os-migrasi-v4-v5-sekaligus.sql dulu); v5.1 tidak dijalankan';
  end if;
end $$;

-------------------------------------------------------------------------------- 1/3 20261024000100_v51_release.sql
-- v5.1/1 — release (docs/PRD-v5.1.md K43, K44, K45, K47; R1, R2, R3, R5, R13). Additive and re-runnable.
--
-- K44: the task "release_week" is not a cell of the completeness grid (it is done by the release itself), so K35 does
-- not count it. K45: with v5_input on, a week without any grid row is not released ("grid belum dibangun"). K47: the
-- snapshot's controls_v3 C53 (WP past its deadline) holds the release like a v1 control, lifted by a Finance override
-- (policy C53, 20261023000100), strict mode as release_rejections. K43: base_key() for assignments and commitments.
-- New rebuild triggers for the v5 tables that change demand, plan or price (R13). Nothing here is read by the v1 engine.

-------------------------------------------------------------------------------- K43 base key
-- "RPA|Karkas|Fresh" → "RPA|Karkas"; a key without a form suffix is returned as is
create or replace function public.base_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(p, '\|(Fresh|Frozen|n/a)$', '')
$$;
grant execute on function public.base_key(text) to authenticated;

-------------------------------------------------------------------------------- release_week (v4 §7.2 + K35, K44, K45, K47)
create or replace function public.release_week(p_week_id uuid, p_json text, p_sha text, p_pdf_path text, p_ops jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.week%rowtype; snap jsonb; is_strict boolean; bad text; stale text; red text; rid uuid; email text := public.current_email();
begin
  if not (select public.has_role('admin','finance')) then
    raise exception 'Rilis mingguan hanya oleh Admin atau Finance' using errcode = '42501';
  end if;
  select * into w from public.week where id = p_week_id;
  if not found then raise exception 'Minggu tidak ada'; end if;
  if w.status = 'closed' then raise exception 'Minggu % sudah ditutup', w.week_start using errcode = '42501'; end if;
  if encode(sha256(convert_to(p_json, 'UTF8')), 'hex') <> p_sha then
    raise exception 'Snapshot berubah: SHA-256 tidak cocok' using errcode = '22000';
  end if;
  snap := p_json::jsonb;
  if snap -> 'controls' -> 'controls' is null then raise exception 'Snapshot tanpa kontrol' using errcode = '22000'; end if;
  is_strict := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v4_release'), false);
  bad := public.release_rejections(snap -> 'controls' -> 'controls', null, 'week', w.week_start::text, is_strict);
  -- K47: C53 of the v3 controls in the snapshot (present while v5_costing is on)
  bad := nullif(concat_ws('; ', bad, public.release_rejections(snap -> 'controls_v3', array['C53'], 'week', w.week_start::text, is_strict)), '');
  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  end if;
  -- K35 (flag v5_input): red cells of the week (late, or not due when built and past the deadline now), without the
  -- release task itself (K44); a week without any grid row is not released (K45)
  if coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_input'), false) then
    if not exists (select 1 from public.input_completeness_daily c where c.date between w.week_start and (w.week_start + 6) and c.kind <> 'release_week') then
      bad := concat_ws('; ', bad, 'K35: grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas');
    else
      select string_agg(c.kind || ' ' || to_char(c.date, 'DD/MM'), ', ' order by c.date, c.kind) into red
        from public.input_completeness_daily c
       where c.date between w.week_start and (w.week_start + 6)
         and c.kind <> 'release_week'
         and (c.status = 'late' or (c.status = 'not_due' and c.due_at is not null and c.due_at <= now()));
      if red is not null and not exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                                            and o.code = 'K35' and o.deleted_at is null) then
        bad := concat_ws('; ', bad, 'K35 kelengkapan data merah: ' || red);
      end if;
    end if;
  end if;
  if bad is not null then
    raise exception 'Rilis ditolak: %', bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.release (week_id, update_date, engine_version, snapshot, snapshot_sha256, pdf_path, control_status, controls, ops_rows, released_by)
  values (w.id, w.update_date, coalesce(snap ->> 'engineVersion', ''), snap, p_sha, p_pdf_path, coalesce(snap -> 'controls' ->> 'overall', ''), snap -> 'controls', coalesce(p_ops, '[]'::jsonb), email)
  returning id into rid;
  update public.week set status = 'released' where id = w.id and status = 'open';
  return rid;
end $$;
revoke all on function public.release_week(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.release_week(uuid, text, text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- R13 rebuild triggers on the v5 tables
-- The date of a row: date / origin_date / week_start as public.tg_needs_rebuild; through plan_week_id for the class
-- plan and the surplus answers; a size → class mapping counts from its effective date, at the earliest this week.
create or replace function public.tg_needs_rebuild_v51() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old)); d date;
begin
  d := coalesce(nullif(r ->> 'date', '')::date, nullif(r ->> 'origin_date', '')::date, nullif(r ->> 'week_start', '')::date);
  if d is null and nullif(r ->> 'plan_week_id', '') is not null then
    select p.week_start into d from public.plan_week p where p.id = (r ->> 'plan_week_id')::uuid;
  end if;
  if d is null and nullif(r ->> 'effective_from', '') is not null then
    d := greatest((r ->> 'effective_from')::date, date_trunc('week', (now() at time zone 'Asia/Jakarta'))::date);
  end if;
  if d is not null and not exists (select 1 from public.rebuild_queue q where q.date = d and q.status = 'queued') then
    insert into public.rebuild_queue (date, reason) values (d, tg_table_name || ' ' || lower(tg_op));
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.tg_needs_rebuild_v51() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sales_commitment','price_list_week','size_class_map','plan_week_class','surplus_response'] loop
    if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger needs_rebuild after insert or update or delete on public.%I for each row execute function public.tg_needs_rebuild_v51()', t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------- 2/3 20261024000200_v51_security.sql
-- v5.1/1 — security (docs/PRD-v5.1.md K43, K49, K53; R5, R7, R8, R9, R40). Additive and re-runnable.
--
-- K43: an assignment key may be a full SKU key or a base key; guards and the sales view compare base_key() on both
-- sides. K49: Sales write PO lines only for their assigned customers and keys (K32 in the database, not only in the
-- app). K53: the v5 sales view hides the v5 cost columns when the week's parameter.sales_sees_cost is false. R40: the
-- admin may soft-delete a locked commitment or price-list row (not unlock it); a retired price-list row may be
-- replaced. The only replacements are create or replace of functions and of the view with the same column list, and
-- alter policy of the two Sales read scopes (K43); R9 normalises the assignment e-mail to lower case.

-------------------------------------------------------------------------------- price list: soft delete (R40)
alter table public.price_list_week add column if not exists deleted_at timestamptz;
alter table public.price_list_week add column if not exists deleted_by text;

-------------------------------------------------------------------------------- K26 / K43 commitment guard
create or replace function public.tg_commitment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.app_role(); prev uuid;
begin
  if r is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Komitmen dibuat sebagai draft, lalu dikunci Kepala Sales' using errcode = '42501'; end if;
    if r = 'sales' and not exists (select 1 from public.sales_assignment a
        where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(new.key))) then
      raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
    end if;
    new.version := coalesce((select max(c.version) from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
                              and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0)), 0) + 1;
    if new.version > 1 and exists (select 1 from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
        and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0) and c.status = 'locked' and c.deleted_at is null)
       and length(trim(coalesce(new.reason, ''))) < 5 then
      raise exception 'Komitmen sudah dikunci: versi baru wajib alasan' using errcode = '23514';
    end if;
    new.locked_by := null; new.locked_at := null;
    return new;
  end if;
  -- UPDATE
  if pg_trigger_depth() > 1 and old.status = 'locked' and new.status = 'superseded' then return new; end if;   -- set by the lock below
  -- R40: the admin retires a row (soft delete); status, figures and the lock stay as they were
  if r = 'admin' and old.deleted_at is null and new.deleted_at is not null and new.status = old.status
     and new.fresh_kg is not distinct from old.fresh_kg and new.frozen_kg is not distinct from old.frozen_kg and new.price is not distinct from old.price then
    return new;
  end if;
  if old.status in ('locked','superseded') then
    raise exception 'Komitmen versi % sudah %; buat versi baru dengan alasan', old.version, old.status using errcode = '42501';
  end if;
  if new.status = 'locked' then
    if r not in ('commercial_lead','admin') then raise exception 'Komitmen dikunci oleh Kepala Sales' using errcode = '42501'; end if;
    new.locked_by := public.current_email(); new.locked_at := now();
    select c.id into prev from public.sales_commitment c where c.week_start = new.week_start and c.key = new.key
       and coalesce(c.size_kg, 0) = coalesce(new.size_kg, 0) and c.status = 'locked' and c.deleted_at is null and c.id <> new.id;
    if prev is not null then
      if length(trim(coalesce(new.reason, ''))) < 5 then raise exception 'Versi baru setelah kunci wajib alasan' using errcode = '23514'; end if;
      update public.sales_commitment set status = 'superseded' where id = prev;
    end if;
    return new;
  end if;
  if new.status = 'superseded' then raise exception 'Versi digeser hanya saat versi baru dikunci' using errcode = '42501'; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(new.key))) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  new.locked_by := null; new.locked_at := null;
  return new;
end $$;
revoke execute on function public.tg_commitment_guard() from public, anon, authenticated;

-------------------------------------------------------------------------------- K24 price list guard (R40)
create or replace function public.tg_price_list_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if tg_op = 'UPDATE' and old.locked_at is not null and old.deleted_at is null then
    -- R40: the admin retires a locked row; the price and the lock stay as they were
    if r = 'admin' and new.deleted_at is not null and new.price_fresh is not distinct from old.price_fresh
       and new.price_frozen is not distinct from old.price_frozen and new.locked_at is not distinct from old.locked_at then
      return new;
    end if;
    raise exception 'Price list minggu % untuk % sudah dikunci', old.week_start, old.key using errcode = '42501';
  end if;
  if new.locked_at is not null then
    if r not in ('commercial_lead','admin') then raise exception 'Price list dikunci oleh Kepala Sales' using errcode = '42501'; end if;
    new.locked_by := public.current_email();
  else
    new.locked_by := null;
  end if;
  return new;
end $$;

-------------------------------------------------------------------------------- §4.6 / K43 surplus answers
create or replace function public.tg_surplus_response_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null then return new; end if;
  if r = 'sales' and not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(new.key))) then
    raise exception 'SKU % tidak ditugaskan kepada Anda', new.key using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.responded_by := public.current_email(); new.responded_at := now(); end if;
  return new;
end $$;

-------------------------------------------------------------------------------- K49: K32 in the database
-- A Sales user writes a PO line only for a customer and a key of one of their active assignments (customer null in the
-- assignment = every customer, key null = every SKU). A line without a customer (spot sale) is checked on the key.
create or replace function public.tg_sales_line_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if public.app_role() is distinct from 'sales' then return new; end if;
  k := coalesce(nullif(new.key_manual, ''), (select m.key from public.item_map m where m.item_code = new.item_code and m.deleted_at is null));
  if not exists (select 1 from public.sales_assignment a
      where a.active and lower(a.email) = public.current_email()
        and (a.customer is null or new.customer is null or lower(a.customer) = lower(new.customer))
        and (a.key is null or (k is not null and public.base_key(a.key) = public.base_key(k)))) then
    raise exception 'Baris % % tidak ditugaskan kepada Anda', coalesce(new.customer, '(spot)'), coalesce(k, new.item_code, '') using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_sales_line_scope() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sales_line_scope' and tgrelid = 'public.sales_line'::regclass) then
    create trigger sales_line_scope before insert or update on public.sales_line for each row execute function public.tg_sales_line_scope();
  end if;
end $$;

-------------------------------------------------------------------------------- K43 read scope of Sales
-- the commitments and discount requests a Sales user reads match the guards above (base key on both sides); without
-- this a commitment on "RPA|Karkas" by a Sales user assigned "RPA|Karkas|Fresh" is written but not read back
alter policy sales_commitment_read on public.sales_commitment
  using ((select public.is_app_user())
         and (not (select public.has_role('sales'))
              or exists (select 1 from public.sales_assignment a
                         where a.active and lower(a.email) = public.current_email()
                           and (a.key is null or public.base_key(a.key) = public.base_key(sales_commitment.key)))));
alter policy discount_approval_sales_scope on public.discount_approval
  using (not (select public.has_role('sales'))
         or requested_by = public.current_email()
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email()
                      and (a.key is null or public.base_key(a.key) = public.base_key(discount_approval.key))));

-------------------------------------------------------------------------------- K43 + K53 sales view (same columns)
-- the cost of v5 (cost_per_kg, cost_status, cost_check) is null for Sales when the week of the row has
-- sales_sees_cost = false; the assignment is matched on base_key
create or replace view public.commercial_daily_sales_v5 with (security_barrier = true) as
  select c.date, c.key, c.group_code, c.form, c.free_fresh_kg, c.free_frozen_kg, c.oldest_age_days, c.hours_to_cutoff, c.cost_per_kg_ma,
         c.price_floor, c.price_list, c.margin_per_kg_list, c.realized_price_7d, c.margin_per_kg_realized, c.holding_loss_per_day,
         c.downgrade_risk_rp, c.urgency, c.priority_score, c.rank, c.ordered_today_kg,
         (case when s.sees then c.cost_per_kg end)::numeric(18,4) as cost_per_kg,
         case when s.sees then c.cost_status end as cost_status,
         case when s.sees then c.cost_check end as cost_check
  from public.commercial_daily c
  cross join lateral (
    select not (select public.has_role('sales'))
        or coalesce((select p.sales_sees_cost from public.parameter p join public.week w on w.id = p.week_id
                      where c.date between w.week_start and w.week_start + 6 limit 1), true) as sees
  ) s
  where (select public.is_app_user())
    and (not (select public.has_role('sales'))
         or exists (select 1 from public.sales_assignment a
                    where a.active and lower(a.email) = public.current_email() and (a.key is null or public.base_key(a.key) = public.base_key(c.key))));
revoke all on public.commercial_daily_sales_v5 from public, anon;
grant select on public.commercial_daily_sales_v5 to authenticated;

-------------------------------------------------------------------------------- R9 assignment e-mail stored lower case
-- the app reads the assignments of a viewer with email = lower(viewer) (no ilike: "_" and "%" are wildcards there);
-- the guards above already compare lower(a.email). Rows written by the table editor are normalised on write.
create or replace function public.tg_sales_assignment_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := nullif(lower(trim(new.email)), '');
  return new;
end $$;
revoke execute on function public.tg_sales_assignment_email() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'email_lower' and tgrelid = 'public.sales_assignment'::regclass) then
    create trigger email_lower before insert or update of email on public.sales_assignment for each row execute function public.tg_sales_assignment_email();
  end if;
end $$;
update public.sales_assignment set email = lower(trim(email)) where email is distinct from lower(trim(email));

-------------------------------------------------------------------------------- 3/3 20261024000300_v51_params.sql
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

-------------------------------------------------------------------------------- cek: semua baris harus true
select m.no, m.cek, m.ada
from (values
  (1,  '0100 base_key',                          to_regprocedure('public.base_key(text)') is not null),
  (2,  '0100 release_week K44/K45/K47',          (select prosrc like '%grid kelengkapan belum dibangun%' and prosrc like '%controls_v3%' and prosrc like '%release_week''%'
                                                    from pg_proc where oid = to_regprocedure('public.release_week(uuid, text, text, text, jsonb)'))),
  (3,  '0100 needs_rebuild di 5 tabel v5',        (select count(*) from pg_trigger where tgname = 'needs_rebuild' and tgrelid in ('public.sales_commitment'::regclass,
                                                    'public.price_list_week'::regclass, 'public.size_class_map'::regclass, 'public.plan_week_class'::regclass, 'public.surplus_response'::regclass)) = 5),
  (4,  '0200 commitment guard base_key',         (select prosrc like '%base_key%' from pg_proc where oid = to_regprocedure('public.tg_commitment_guard()'))),
  (5,  '0200 sales_line_scope (K49)',            exists (select 1 from pg_trigger where tgname = 'sales_line_scope' and tgrelid = 'public.sales_line'::regclass)),
  (6,  '0200 view sales v5 + sales_sees_cost',   pg_get_viewdef('public.commercial_daily_sales_v5'::regclass) like '%sales_sees_cost%'),
  (7,  '0200 policy baca Sales base_key',        (select count(*) from pg_policy where polname in ('sales_commitment_read','discount_approval_sales_scope')
                                                    and pg_get_expr(polqual, polrelid) like '%base_key%') = 2),
  (8,  '0200 price_list_week.deleted_at (R40)',  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'price_list_week' and column_name = 'deleted_at')),
  (9,  '0200 email assignment huruf kecil',      not exists (select 1 from public.sales_assignment where email is distinct from lower(trim(email)))),
  (10, '0300 advance_update_date (K39)',         to_regprocedure('public.advance_update_date(uuid, date)') is not null),
  (11, '0300 lock_commitments (K46)',            to_regprocedure('public.lock_commitments(date, jsonb)') is not null),
  (12, '0300 parameter.po_unsized_mode (O15)',   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'parameter' and column_name = 'po_unsized_mode'))
) as m(no, cek, ada)
order by m.no;
