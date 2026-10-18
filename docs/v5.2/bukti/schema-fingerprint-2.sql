with con as (
  select 'con' as k, conrelid::regclass::text || '.' || conname || ':' || regexp_replace(pg_get_constraintdef(oid), '\s+', ' ', 'g') as v
  from pg_constraint where connamespace = 'public'::regnamespace
), acl as (
  select 'relacl' as k, c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), '') as v
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','S')
), facl as (
  select 'proacl' as k, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as v
  from pg_proc p where p.pronamespace = 'public'::regnamespace
), typ as (
  select 'type' as k, t.typname || ':' || t.typtype::text || ':' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '') as v
  from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e','d','c') and not exists (select 1 from pg_class c where c.reltype = t.oid)
), colacl as (
  select 'colacl' as k, c.relname || '.' || a.attname || ':' || (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x) as v
  from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null
), alls as (select * from con union all select * from acl union all select * from facl union all select * from typ union all select * from colacl)
select k, count(*) as n, md5(string_agg(v, '|' order by v)) as h from alls group by k order by k;
