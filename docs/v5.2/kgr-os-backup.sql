-- KGR-OS logical snapshot inside the database (PRD v5.2-B B-R93 / brief Bab 4 "Backup").
-- Why not pg_dump: from the agent's container the database port and api.supabase.com are blocked (only the Supabase
-- connector's SQL works), and the repository is public, so a dump cannot travel through GitHub Actions artifacts or
-- inputs. This block copies every public base table + auth.users + the DDL catalogue into a new schema
-- bak_<UTC timestamp> that PostgREST does not expose (no grants to anon/authenticated). Restore: docs/v5.2/kgr-os-log.md.
do $$
declare
  s text := 'bak_' || to_char(now() at time zone 'UTC', 'YYYYMMDD"t"HH24MI');
  t record;
  n bigint;
  h text;
begin
  execute format('create schema %I', s);
  execute format('revoke all on schema %I from public, anon, authenticated', s);
  execute format('create table %I._manifest (tbl text primary key, rows bigint, md5 text, taken_at timestamptz default now())', s);
  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('create table %I.%I as table public.%I', s, t.tablename, t.tablename);
    execute format('select count(*), md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from public.%I x', '|', '', t.tablename) into n, h;
    execute format('insert into %I._manifest (tbl, rows, md5) values (%L, %s, %L)', s, 'public.' || t.tablename, n, h);
  end loop;
  execute format('create table %I.auth_users as table auth.users', s);
  execute format('insert into %I._manifest (tbl, rows, md5) select %L, count(*), md5(coalesce(string_agg(id::text || email, %L order by id), %L)) from auth.users', s, 'auth.users', '|', '');
  execute format($q$create table %I._ddl as
    select 'function' kind, p.oid::regprocedure::text name, pg_get_functiondef(p.oid) def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    union all select 'view', c.relname, pg_get_viewdef(c.oid, true)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
    union all select 'policy', tablename || '.' || policyname,
           format('%%s %%s to %%s using (%%s) with check (%%s)', cmd, permissive, roles::text, qual, with_check)
      from pg_policies where schemaname = 'public'
    union all select 'trigger', c.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relnamespace = 'public'::regnamespace and not tg.tgisinternal
    union all select 'index', indexname, indexdef from pg_indexes where schemaname = 'public'
    union all select 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
      from pg_constraint where connamespace = 'public'::regnamespace
    union all select 'column', table_name || '.' || column_name,
           data_type || coalesce(' default ' || column_default, '') || case when is_nullable = 'NO' then ' not null' else '' end
      from information_schema.columns where table_schema = 'public'
    union all select 'grant', table_name || '.' || grantee || '.' || privilege_type, ''
      from information_schema.role_table_grants where table_schema = 'public'$q$, s);
  raise notice 'snapshot %', s;
end $$;
