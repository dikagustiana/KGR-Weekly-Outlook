-- v5.2 B2/1 — schema version in the database (docs/PRD-v5.2-B-db.md B-R82, K65). Additive and re-runnable.
--
-- public.schema_registry keeps one row per applied schema version (the bundle that brought it, who applied it, the
-- sha256 of the bundle); public.schema_version() returns the highest version. Read by every app user (PRD A R44
-- tahap 2 compares it with EXPECTED_SCHEMA); written only by the database owner / service role, i.e. by a migration or
-- a bundle (no write policy and no write privilege for authenticated, Admin included).
-- The v5.1 bundle is recorded as 5.1.0 only when its last object (lock_commitments) exists. Every later file of
-- v5.2 B2 registers its own version at its end (v52_security 5.2.1, v52_release 5.2.2).

-------------------------------------------------------------------------------- registry
create table if not exists public.schema_registry (
  version       text primary key,
  applied_at    timestamptz not null default now(),
  applied_by    text default current_user,
  bundle_sha256 text
);
comment on table public.schema_registry is 'PRD v5.2 K65: applied schema versions; written only by migrations / bundles (service role), read by app users.';

alter table public.schema_registry enable row level security;
revoke all on public.schema_registry from public, anon;
revoke insert, update, delete, truncate on public.schema_registry from authenticated;
grant select on public.schema_registry to authenticated;
grant select, insert, update, delete on public.schema_registry to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'schema_registry' and policyname = 'schema_registry_read') then
    create policy schema_registry_read on public.schema_registry for select to authenticated using ((select public.is_app_user()));
  end if;
end $$;

-------------------------------------------------------------------------------- schema_version()
-- Highest version by the dotted number before any "-" suffix (5.10.0 > 5.9.3); a row whose version is not dotted
-- numbers sorts last; ties (e.g. 5.2.0 and 5.2.0-x) → the latest applied_at.
create or replace function public.schema_version() returns text
language sql stable security definer set search_path = '' as $$
  select r.version
    from public.schema_registry r
   order by case when split_part(r.version, '-', 1) ~ '^[0-9]{1,9}(\.[0-9]{1,9})*$'
                 then string_to_array(split_part(r.version, '-', 1), '.')::int[] end desc nulls last,
            r.applied_at desc, r.version desc
   limit 1
$$;
revoke all on function public.schema_version() from public, anon;
grant execute on function public.schema_version() to authenticated;

-------------------------------------------------------------------------------- versions
insert into public.schema_registry (version)
select '5.1.0' where to_regprocedure('public.lock_commitments(date,jsonb)') is not null
on conflict (version) do nothing;
insert into public.schema_registry (version) values ('5.2.0') on conflict (version) do nothing;
