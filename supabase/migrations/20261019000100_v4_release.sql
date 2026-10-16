-- v4 irisan 4 — finance close (docs/PRD-v4.md §3.5, §3.6, §3.9, §7.2, G3, G8). Additive and re-runnable.
--
-- §7.2: a weekly release and a monthly version are written only inside release_week / release_month (SECURITY
-- DEFINER, search_path fixed). The functions check, in the release transaction, what the database can see for itself:
-- the caller's role, the SHA-256 of the snapshot text, pending rebuilds of the period (STALE), the version order and the
-- V1 lock date (K9), the register of assumptions (P10), batches without output (C48), and the controls carried in the
-- snapshot. A mandatory control that is GAGAL / BELUM DIISI / STALE rejects the release, with the reason per control,
-- unless a release_override row exists for it — written only by a role that release_override_policy allows for that
-- control (no generic admin override). Direct inserts into release / month_outlook_version are no longer allowed.
-- Flag v4_release (default off): off = the weekly rule stays as in v1 (only GAGAL rejects, no override); on = the §7.2
-- rule. A v4 monthly snapshot (rule_version) always takes the §7.2 rule.
--
-- M1 (§3.5): batches from 1 Nov 2026 default to the own-RPA cost mode; overhead per head as well as per kg LB;
-- C48: an Aktual batch without SKU output cannot have its costing posted; DI-01: the ledger keeps the COGS of a DO at
-- MA on the revenue date next to the MA on the invoice date.

-------------------------------------------------------------------------------- flag
insert into public.app_setting (key, value, note)
values ('v4_release', '{"enabled": false}', 'PRD v4 §7.2: rilis menolak kontrol wajib GAGAL / BELUM DIISI / STALE kecuali ada override per kontrol')
on conflict (key) do nothing;

