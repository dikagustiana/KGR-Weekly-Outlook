-- PRD §10 role test at the database level. Impersonates test users through JWT claims and ALWAYS rolls back:
-- the results are returned in the final error message. Run in the Supabase SQL editor (as postgres), or
-- scripts/test-rls.sh (CI): an outcome marked (!) is a failure.
-- Expected (2026-10-14): sales insert order OK; sales insert batch denied; sales update parameter rows=0;
-- sales update sell price rows=1; sales buy price denied; mgmt read rows>0; mgmt insert denied; ppic batch OK;
-- ppic receipt RPA OK; ppic receipt trading denied; purch lb price rows=1; purch shrink denied;
-- finance cash plan on closed week denied; direct audit insert denied; stranger weeks=0, gl=0; anon sales=0;
-- audit rows by sales=1; self sign-up denied.
do $$
declare out text := ''; wid uuid; n int;
begin
  insert into public.app_user(email, role) values ('t-sales@x.test','sales'),('t-mgmt@x.test','management'),('t-ppic@x.test','ppic'),('t-purch@x.test','purchasing'),('t-fin@x.test','finance');
  select id into wid from public.week order by week_start desc limit 1;

  perform set_config('request.jwt.claims', '{"email":"t-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line(week_id, date, status, item_code, kg, price) values (wid, current_date, 'Order', 'TRD0024', 1, 1); out := out || 'sales insert order: OK; ';
  exception when others then out := out || 'sales insert order: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.batch(week_id, date, status, lb_kg) values (wid, current_date, 'Rencana', 100); out := out || 'sales insert batch: ALLOWED(!); ';
  exception when others then out := out || 'sales insert batch: denied; '; end;
  update public.parameter set lb_price_today = 1 where week_id = wid; get diagnostics n = row_count; out := out || 'sales update parameter rows=' || n || '; ';
  begin update public.sku_price set replacement_buy_price = 1 where week_id = wid; out := out || 'sales buy price: ALLOWED(!); ';
  exception when others then out := out || 'sales buy price: denied; '; end;
  execute 'reset role';
  select count(*) into n from public.audit_log where actor = 't-sales@x.test'; out := out || 'audit rows by sales=' || n || '; ';

  perform set_config('request.jwt.claims', '{"email":"t-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.sales_line where week_id = wid; out := out || 'mgmt read sales rows=' || n || '; ';
  begin insert into public.sales_line(week_id, date, status, item_code, kg, price) values (wid, current_date, 'Order', 'TRD0024', 1, 1); out := out || 'mgmt insert: ALLOWED(!); ';
  exception when others then out := out || 'mgmt insert: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.receipt_line(week_id, date, status, receipt_source, item_code, kg, unit_cost) values (wid, current_date, 'Rencana', 'Beli Trading', 'TRD0010', 1, 1); out := out || 'ppic receipt trading: ALLOWED(!); ';
  exception when others then out := out || 'ppic receipt trading: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t-purch@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.parameter set target_shrink = 0.05 where week_id = wid; out := out || 'purch update shrink: ALLOWED(!); ';
  exception when others then out := out || 'purch update shrink: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"stranger@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.week; out := out || 'stranger read weeks=' || n || '; ';
  execute 'reset role';

  -- self sign-up of an allow-listed e-mail (what the Auth API would insert) must be refused
  begin
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 't-fin@x.test', '{"provider":"email","providers":["email"]}');
    out := out || 'self sign-up: ALLOWED(!); ';
  exception when others then out := out || 'self sign-up: denied; '; end;

  raise exception 'RLS-RESULTS (rolled back): %', out;
end $$;

-- v3 (docs/PLAN-v3.md): new roles and every new table. Same convention: results in the final error, (!) = unexpected.
-- F0: app_setting, rebuild_queue, data_fix, mart_table, module_enabled, mart_replace, commercial_lead, cost_accounting.
do $$
declare out text := ''; wid uuid; n int; b boolean;
begin
  insert into public.app_user(email, role) values ('t3-admin@x.test','admin'),('t3-sales@x.test','sales'),('t3-mgmt@x.test','management'),
    ('t3-cl@x.test','commercial_lead'),('t3-ca@x.test','cost_accounting'),('t3-fin@x.test','finance');
  select id into wid from public.week order by week_start desc limit 1;
  insert into public.sku_price(week_id, key) select wid, k.key from public.sku_key k limit 1 on conflict do nothing;

  -- admin: flags
  perform set_config('request.jwt.claims', '{"email":"t3-admin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  update public.app_setting set value = '{"enabled": true, "roles": ["admin"]}' where key = 'm1_costing'; get diagnostics n = row_count;
  out := out || 'admin set flag rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  b := public.module_enabled('m1_costing'); out := out || 'admin m1 on=' || b || case when b then '' else '(!)' end || '; ';
  execute 'reset role';

  -- sales: flag restricted to admin → off; may queue a rebuild; may not log data fixes; may not change flags
  perform set_config('request.jwt.claims', '{"email":"t3-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  b := public.module_enabled('m1_costing'); out := out || 'sales m1 on=' || b || case when b then '(!)' else '' end || '; ';
  update public.app_setting set value = '{"enabled": true}' where key = 'm2_ledger'; get diagnostics n = row_count;
  out := out || 'sales set flag rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  begin insert into public.rebuild_queue(date, reason) values (current_date, 'rls test'); out := out || 'sales queue rebuild: OK; ';
  exception when others then out := out || 'sales queue rebuild: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.data_fix(fix_id, description) values ('D9', 'rls test'); out := out || 'sales data_fix: ALLOWED(!); ';
  exception when others then out := out || 'sales data_fix: denied; '; end;
  execute 'reset role';

  -- management: reads flags, cannot queue, cannot write a mart
  perform set_config('request.jwt.claims', '{"email":"t3-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.app_setting; out := out || 'mgmt read flags=' || n || case when n >= 8 then '' else '(!)' end || '; ';
  begin insert into public.rebuild_queue(date, reason) values (current_date, 'rls test'); out := out || 'mgmt queue rebuild: ALLOWED(!); ';
  exception when others then out := out || 'mgmt queue rebuild: denied; '; end;
  begin perform public.mart_replace('mart_table', 'x', '[]'::jsonb); out := out || 'mgmt mart_replace: ALLOWED(!); ';
  exception when others then out := out || 'mgmt mart_replace: denied; '; end;
  execute 'reset role';

  -- commercial_lead = sales rights: order, sell price; not buy price, not batch
  perform set_config('request.jwt.claims', '{"email":"t3-cl@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line(week_id, date, status, item_code, kg, price) values (wid, current_date, 'Order', 'TRD0024', 1, 1); out := out || 'cl insert order: OK; ';
  exception when others then out := out || 'cl insert order: DENIED(!) ' || sqlerrm || '; '; end;
  update public.sku_price set ref_sell_price = coalesce(ref_sell_price, 0) + 1 where week_id = wid; get diagnostics n = row_count;
  out := out || 'cl sell price rows=' || n || case when n > 0 then '' else '(!)' end || '; ';
  begin update public.sku_price set replacement_buy_price = 1 where week_id = wid; out := out || 'cl buy price: ALLOWED(!); ';
  exception when others then out := out || 'cl buy price: denied; '; end;
  begin insert into public.batch(week_id, date, status, lb_kg) values (wid, current_date, 'Rencana', 100); out := out || 'cl insert batch: ALLOWED(!); ';
  exception when others then out := out || 'cl insert batch: denied; '; end;
  execute 'reset role';

  -- cost_accounting: no sales, no flags; may upload
  perform set_config('request.jwt.claims', '{"email":"t3-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line(week_id, date, status, item_code, kg, price) values (wid, current_date, 'Order', 'TRD0024', 1, 1); out := out || 'ca insert order: ALLOWED(!); ';
  exception when others then out := out || 'ca insert order: denied; '; end;
  begin insert into public.upload(week_id, kind, file_name, file_sha256, uploaded_by) values (wid, 'costing_wp', 'x.xlsx', 'x', 't3-ca@x.test'); out := out || 'ca upload: OK; ';
  exception when others then out := out || 'ca upload: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- finance: may log a data fix
  perform set_config('request.jwt.claims', '{"email":"t3-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.data_fix(fix_id, description, scope) values ('D9', 'rls test', 'rls'); out := out || 'fin data_fix: OK; ';
  exception when others then out := out || 'fin data_fix: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 (rolled back): %', out;
end $$;
