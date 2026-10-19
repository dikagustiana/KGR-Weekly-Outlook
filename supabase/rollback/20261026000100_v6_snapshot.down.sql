-- Rollback of 20261026000100_v6_snapshot.sql (PRD v6 irisan 1). Run by a person, on a copy first; never from the app.
-- The column release.snapshot_id stays (PRD v4 §11 forbids dropping columns); its foreign key goes with the table.
begin;
alter table public.release drop constraint if exists release_snapshot_id_fkey;
drop table if exists public.week_snapshot;
delete from public.app_setting where key in ('v6_snapshot_read', 'v6_shell', 'v6_pages');
delete from public.schema_registry where version = '6.0.0';
commit;
