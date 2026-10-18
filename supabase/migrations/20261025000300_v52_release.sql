-- v5.2 B2/3 — release gates computed by the database (docs/PRD-v5.2-B-db.md B-R84, K68; A-REL-5, A-REL-6, B-REL-3;
-- O22(b), O28(b), O32(b)). Additive and re-runnable.
--
-- release_week (same signature; everything of 20261024000100 kept unless amended here):
--   * v5_costing on (global flag): the snapshot must carry controls_v3 with C53, else "snapshot tidak lengkap". C53 is
--     computed from the tables (Aktual batch of the week, no WP, past its deadline: cut date + wp_due_hours rounded to
--     days, at wp_due_time WIB, as apps/web/lib/v5/costing.ts wpDueAt and packages/engine c53). The DB result, or the
--     snapshot's C53 BELUM DIISI, holds the release in every mode (O22b) unless Finance recorded override C53.
--     v5_costing off: C53 of the snapshot as in v5.1 (strict mode only).
--   * v5_input on: a week without any grid row is refused (K45, as v5.1); every date ws … min(ws+6, today WIB − 1)
--     needs at least one cell (O28b) — "grid belum dibangun untuk <tanggal>"; missing days and red cells are lifted by
--     Finance's override K35.
--   * the DB's C53 is compared with the snapshot's; a difference (and what an override K35 lifted) is written to
--     release.note (new column).
-- release_month (same signature): V1 with C55 not LULUS in the snapshot is refused in every mode unless Finance
--   recorded override C55 for the month's V1 (O32b; policy row C55 added here, migrations only by O38).
-- Registers schema version 5.2.2.

-------------------------------------------------------------------------------- release.note
alter table public.release add column if not exists note text;
comment on column public.release.note is 'PRD v5.2 K68: difference between the controls computed by release_week and the client snapshot (null = none)';

-------------------------------------------------------------------------------- override policy C55 (O32b)
insert into public.release_override_policy (code, allowed_roles, note)
values ('C55', array['finance'], 'PRD v5.2 O32(b): V1 dengan beban tetap bulan ini masih estimasi (C55 PERIKSA); Finance dengan alasan dan bukti')
on conflict (code) do nothing;