-------------------------------------------------------------------------------- overrides
create table if not exists public.release_override_policy (
  code          text primary key check (code ~ '^C[0-9]{1,2}$'),
  allowed_roles text[] not null default '{}',
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

insert into public.release_override_policy (code, allowed_roles, note)
select 'C' || n, array['finance'], 'kontrol v1: Finance dengan alasan dan bukti' from generate_series(1, 20) n
on conflict (code) do nothing;
insert into public.release_override_policy (code, allowed_roles, note) values
  ('C21', array['cost_accounting','finance'], 'costing M1'), ('C22', array['cost_accounting','finance'], 'costing M1'),
  ('C23', array['cost_accounting','finance'], 'costing M1'), ('C24', array['cost_accounting','finance'], 'costing M1'),
  ('C33', array['finance'], 'driver biaya'), ('C34', array['finance'], 'biaya tetap melebihi jadwal'), ('C43', array['finance'], 'biaya tetap belum diperbarui'),
  ('C35', array['finance'], 'kas'), ('C36', array['finance'], 'kas'), ('C37', array['finance'], 'kas'),
  ('C49', array['finance'], 'P&L harian vs jurnal'),
  ('C32', '{}', 'bridge V1 → V2 harus menutup; tidak ada override'),
  ('C45', '{}', 'STALE: bangun ulang mart; tidak ada override'),
  ('C48', '{}', 'batch tanpa output: lengkapi output; tidak ada override')
on conflict (code) do nothing;

create table if not exists public.release_override (
  id           uuid primary key default gen_random_uuid(),
  scope_kind   text not null check (scope_kind in ('week','month')),
  scope        text not null,                                   -- week_start, or month first day + ':' + version
  code         text not null references public.release_override_policy(code),
  reason       text not null check (length(trim(reason)) >= 10),
  evidence     text not null check (length(trim(evidence)) >= 3),  -- voucher, file, link
  created_role text,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create unique index if not exists release_override_scope_code on public.release_override (scope_kind, scope, code) where deleted_at is null;

create or replace function public.tg_release_override_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_role := public.app_role();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['release_override_policy','release_override'] loop
    if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = format('public.%I', t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'override_role' and tgrelid = 'public.release_override'::regclass) then
    create trigger override_role before insert on public.release_override for each row execute function public.tg_release_override_role();
  end if;
  if not exists (select 1 from pg_policies where tablename = 'release_override_policy' and policyname = 'release_override_policy_read') then
    create policy release_override_policy_read on public.release_override_policy for select to authenticated using ((select public.is_app_user()));
    -- the policy itself is Admin's to maintain (who may override what), not a way to override
    create policy release_override_policy_upd on public.release_override_policy for update to authenticated
      using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'release_override' and policyname = 'release_override_read') then
    create policy release_override_read on public.release_override for select to authenticated using ((select public.is_app_user()));
    create policy release_override_ins on public.release_override for insert to authenticated
      with check (exists (select 1 from public.release_override_policy p where p.code = release_override.code and public.app_role() = any (p.allowed_roles)));
    -- withdrawing an override (soft delete) is for the role that may give it
    create policy release_override_upd on public.release_override for update to authenticated
      using (exists (select 1 from public.release_override_policy p where p.code = release_override.code and public.app_role() = any (p.allowed_roles)))
      with check (exists (select 1 from public.release_override_policy p where p.code = release_override.code and public.app_role() = any (p.allowed_roles)));
  end if;
end $$;

-------------------------------------------------------------------------------- helpers
-- Pending rebuilds of a date range: the marts a release reads would be older than their inputs (STALE).
create or replace function public.release_stale_dates(p_from date, p_to date) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(distinct q.date::text, ', ' order by q.date::text) from public.rebuild_queue q
   where q.status in ('queued','running') and q.date between p_from and p_to;
$$;
revoke all on function public.release_stale_dates(date, date) from public, anon;

-- C48: Aktual batches in a date range without any SKU output row.
create or replace function public.c48_batches(p_from date, p_to date) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(coalesce(b.batch_ref, b.id::text), ', ' order by b.date, b.batch_ref) from public.batch b
   where b.status = 'Aktual' and b.deleted_at is null and b.date between p_from and p_to
     and not exists (select 1 from public.batch_output_sku o where o.batch_id = b.id and o.deleted_at is null and o.kg > 0);
$$;
revoke all on function public.c48_batches(date, date) from public, anon;

-- The n-th Thursday of a month (K9 v1_lock_week).
create or replace function public.nth_thursday(p_month date, p_n integer) returns date
language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_month)::date + ((4 - extract(isodow from date_trunc('month', p_month))::int + 7) % 7) + 7 * (greatest(p_n, 1) - 1))::date;
$$;

-- Controls of a snapshot that reject: mandatory codes whose status is GAGAL / BELUM DIISI / STALE and that have no
-- override for the scope; when p_strict is false the v1 rule: only GAGAL, and no overrides (as before v4).
-- Returns the reasons, one per control, or null.
create or replace function public.release_rejections(p_controls jsonb, p_mandatory text[], p_scope_kind text, p_scope text, p_strict boolean) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(c.code || ' ' || c.status, '; ' order by c.code)
    from (select coalesce(e ->> 'code', 'C' || (e ->> 'no')) as code, e ->> 'status' as status from jsonb_array_elements(coalesce(p_controls, '[]'::jsonb)) e) c
   where (p_mandatory is null or c.code = any (p_mandatory))
     and (c.status = 'GAGAL' or (p_strict and c.status in ('BELUM DIISI','STALE')))
     and not (p_strict and exists (select 1 from public.release_override o where o.scope_kind = p_scope_kind and o.scope = p_scope and o.code = c.code and o.deleted_at is null));
$$;
revoke all on function public.release_rejections(jsonb, text[], text, text, boolean) from public, anon;

-------------------------------------------------------------------------------- week guard
-- week_end is a generated column: in a BEFORE trigger NEW.week_end is still null, so the guard of 20261014000200 read it
-- as changed and refused every non-admin week update, including Finance setting status 'released' (the v1 release
-- ignored that error, so a week released by Finance stayed 'open'). Same rule, generated column skipped.
create or replace function public.tg_week_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role(); o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); k text;
begin
  if r = 'admin' or r is null then return new; end if;
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at','updated_by','week_end') or (o -> k) is not distinct from (n -> k) then continue; end if;
    if k = 'update_date' then continue; end if;
    if k = 'status' and r = 'finance' and old.status in ('open','released') and new.status in ('open','released') then continue; end if;
    raise exception 'Peran % tidak boleh mengubah minggu (%).', r, k using errcode = '42501';
  end loop;
  return new;
