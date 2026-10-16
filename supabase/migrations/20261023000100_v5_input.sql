-- v5/5 — Input, validated uploads, completeness grid (docs/PRD-v5.md §4.9, §6.4, K34, K35). Additive and re-runnable.
--
-- K35: a red cell of the completeness grid (input × date, mart input_completeness_daily) in the week being released
-- rejects release_week unless Finance recorded a K35 override for that week (reason and evidence, release_override).
-- The rule applies only while flag v5_input is on; off = release_week exactly as v4 (20261019000100).
-- The only `drop` is `drop constraint if exists` followed by the wider check of release_override_policy.code (the
-- v3/v4 pattern): K35 is not a control number. Nothing here is read by the v1 engine.

-------------------------------------------------------------------------------- completeness grid: due time of a cell
-- a cell built before its deadline says not_due; after the deadline it is red (read by the screen and release_week)
alter table public.input_completeness_daily add column if not exists due_at timestamptz;

-------------------------------------------------------------------------------- task registry: PO of Sales (mockup Input, Sales)
-- the PO lines of a ship date are due the day before the cut at 12.00, when PPIC buys LB per class (C50)
insert into public.input_task_rule (kind, title, owner_role, due_rule, impact_text, marts) values
  ('po_lines', 'PO kirim lusa dengan ukuran karkas', 'sales', 'cut_date - 1 day 12:00', 'Ukuran karkas menentukan kelas LB yang dibeli PPIC; tanpa ukuran dihitung STD (C50)', '["sales_line","demand_class_weekly"]')
on conflict (kind) do nothing;

-------------------------------------------------------------------------------- K35 override
do $$
begin
  alter table public.release_override_policy drop constraint if exists release_override_policy_code_check;
  alter table public.release_override_policy add constraint release_override_policy_code_check check (code ~ '^(C[0-9]{1,2}|K35)$');
end $$;
insert into public.release_override_policy (code, allowed_roles, note) values
  ('K35', array['finance'], 'PRD v5 K35: sel merah grid kelengkapan minggu itu; Finance dengan alasan dan bukti'),
  ('C53', array['finance'], 'PRD v5 C53: batch lewat tenggat WP tanpa WP; GP RPA dirilis dengan override Finance')
on conflict (code) do nothing;

-------------------------------------------------------------------------------- reminders (§6.4, journey P)
-- Finance reminds the owner of a red cell; the owner's Input screen shows it. Append-only: no update, no delete.
create table if not exists public.input_reminder (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  kind        text not null references public.input_task_rule(kind) on update cascade,
  owner_role  text not null,
  note        text,
  sent_by     text,
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists input_reminder_owner on public.input_reminder (owner_role, sent_at desc);
create index if not exists input_reminder_date on public.input_reminder (date, kind);

create or replace function public.tg_input_reminder_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.app_role() is null then return new; end if;
  new.sent_by := public.current_email(); new.sent_at := now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stamp' and tgrelid = 'public.input_reminder'::regclass) then
    create trigger stamp before insert or update on public.input_reminder for each row execute function public.tg_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit' and tgrelid = 'public.input_reminder'::regclass) then
    create trigger audit after insert or update or delete on public.input_reminder for each row execute function public.tg_audit();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'reminder_stamp' and tgrelid = 'public.input_reminder'::regclass) then
    create trigger reminder_stamp before insert on public.input_reminder for each row execute function public.tg_input_reminder_stamp();
  end if;
  alter table public.input_reminder enable row level security;
  if not exists (select 1 from pg_policies where tablename = 'input_reminder' and policyname = 'input_reminder_read') then
    create policy input_reminder_read on public.input_reminder for select to authenticated using ((select public.is_app_user()));
    create policy input_reminder_ins on public.input_reminder for insert to authenticated with check ((select public.has_role('admin','finance')));
  end if;
end $$;

-------------------------------------------------------------------------------- release_week (v4 §7.2 + K35)
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
  if is_strict then
    stale := public.release_stale_dates(w.week_start, (w.week_start + 6));
    if stale is not null then bad := concat_ws('; ', bad, 'STALE: mart belum dibangun ulang untuk ' || stale); end if;
  end if;
  -- K35 (flag v5_input): red cells of the week (late, or not due when built and past the deadline now)
  if coalesce((select (value ->> 'enabled')::boolean from public.app_setting where key = 'v5_input'), false) then
    select string_agg(c.kind || ' ' || to_char(c.date, 'DD/MM'), ', ' order by c.date, c.kind) into red
      from public.input_completeness_daily c
     where c.date between w.week_start and (w.week_start + 6)
       and (c.status = 'late' or (c.status = 'not_due' and c.due_at is not null and c.due_at <= now()));
    if red is not null and not exists (select 1 from public.release_override o where o.scope_kind = 'week' and o.scope = w.week_start::text
                                          and o.code = 'K35' and o.deleted_at is null) then
      bad := concat_ws('; ', bad, 'K35 kelengkapan data merah: ' || red);
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
