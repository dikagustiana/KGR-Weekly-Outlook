-- v6 irisan 1 — hitung sekali, baca banyak (docs/PRD-v6.md bagian A: K77–K81, B-R119, B-R120). Additive and re-runnable:
-- one new table, one nullable column, nothing dropped, renamed or replaced. Registers schema version 6.0.0.
--
-- week_snapshot holds the whole WeekResult of computeWeek as JSON (lossless codec, packages/engine/src/result-codec.ts),
-- one row per week per version. Only the rebuild worker and the release write it, with the service client (the pages
-- read it). A new version is written only when the inputs changed (inputs_hash = sha256 of every input row loadWeek
-- read) or the engine changed (engine_version); the same hash leaves the latest row as it is (R122).
--
-- B-R120: release.snapshot_id names the snapshot a release froze (R124). Filled by the release from this version on;
-- the releases written before stay null until the one-off rebuild of every released week (irisan 1 gate) links them.
--
-- B-R121 (PostgREST max-rows 1000 → 5000) is a project setting, not SQL: Dashboard → Settings → API → Max rows. The
-- worker's pagination does not depend on it (it pages by the rows a page actually returned, lib/data.ts fetchAllFast).

-------------------------------------------------------------------------------- week_snapshot
create table if not exists public.week_snapshot (
  id             uuid primary key default gen_random_uuid(),
  week_id        uuid not null references public.week(id) on delete cascade,
  version        integer not null check (version > 0),
  engine_version text not null,
  inputs_hash    text not null,
  result         jsonb not null,
  built_at       timestamptz not null default now(),
  built_by       text not null,
  unique (week_id, version)
);
create index if not exists week_snapshot_week_version on public.week_snapshot (week_id, version desc);

alter table public.week_snapshot enable row level security;
-- read: every active app user (B-R119); Q-v6-4 (Sales and batch costs) is open: the default subset RPC
-- snapshot_for_role (B-R123) is built only if the answer is "Sales may not read batch". No write policy: only the
-- service role (which bypasses RLS) writes.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'week_snapshot' and policyname = 'week_snapshot_read') then
    create policy week_snapshot_read on public.week_snapshot for select to authenticated using ((select public.is_app_user()));
  end if;
end $$;
revoke all on public.week_snapshot from anon;
grant select on public.week_snapshot to authenticated;
grant all on public.week_snapshot to service_role;

-------------------------------------------------------------------------------- release.snapshot_id
alter table public.release add column if not exists snapshot_id uuid references public.week_snapshot(id) on delete restrict;

-------------------------------------------------------------------------------- flags (default off; when opened, Admin first)
-- v6_snapshot_read: pages read week_snapshot (irisan 2); v6_shell: header and components (irisan 4); v6_pages: screens (irisan 5)
insert into public.app_setting (key, value, note) values
  ('v6_snapshot_read', '{"enabled": false, "roles": ["admin"]}', 'PRD v6 irisan 2: halaman membaca week_snapshot'),
  ('v6_shell', '{"enabled": false, "roles": ["admin"]}', 'PRD v6 irisan 4: shell, komponen, aksesibilitas'),
  ('v6_pages', '{"enabled": false, "roles": ["admin"]}', 'PRD v6 irisan 5: isi layar dan kosakata')
on conflict (key) do nothing;

-------------------------------------------------------------------------------- version
insert into public.schema_registry (version) values ('6.0.0') on conflict (version) do nothing;
