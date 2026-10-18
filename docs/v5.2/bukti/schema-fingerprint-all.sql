-- Sidik skema gabungan (9 kategori: col, con, fn, idx, pol, proacl, relacl, trg, view) untuk membandingkan KGR-OS dengan
-- PG16 lokal yang memuat migrasi yang sama. Jalankan di kedua DB; hasil per kategori harus identik (n dan h).
-- Nilai KGR-OS 5.2.6 (18 Okt 2026): col 1417 13586931…, con 331 f2166f96…, fn 68 1a5059f1…, idx 205 a4db6ff1…,
-- pol 305 78fa5b92…, proacl 68 7a21911a…, relacl 97 92dce79b…, trg 229 c708c465…, view 3 3ca62957….
with x as (
  select 'col' as k, c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, '') as v
    from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  union all select 'fn', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select 'pol', tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || md5(coalesce(qual, '')) || ':' || md5(coalesce(with_check, ''))
    from pg_policies where schemaname = 'public'
  union all select 'trg', tgrelid::regclass::text || '.' || tgname || ':' || tgfoid::regproc::text || ':' || tgenabled::text
    from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all select 'view', viewname || ':' || md5(regexp_replace(definition, '\s+', ' ', 'g')) from pg_views where schemaname = 'public'
  union all select 'idx', indexname || ':' || md5(indexdef) from pg_indexes where schemaname = 'public'
  union all select 'con', conrelid::regclass::text || '.' || conname || ':' || regexp_replace(pg_get_constraintdef(oid), '\s+', ' ', 'g')
    from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'relacl', c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce((select string_agg(regexp_replace(a::text, 'm/', '/'), ',' order by a::text) from unnest(c.relacl) a), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'S')
  union all select 'proacl', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
)
select k, count(*) as n, md5(string_agg(v, '|' order by v)) as h from x group by k order by k;