-------------------------------------------------------------------------------- helpers
-- C53 from the tables: Aktual batches of the week without WP whose deadline has passed at p_at (null = none)
create or replace function public.c53_late_batches(p_week_id uuid, p_at timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(coalesce(b.batch_ref, b.id::text) || ' tenggat ' || to_char(d.due at time zone 'Asia/Jakarta', 'DD/MM HH24.MI'), ', '
                    order by b.date, b.batch_ref, b.id)
    from public.batch b
    join public.week w on w.id = b.week_id
    left join public.parameter p on p.week_id = b.week_id
   cross join lateral (
     select ((b.date + greatest(1, round(coalesce(p.wp_due_hours, 24)::numeric / 24))::int)
             + date_trunc('minute', coalesce(p.wp_due_time, time '12:00')::interval)) at time zone 'Asia/Jakarta' as due
   ) d
   where b.week_id = p_week_id and b.status = 'Aktual' and b.deleted_at is null and b.superseded_at is null
     and b.date between w.week_start and w.week_start + 6
     and b.wp_received_at is null and d.due < p_at
$$;
revoke all on function public.c53_late_batches(uuid, timestamptz) from public, anon, authenticated;

-- O28: dates ws … min(ws+6, today WIB − 1) without any grid cell (the release task is not a cell, K44); null = none
create or replace function public.k35_grid_gaps(p_week_start date) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(to_char(g.d, 'DD/MM'), ', ' order by g.d)
    from generate_series(p_week_start::timestamp,
                         least(p_week_start + 6, (now() at time zone 'Asia/Jakarta')::date - 1)::timestamp,
                         interval '1 day') g(d)
   where not exists (select 1 from public.input_completeness_daily c where c.date = g.d::date and c.kind <> 'release_week')
$$;
revoke all on function public.k35_grid_gaps(date) from public, anon, authenticated;

-------------------------------------------------------------------------------- release_week (v4 §7.2 + K35, K44, K45, K47 + K68, O22, O28)
create or replace function public.release_week(p_week_id uuid, p_json text, p_sha text, p_pdf_path text, p_ops jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.week%rowtype; snap jsonb; is_strict boolean; costing_on boolean; input_on boolean;
  bad text; stale text; red text; gaps text; late text; snap_c53 text; db_c53 text; diff text; c53_lifted boolean; k35_lifted boolean;
  rid uuid; email text := public.current_email();
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
  costing_on := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_costing'), false);
  input_on := coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_input'), false);
  bad := public.release_rejections(snap -> 'controls' -> 'controls', null, 'week', w.week_start::text, is_strict);

  -- C53
  if costing_on then
    -- K68: the snapshot is the evidence of the release; with v5_costing on it carries C53 (lib/v3/week.ts)
    if jsonb_typeof(snap -> 'controls_v3') is distinct from 'array'
       or not exists (select 1 from jsonb_array_elements(snap -> 'controls_v3') e where e ->> 'code' = 'C53') then
      raise exception 'Rilis ditolak: snapshot tidak lengkap — v5_costing hidup, tetapi snapshot tanpa controls_v3 C53'
        using errcode = '22000', hint = 'Buat snapshot ulang dari aplikasi dengan modul costing hidup.';
    end if;
    select string_agg(distinct coalesce(e ->> 'status', '-'), ',') into snap_c53
      from jsonb_array_elements(snap -> 'controls_v3') e where e ->> 'code' = 'C53';
    late := public.c53_late_batches(w.id, now());
    db_c53 := case when late is null then 'LULUS' else 'BELUM DIISI' end;
    c53_lifted := exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                            and o.code = 'C53' and o.deleted_at is null);
    -- O22(b): held in every mode while v5_costing is on, by the database's C53 or the snapshot's
    if not c53_lifted then
      if late is not null then
        bad := concat_ws('; ', bad, 'C53 BELUM DIISI: WP belum masuk lewat tenggat ' || late);
      elsif snap_c53 ~ '(BELUM DIISI|GAGAL|STALE)' then
        bad := concat_ws('; ', bad, 'C53 ' || snap_c53 || ' (snapshot)');
      end if;
    end if;
    if snap_c53 is distinct from db_c53 then
      diff := 'K68 C53: DB ' || db_c53 || coalesce(' (' || late || ')', '') || ' ≠ snapshot ' || snap_c53
              || case when c53_lifted then '; dilepas override C53' else '' end;
    end if;
  else
    -- v5.1 K47: C53 of the snapshot's controls_v3, strict mode as release_rejections
    bad := nullif(concat_ws('; ', bad, public.release_rejections(snap -> 'controls_v3', array['C53'], 'week', w.week_start::text, is_strict)), '');
  end if;

  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  end if;

  -- K35 (flag v5_input), without the release task itself (K44): no grid → no release (K45); a day up to yesterday without
  -- a cell (O28) and red cells (late, or not due when built and past the deadline now) → no release unless override K35
  if input_on then
    if not exists (select 1 from public.input_completeness_daily c where c.date between w.week_start and (w.week_start + 6) and c.kind <> 'release_week') then
      bad := concat_ws('; ', bad, 'K35: grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas');
    else
      k35_lifted := exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                              and o.code = 'K35' and o.deleted_at is null);
      gaps := public.k35_grid_gaps(w.week_start);
      select string_agg(c.kind || ' ' || to_char(c.date, 'DD/MM'), ', ' order by c.date, c.kind) into red
        from public.input_completeness_daily c
       where c.date between w.week_start and (w.week_start + 6)
         and c.kind <> 'release_week'
         and (c.status = 'late' or (c.status = 'not_due' and c.due_at is not null and c.due_at <= now()));
      if not k35_lifted then
        if gaps is not null then bad := concat_ws('; ', bad, 'K35: grid belum dibangun untuk ' || gaps); end if;
        if red is not null then bad := concat_ws('; ', bad, 'K35 kelengkapan data merah: ' || red); end if;
      elsif gaps is not null or red is not null then
        diff := concat_ws('; ', diff, 'K35 dilepas override: ' || concat_ws(' | ', 'grid belum dibangun ' || gaps, 'merah ' || red));
      end if;
    end if;
  end if;

  if coalesce(bad, '') <> '' then
    raise exception 'Rilis ditolak: %', bad using errcode = 'P0001', hint = 'Perbaiki kontrol, atau minta override per kontrol dengan alasan dan bukti.';
  end if;
  insert into public.release (week_id, update_date, engine_version, snapshot, snapshot_sha256, pdf_path, control_status, controls, ops_rows, released_by, note)
  values (w.id, w.update_date, coalesce(snap ->> 'engineVersion', ''), snap, p_sha, p_pdf_path, coalesce(snap -> 'controls' ->> 'overall', ''), snap -> 'controls',
          coalesce(p_ops, '[]'::jsonb), email, diff)
  returning id into rid;
  update public.week set status = 'released' where id = w.id and status = 'open';
  return rid;
end $$;
revoke all on function public.release_week(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.release_week(uuid, text, text, text, jsonb) to authenticated;

-------------------------------------------------------------------------------- release_month (20261019000100 + O32b C55)
create or replace function public.release_month(p_month date, p_version text, p_json text, p_sha text, p_cut_off date,
  p_totals jsonb, p_rule_version text, p_anomaly_days jsonb, p_po_share numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m date := date_trunc('month', p_month)::date; last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  today date := (now() at time zone 'Asia/Jakarta')::date;
  mo public.month_outlook%rowtype; snap jsonb; bad text; stale text; c48 text; c55 text; open_reg text; lock_week int; vid uuid;
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
  bad := nullif(concat_ws('; ', bad, public.release_rejections(snap -> 'controls', mand, 'month', m::text || ':' || p_version, v4 or is_strict)), '');
  -- O32(b): C55 not LULUS (fixed costs of the month still estimated) holds V1 in every mode, lifted by Finance's override C55
  if p_version = 'V1' then
    select string_agg(distinct coalesce(e ->> 'status', '-'), ',') into c55
      from jsonb_array_elements(case when jsonb_typeof(snap -> 'controls') = 'array' then snap -> 'controls' else '[]'::jsonb end) e
     where coalesce(e ->> 'code', 'C' || (e ->> 'no')) = 'C55' and coalesce(e ->> 'status', '-') <> 'LULUS';
    if c55 is not null and not exists (select 1 from public.release_override o where o.scope_kind = 'month' and o.scope = m::text || ':V1'
                                         and o.code = 'C55' and o.deleted_at is null) then
      bad := concat_ws('; ', bad, 'C55 ' || c55 || ': beban tetap bulan ini masih estimasi; isi jadwal beban tetap, atau override Finance C55');
    end if;
  end if;
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

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('5.2.2') on conflict (version) do nothing;
