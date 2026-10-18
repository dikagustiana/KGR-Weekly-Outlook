with cols as (
  select 'col' as k, c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, '') as v
  from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
), fns as (
  select 'fn' as k, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '') as v
  from pg_proc p where p.pronamespace = 'public'::regnamespace
), pols as (
  select 'pol' as k, tablename || '.' || policyname || ':' || cmd || ':' || md5(coalesce(qual, '')) || ':' || md5(coalesce(with_check, '')) as v
  from pg_policies where schemaname = 'public'
), trg as (
  select 'trg' as k, tgrelid::regclass::text || '.' || tgname || ':' || tgfoid::regproc::text as v
  from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
), vws as (
  select 'view' as k, viewname || ':' || md5(definition) as v from pg_views where schemaname = 'public'
), idx as (
  select 'idx' as k, tablename || ':' || md5(indexdef) as v from pg_indexes where schemaname = 'public'
), alls as (select * from cols union all select * from fns union all select * from pols union all select * from trg union all select * from vws union all select * from idx)
select k, count(*) as n, md5(string_agg(v, '|' order by v)) as h from alls group by k order by k;
