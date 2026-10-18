-- PRD v5.2-A R70: the e2e users and the API role of PostgREST. SETUP only (run by up.sh as postgres, never a user flow).
-- psql variables: :pw (the fixed TEST password), :domain (e-mail domain, default e2e.test).
-- Nine role users (one per role of the weekly loop) plus admin, who is used ONLY for the initial rebuild of the marts.
-- Logins are provisioned with public.set_login_password (bcrypt, rows in the shim's auth.users and auth.identities),
-- the same function the first Admin uses on Supabase.

-- PostgREST connects as `authenticator` and switches to anon / authenticated / service_role, as on Supabase
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

insert into public.app_user (email, full_name, role) values
  ('finance@'  || :'domain', 'E2E Finance',              'finance'),
  ('lead@'     || :'domain', 'E2E Kepala Sales',         'commercial_lead'),
  ('sales@'    || :'domain', 'E2E Sales',                'sales'),
  ('ppic@'     || :'domain', 'E2E PPIC',                 'ppic'),
  ('opsdir@'   || :'domain', 'E2E Direktur Operasional', 'operations_director'),
  ('costacc@'  || :'domain', 'E2E Cost Accounting',      'cost_accounting'),
  ('invacc@'   || :'domain', 'E2E Inventory Accounting', 'inventory_accounting'),
  ('purchasing@' || :'domain', 'E2E Purchasing',         'purchasing'),
  ('mgmt@'     || :'domain', 'E2E Manajemen',            'management'),
  ('admin@'    || :'domain', 'E2E Admin (bangun ulang awal saja)', 'admin')
on conflict (email) do update set role = excluded.role, full_name = excluded.full_name, active = true;

-- Sales has one active assignment: the RPA karkas SKU (without a form suffix: covers fresh and frozen, the commitment is per base
-- key; with PRD v5.2 O21(b) an assignment ending in |Fresh covers only that form) of one customer
insert into public.sales_assignment (sales_rep, email, customer, key, active)
values ('SALES-E2E', 'sales@' || :'domain', 'PT A', 'RPA|Karkas', true)
on conflict (sales_rep, customer, key) do update set email = excluded.email, active = true;

select public.set_login_password(email, :'pw') from public.app_user where email like '%@' || :'domain' order by email;