end $$;

-------------------------------------------------------------------------------- release_week
create or replace function public.release_week(p_week_id uuid, p_json text, p_sha text, p_pdf_path text, p_ops jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.week%rowtype; snap jsonb; is_strict boolean; bad text; stale text; rid uuid; email text := public.current_email();
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
  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
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

-------------------------------------------------------------------------------- release_month
-- p_version V1 / V2 / FINAL. Totals and the snapshot come from the server's engine run; the function checks the order
-- of versions, the dates, the register, C48, STALE and the snapshot's controls before inserting.
create or replace function public.release_month(p_month date, p_version text, p_json text, p_sha text, p_cut_off date,
  p_totals jsonb, p_rule_version text, p_anomaly_days jsonb, p_po_share numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', p_month)::date; last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  today date := (now() at time zone 'Asia/Jakarta')::date;
  mo public.month_outlook%rowtype; snap jsonb; bad text; stale text; c48 text; open_reg text; lock_week int; vid uuid;
  is_strict boolean; v4 boolean; email text := public.current_email(); mand text[];
begin
  if not (select public.has_role('admin','finance')) then
    raise exception 'Versi bulanan dikunci oleh Admin atau Finance' using errcode = '42501';
  end if;
  if p_version not in ('V1','V2','FINAL') then raise exception 'Versi tidak dikenal: %', p_version; end if;
  if encode(sha256(convert_to(p_json, 'UTF8')), 'hex') <> p_sha then
    raise exception 'Snapshot berubah: SHA-256 tidak cocok' using errcode = '22000';
  end if;
  snap := p_json::jsonb;
  v4 := snap ? 'rule_version';
  is_strict := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v4_release'), false);
  select * into mo from public.month_outlook where month = m;
  if not found then
    insert into public.month_outlook (month, status) values (m, 'open') returning * into mo;
  end if;
  if exists (select 1 from public.month_outlook_version where month_outlook_id = mo.id and version = p_version) then
    raise exception '% sudah dikunci', p_version using errcode = '23505';
  end if;
  if p_version = 'V2' and not exists (select 1 from public.month_outlook_version where month_outlook_id = mo.id and version = 'V1') then
    raise exception 'Kunci V1 dulu' using errcode = 'P0001';
  end if;
  if p_version = 'FINAL' and today <= last then
    raise exception 'FINAL dikunci setelah akhir bulan (%)', last using errcode = 'P0001';
  end if;
  bad := null;
  if v4 and p_version = 'V1' then
    -- K9: V1 from the lock Thursday of the month (parameter v1_lock_week of the month's last week, default 3)
    select coalesce(p.v1_lock_week, 3) into lock_week from public.parameter p join public.week w on w.id = p.week_id
     where w.week_start <= last order by w.week_start desc limit 1;
    if today < public.nth_thursday(m, coalesce(lock_week, 3)) then
      bad := concat_ws('; ', bad, format('K9: V1 dikunci mulai %s', public.nth_thursday(m, coalesce(lock_week, 3))));
    end if;
    -- P10: every live engine assumption agreed, with owner and date
    select string_agg(r.code, ', ' order by r.code) into open_reg from public.assumption_register r
     where r.month_outlook_id = mo.id and r.deleted_at is null and r.status <> 'superseded' and r.version is null
       and (r.status <> 'agreed' or r.owner is null or r.agreed_at is null);
    if open_reg is not null then bad := concat_ws('; ', bad, 'P10 register belum disepakati: ' || open_reg); end if;
  end if;
  -- C48: an Aktual batch of the month without SKU output (no override)
  c48 := public.c48_batches(m, least(coalesce(p_cut_off, last), last));
  if c48 is not null and (v4 or p_version = 'FINAL') then bad := concat_ws('; ', bad, 'C48 GAGAL: batch tanpa output ' || c48); end if;
  -- STALE: the month's mart must be built after its last input
  stale := public.release_stale_dates(m, last);
  if stale is not null and (v4 or is_strict) then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  -- the snapshot's controls: mandatory per version (§7.1)
  mand := case p_version when 'V1' then array['C33','C34','C49'] when 'V2' then array['C32'] else array['C21','C22','C23','C24','C35','C36','C37','C48','C49'] end;
  bad := concat_ws('; ', bad, public.release_rejections(snap -> 'controls', mand, 'month', m::text || ':' || p_version, v4 or is_strict));
  if bad is not null and bad <> '' then
    raise exception 'Versi % ditolak: %', p_version, bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.month_outlook_version (month_outlook_id, version, cut_off_date, locked_by, snapshot, snapshot_sha256, revenue, cogs, gp, opex, nibt,
    rule_version, anomaly_days, po_share, approved_by)
  values (mo.id, p_version, p_cut_off, email, snap, p_sha, (p_totals ->> 'revenue')::numeric, (p_totals ->> 'cogs')::numeric, (p_totals ->> 'gp')::numeric,
    (p_totals ->> 'opex')::numeric, (p_totals ->> 'nibt')::numeric, p_rule_version, p_anomaly_days, p_po_share, email)
  returning id into vid;
  update public.month_outlook set status = case p_version when 'V1' then 'v1_locked' when 'V2' then 'v2' else 'final' end where id = mo.id;
  return vid;
end $$;
revoke all on function public.release_month(date, text, text, text, date, jsonb, text, jsonb, numeric) from public, anon;
grant execute on function public.release_month(date, text, text, text, date, jsonb, text, jsonb, numeric) to authenticated;

-- direct writes of a release or a version are gone: only the functions above insert them. The policies keep their
-- names with a check that never passes, so earlier migrations re-run without recreating the old ones.
drop policy if exists release_ins on public.release;
create policy release_ins on public.release for insert to authenticated with check (false);
drop policy if exists month_outlook_version_ins on public.month_outlook_version;
create policy month_outlook_version_ins on public.month_outlook_version for insert to authenticated with check (false);

-------------------------------------------------------------------------------- M1 own-RPA mode (§3.5) and C48 on posting
alter table public.overhead_rate add column if not exists rate_per_head numeric(18,4);

-- from 1 Nov 2026 the RPA is KGR's own: a new batch from that date takes the own cost mode unless set otherwise later
create or replace function public.tg_batch_cost_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.date >= date '2026-11-01' and new.cost_mode = 'maklon' then new.cost_mode := 'own'; end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'batch_cost_mode' and tgrelid = 'public.batch'::regclass) then
    create trigger batch_cost_mode before insert on public.batch for each row execute function public.tg_batch_cost_mode();
  end if;
end $$;

create or replace function public.tg_allocation_run_c48() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted')
     and not exists (select 1 from public.batch_output_sku o where o.batch_id = new.batch_id and o.deleted_at is null and o.kg > 0) then
    raise exception 'C48: batch tanpa output SKU tidak bisa diposting' using errcode = '23514';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'allocation_run_c48' and tgrelid = 'public.allocation_run'::regclass) then
    create trigger allocation_run_c48 before insert or update on public.allocation_run for each row execute function public.tg_allocation_run_c48();
  end if;
end $$;

-------------------------------------------------------------------------------- §3.5 DI-01 cost date vs invoice date
-- out_sale of an Accurate invoice line that replaced an Ops DO line: cost_ma = MA on the movement (invoice) date,
-- cost_ma_revenue = MA on the DO (revenue, K11) date. Both written by the ledger builder (mart, service role).
alter table public.lot_movement add column if not exists revenue_date date;
alter table public.lot_movement add column if not exists cost_ma_revenue numeric(18,2);
create index if not exists lot_movement_revenue_date on public.lot_movement (revenue_date) where revenue_date is not null;
