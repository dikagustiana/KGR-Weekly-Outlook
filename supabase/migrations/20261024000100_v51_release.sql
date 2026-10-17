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
