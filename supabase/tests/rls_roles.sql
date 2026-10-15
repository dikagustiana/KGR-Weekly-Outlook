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

-- v3 F1 (M1 costing): cost detail is not readable by sales; admin + cost_accounting write it; batch_output_sku upsert key.
do $$
declare out text := ''; wid uuid; bid uuid; pid uuid; n int;
begin
  insert into public.app_user(email, role) values ('t4-sales@x.test','sales'),('t4-mgmt@x.test','management'),
    ('t4-ca@x.test','cost_accounting'),('t4-ppic@x.test','ppic');
  select id into wid from public.week order by week_start desc limit 1;
  select id into bid from public.batch where week_id = wid order by seq limit 1;

  perform set_config('request.jwt.claims', '{"email":"t4-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.cost_pool(period_start, period_end, description) values ('2026-08-01','2026-08-31','rls') returning id into pid; out := out || 'ca insert cost_pool: OK; ';
  exception when others then out := out || 'ca insert cost_pool: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.cost_pool_line(cost_pool_id, component, amount, batch_id) values (pid, 'LB', 1000, bid); out := out || 'ca insert cost_pool_line: OK; ';
  exception when others then out := out || 'ca insert cost_pool_line: DENIED(!) ' || sqlerrm || '; '; end;
  begin
    insert into public.batch_output_sku(batch_id, key, item_code, kg, source) values (bid, 'RPA|Karkas|Fresh', 'X1', 10, 'WP');
    insert into public.batch_output_sku(batch_id, key, item_code, kg, source) values (bid, 'RPA|Karkas|Fresh', 'X1', 12, 'WP')
      on conflict (batch_id, key, item_code) do update set kg = excluded.kg;
    insert into public.batch_output_sku(batch_id, key, item_code, kg, source) values (bid, null, null, 1, 'WP');
    insert into public.batch_output_sku(batch_id, key, item_code, kg, source) values (bid, null, null, 2, 'WP')
      on conflict (batch_id, key, item_code) do update set kg = excluded.kg;
    select count(*) into n from public.batch_output_sku where batch_id = bid and source = 'WP';
    out := out || 'ca upsert batch_output_sku rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'ca upsert batch_output_sku: DENIED(!) ' || sqlerrm || '; '; end;
  update public.batch set costing_status = 'uploaded' where id = bid; get diagnostics n = row_count;
  out := out || 'ca update batch costing rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.allocation_run(batch_id, total_cost, total_allocated) values (bid, 1000, 1000); out := out || 'ca insert allocation_run: OK; ';
  exception when others then out := out || 'ca insert allocation_run: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t4-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.cost_pool; out := out || 'sales read cost_pool=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.allocation_run; out := out || 'sales read allocation_run=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.batch_output_sku; out := out || 'sales read batch_output_sku=' || n || case when n > 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t4-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.cost_pool where description = 'rls'; out := out || 'mgmt read cost_pool=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t4-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.cost_pool(period_start, period_end) values ('2026-08-01','2026-08-31'); out := out || 'ppic insert cost_pool: ALLOWED(!); ';
  exception when others then out := out || 'ppic insert cost_pool: denied; '; end;
  begin insert into public.overhead_rate(period_start, period_end, rate_per_kg_lb) values ('2026-11-01','2026-11-30', 1500); out := out || 'ppic insert overhead_rate: ALLOWED(!); ';
  exception when others then out := out || 'ppic insert overhead_rate: denied; '; end;
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F1 (rolled back): %', out;
end $$;

-- v3 F2 (M2 ledger): lot detail not for sales; manual adjustments by inventory accounting queue a rebuild; blasts by PPIC.
do $$
declare out text := ''; n int;
begin
  insert into public.app_user(email, role) values ('t5-sales@x.test','sales'),('t5-ia@x.test','inventory_accounting'),('t5-ppic@x.test','ppic'),('t5-mgmt@x.test','management');
  insert into public.lot (lot_ref, key, form, origin, origin_date, ledger_date, kg_in, cost_in, cost_per_kg_si) values ('opening:t5', 'RPA|Karkas|Fresh', 'fresh', 'opening', '2026-08-24', '2026-08-24', 10, 100, 10);
  insert into public.sku_balance_daily (date, key, kg) values ('2026-08-24', 'RPA|Karkas|Fresh', 10);
  insert into public.lot_balance_daily (date, lot_ref, key, form, kg) values ('2026-08-24', 'opening:t5', 'RPA|Karkas|Fresh', 'fresh', 10);
  delete from public.rebuild_queue where date = '2026-08-25';

  perform set_config('request.jwt.claims', '{"email":"t5-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.lot; out := out || 'sales read lot=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.lot_balance_daily; out := out || 'sales read lot_balance_daily=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.sku_balance_daily; out := out || 'sales read sku_balance_daily=' || n || case when n > 0 then '' else '(!)' end || '; ';
  begin insert into public.blast_event(date, lot_ref_from, kg) values ('2026-08-25', 'opening:t5', 1); out := out || 'sales insert blast: ALLOWED(!); ';
  exception when others then out := out || 'sales insert blast: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t5-ia@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.lot_movement(movement_ref, lot_ref, date, type, kg, ref_table, key) values ('manual:t5', 'opening:t5', '2026-08-25', 'adjust', -1, 'manual', 'RPA|Karkas|Fresh'); out := out || 'ia manual adjust: OK; ';
  exception when others then out := out || 'ia manual adjust: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.lot_movement(movement_ref, lot_ref, date, type, kg, ref_table) values ('x:t5', 'opening:t5', '2026-08-25', 'out_sale', -1, 'sales_line'); out := out || 'ia derived movement: ALLOWED(!); ';
  exception when others then out := out || 'ia derived movement: denied; '; end;
  begin insert into public.stock_card_snapshot(date, item_code, kg) values ('2026-08-23', 'JLB0790', 1); out := out || 'ia stock card: OK; ';
  exception when others then out := out || 'ia stock card: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select count(*) into n from public.rebuild_queue where date = '2026-08-25' and status = 'queued';
  out := out || 'manual adjust queued rebuild=' || n || case when n = 1 then '' else '(!)' end || '; ';

  perform set_config('request.jwt.claims', '{"email":"t5-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.blast_event(date, lot_ref_from, kg, reason) values ('2026-08-25', 'opening:t5', 1, 'cutoff'); out := out || 'ppic insert blast: OK; ';
  exception when others then out := out || 'ppic insert blast: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t5-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.lot; out := out || 'mgmt read lot=' || n || case when n > 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F2 (rolled back): %', out;
end $$;

-- v3 F3a (M3 planning): PO lines by sales, forecasts by sales/commercial_lead, plans and yields by PPIC, LB supply by
-- purchasing, approval by finance only, demand mart written only through mart_replace.
do $$
declare out text := ''; n int; wid uuid; pid uuid;
begin
  insert into public.app_user(email, role) values ('t6-sales@x.test','sales'),('t6-cl@x.test','commercial_lead'),('t6-ppic@x.test','ppic'),
    ('t6-purch@x.test','purchasing'),('t6-fin@x.test','finance'),('t6-mgmt@x.test','management');
  select id into wid from public.week where status <> 'closed' order by week_start desc limit 1;
  insert into public.plan_week (week_start, version, head_count, frozen_planned_rp_downgrade, needs_approval) values ('2030-01-07', 1, 100, 30000000, true) returning id into pid;

  perform set_config('request.jwt.claims', '{"email":"t6-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line(week_id, date, status, item_code, kg, price, delivery_date, demand_status, sales_rep, po_ref, line_key)
    values (wid, (select week_start from public.week where id = wid), 'Order', 'T6', 10, 1000, (select week_start from public.week where id = wid), 'Tentative', 'rep', 'PO-T6', 'PO-T6|T6|1');
    out := out || 'sales insert PO line: OK; ';
  exception when others then out := out || 'sales insert PO line: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line(week_id, status, kg, demand_status) values (wid, 'Order', 1, 'Maybe'); out := out || 'bad demand_status: ALLOWED(!); ';
  exception when others then out := out || 'bad demand_status: denied; '; end;
  begin insert into public.forecast_line(week_start, key, kg) values ('2030-01-07', 'RPA|BLD|Fresh', 100); out := out || 'sales insert forecast: OK; ';
  exception when others then out := out || 'sales insert forecast: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.plan_week(week_start, version, head_count) values ('2030-01-07', 9, 1); out := out || 'sales insert plan: ALLOWED(!); ';
  exception when others then out := out || 'sales insert plan: denied; '; end;
  begin insert into public.demand_weekly(week_start, key) values ('2030-01-07', 'x'); out := out || 'sales insert demand_weekly: ALLOWED(!); ';
  exception when others then out := out || 'sales insert demand_weekly: denied; '; end;
  select count(*) into n from public.yield_matrix; out := out || 'sales read yield_matrix=' || n || case when n > 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t6-cl@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.forecast_line(week_start, key, kg) values ('2030-01-07', 'RPA|BLP|Fresh', 50); out := out || 'cl insert forecast: OK; ';
  exception when others then out := out || 'cl insert forecast: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t6-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.yield_matrix(weight_class, cut_pattern, key, yield_pct) values ('STD', 'karkas', 'T6', 0.5); out := out || 'ppic insert yield: OK; ';
  exception when others then out := out || 'ppic insert yield: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.capacity(date, cut_capacity_head) values ('2030-01-07', 1500); out := out || 'ppic insert capacity: OK; ';
  exception when others then out := out || 'ppic insert capacity: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.plan_day(plan_week_id, date, head_count) values (pid, '2030-01-07', 100); out := out || 'ppic insert plan_day: OK; ';
  exception when others then out := out || 'ppic insert plan_day: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.plan_week set approved_by = 't6-ppic@x.test', approved_at = now() where id = pid; out := out || 'ppic approve plan: ALLOWED(!); ';
  exception when others then out := out || 'ppic approve plan: denied; '; end;
  begin insert into public.forecast_line(week_start, key, kg) values ('2030-01-07', 'x', 1); out := out || 'ppic insert forecast: ALLOWED(!); ';
  exception when others then out := out || 'ppic insert forecast: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t6-purch@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.lb_supply(date, supplier, weight_class, head_count, status) values ('2030-01-07', 'ISA', 'STD', 1000, 'confirmed'); out := out || 'purch insert lb_supply: OK; ';
  exception when others then out := out || 'purch insert lb_supply: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.yield_matrix(weight_class, cut_pattern, key, yield_pct) values ('STD', 'karkas', 'T6b', 0.5); out := out || 'purch insert yield: ALLOWED(!); ';
  exception when others then out := out || 'purch insert yield: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t6-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  update public.plan_week set approved_by = 't6-fin@x.test', approved_at = now() where id = pid; get diagnostics n = row_count;
  out := out || 'finance approve plan rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin update public.plan_week set head_count = 5 where id = pid; out := out || 'finance edit plan: ALLOWED(!); ';
  exception when others then out := out || 'finance edit plan: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t6-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.plan_week where id = pid; out := out || 'mgmt read plan=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin perform public.mart_replace('demand_weekly', '2030-01-07', '[]'::jsonb); out := out || 'mgmt mart_replace: ALLOWED(!); ';
  exception when others then out := out || 'mgmt mart_replace: denied; '; end;
  execute 'reset role';
  select count(*) into n from public.rebuild_queue where date = '2030-01-07' and status = 'queued';
  out := out || 'forecast queued rebuild=' || n || case when n = 1 then '' else '(!)' end || '; ';

  raise exception 'RLS-RESULTS v3 F3a (rolled back): %', out;
end $$;

-- v3 F3b (M3 allocation): PPIC / commercial_lead may allocate; management may not; an allocation queues a ledger rebuild.
do $$
declare out text := ''; n int; wid uuid; sid uuid;
begin
  insert into public.app_user(email, role) values ('t7-ppic@x.test','ppic'),('t7-cl@x.test','commercial_lead'),('t7-mgmt@x.test','management'),('t7-fin@x.test','finance');
  select id into wid from public.week where status <> 'closed' order by week_start desc limit 1;
  insert into public.sales_line(week_id, date, status, kg, delivery_date, demand_status) values (wid, '2030-02-04', 'Order', 10, '2030-02-04', 'Confirmed') returning id into sid;
  delete from public.rebuild_queue where date = '2030-02-04';

  perform set_config('request.jwt.claims', '{"email":"t7-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation(date, sales_line_id, lot_ref, kg) values ('2030-02-04', sid, 'receipt:x', 4); out := out || 'ppic allocate: OK; ';
  exception when others then out := out || 'ppic allocate: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.allocation(date, sales_line_id, lot_ref, kg) values ('2030-02-04', sid, 'receipt:y', 0); out := out || 'zero kg allocation: ALLOWED(!); ';
  exception when others then out := out || 'zero kg allocation: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t7-cl@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  update public.allocation set kg = 5 where sales_line_id = sid; get diagnostics n = row_count;
  out := out || 'cl update allocation rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t7-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation(date, sales_line_id, lot_ref, kg) values ('2030-02-04', sid, 'receipt:z', 1); out := out || 'mgmt allocate: ALLOWED(!); ';
  exception when others then out := out || 'mgmt allocate: denied; '; end;
  select count(*) into n from public.allocation where sales_line_id = sid; out := out || 'mgmt read allocation=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t7-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation(date, sales_line_id, lot_ref, kg) values ('2030-02-04', sid, 'receipt:f', 1); out := out || 'finance allocate: ALLOWED(!); ';
  exception when others then out := out || 'finance allocate: denied; '; end;
  execute 'reset role';
  select count(*) into n from public.rebuild_queue where date = '2030-02-04' and status = 'queued';
  out := out || 'allocation queued rebuild=' || n || case when n = 1 then '' else '(!)' end || '; ';

  raise exception 'RLS-RESULTS v3 F3b (rolled back): %', out;
end $$;

-- v3 F4a (M5 drivers): Finance keeps the fixed-cost schedule and the drivers of accounts (driver columns only);
-- sales does not read the schedule; management reads it.
do $$
declare out text := ''; n int; acc text;
begin
  insert into public.app_user(email, role) values ('t8-fin@x.test','finance'),('t8-sales@x.test','sales'),('t8-mgmt@x.test','management'),('t8-ppic@x.test','ppic');
  select account into acc from public.coa_map where type = 'LabaRugi' order by account limit 1;
  insert into public.fixed_cost_schedule (code, pl_line, description, start_date) values ('T8', 'Rent Expenses', 'rls', '2026-09-01');

  perform set_config('request.jwt.claims', '{"email":"t8-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.fixed_cost_schedule (pl_line, description, amount_per_month, start_date) values ('Salaries and allowance', 'Gaji', 85000000, '2026-10-01'); out := out || 'finance insert schedule: OK; ';
  exception when others then out := out || 'finance insert schedule: DENIED(!) ' || sqlerrm || '; '; end;
  update public.coa_map set driver_type = 'fixed', rp_per_kg = 10 where account = acc; get diagnostics n = row_count;
  out := out || 'finance set driver rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin update public.coa_map set name = 'x' where account = acc; out := out || 'finance rename account: ALLOWED(!); ';
  exception when others then out := out || 'finance rename account: denied; '; end;
  begin update public.coa_map set driver_type = 'bogus' where account = acc; out := out || 'bad driver_type: ALLOWED(!); ';
  exception when others then out := out || 'bad driver_type: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t8-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.fixed_cost_schedule; out := out || 'sales read schedule=' || n || case when n = 0 then '' else '(!)' end || '; ';
  update public.coa_map set driver_type = 'none' where account = acc; get diagnostics n = row_count;
  out := out || 'sales set driver rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t8-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.fixed_cost_schedule where code = 'T8'; out := out || 'mgmt read schedule=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t8-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.fixed_cost_schedule (pl_line, description, start_date) values ('Rent Expenses', 'x', '2026-10-01'); out := out || 'ppic insert schedule: ALLOWED(!); ';
  exception when others then out := out || 'ppic insert schedule: denied; '; end;
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F4a (rolled back): %', out;
end $$;

-- v3 F4b (M4 monthly): Finance keeps outlook, versions (immutable) and closing adjustments; every role reads the
-- outlook; the data mart pl_daily is written only through mart_replace.
do $$
declare out text := ''; n int; mid uuid; vid uuid;
begin
  insert into public.app_user(email, role) values ('t9-fin@x.test','finance'),('t9-sales@x.test','sales'),('t9-mgmt@x.test','management');
  insert into public.month_outlook (month) values ('2030-03-01') returning id into mid;

  perform set_config('request.jwt.claims', '{"email":"t9-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.month_outlook_version (month_outlook_id, version, snapshot, snapshot_sha256, revenue) values (mid, 'V1', '{}'::jsonb, 'x', 100) returning id into vid; out := out || 'finance lock V1: OK; ';
  exception when others then out := out || 'finance lock V1: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.month_outlook_version set revenue = 1 where id = vid; out := out || 'edit locked version: ALLOWED(!); ';
  exception when others then out := out || 'edit locked version: denied; '; end;
  begin insert into public.closing_adjustment (month_outlook_id, code, description, pl_line, amount) values (mid, 'DI-T', 'rls', 'COGS - Live Bird', -1); out := out || 'finance adjustment: OK; ';
  exception when others then out := out || 'finance adjustment: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.outlook_accuracy (month_outlook_id, version, metric, scope, value) values (mid, 'V1', 'MAPE', 'revenue', 0.1); out := out || 'finance accuracy: OK; ';
  exception when others then out := out || 'finance accuracy: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.pl_daily (date, pl_line, basis, actual) values ('2030-03-01', 'Revenue - Trading', 'journal', 1); out := out || 'finance direct pl_daily: ALLOWED(!); ';
  exception when others then out := out || 'finance direct pl_daily: denied; '; end;
  select (public.mart_replace('pl_daily', '2030-03-02', '[{"date":"2030-03-02","pl_line":"Revenue - Trading","basis":"journal","actual":5}]'::jsonb) ->> 'written')::int into n;
  out := out || 'finance mart_replace pl_daily written=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t9-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.month_outlook_version where month_outlook_id = mid; out := out || 'sales read versions=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.closing_adjustment (month_outlook_id, code, description, pl_line, amount) values (mid, 'X', 'x', 'x', 1); out := out || 'sales adjustment: ALLOWED(!); ';
  exception when others then out := out || 'sales adjustment: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t9-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.pl_daily where date = '2030-03-02'; out := out || 'mgmt read pl_daily=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin update public.month_outlook set budget_revenue = 1 where id = mid; get diagnostics n = row_count; out := out || 'mgmt set budget rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'mgmt set budget: denied; '; end;
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F4b (rolled back): %', out;
end $$;

-- v3 F5 (M6 cash): Finance uploads balances and plans; management reads; sales / ppic see no cash; marts via mart_replace.
do $$
declare out text := ''; n int;
begin
  insert into public.app_user(email, role) values ('t10-fin@x.test','finance'),('t10-mgmt@x.test','management'),('t10-sales@x.test','sales'),('t10-ppic@x.test','ppic');

  perform set_config('request.jwt.claims', '{"email":"t10-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.bank_account (account_no, bank) values ('T10-BCA', 'BCA'); insert into public.cash_daily (date, account_no, closing) values ('2030-04-01', 'T10-BCA', 100); out := out || 'finance cash_daily: OK; ';
  exception when others then out := out || 'finance cash_daily: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.cash_daily (date, account_no, closing) values ('2030-04-01', 'T10-BCA', 5); out := out || 'duplicate date × account: ALLOWED(!); ';
  exception when others then out := out || 'duplicate date × account: denied; '; end;
  begin insert into public.cash_daily_plan (date, account_no, amount, line_key) values ('2030-04-02', 'T10-BCA', -50, 't10'); out := out || 'finance plan: OK; ';
  exception when others then out := out || 'finance plan: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.cash_position_daily (date, total_closing) values ('2030-04-01', 1); out := out || 'finance direct mart: ALLOWED(!); ';
  exception when others then out := out || 'finance direct mart: denied; '; end;
  select (public.mart_replace('cash_position_daily', '2030-04-01', '[{"date":"2030-04-01","total_closing":100}]'::jsonb) ->> 'written')::int into n;
  out := out || 'finance mart_replace cash_position written=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t10-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.cash_daily where account_no = 'T10-BCA'; out := out || 'mgmt read cash=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.cash_daily (date, account_no, closing) values ('2030-04-03', 'T10-BCA', 1); out := out || 'mgmt write cash: ALLOWED(!); ';
  exception when others then out := out || 'mgmt write cash: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t10-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.cash_daily; out := out || 'sales read cash=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.cash_position_daily; out := out || 'sales read cash position=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t10-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.solvency_monthly; out := out || 'ppic read solvency=' || n || '; ';
  execute 'reset role';
  select count(*) into n from public.rebuild_queue where date = '2030-04-01' and status = 'queued';
  out := out || 'cash upload queued rebuild=' || n || case when n = 1 then '' else '(!)' end || '; ';

  raise exception 'RLS-RESULTS v3 F5 (rolled back): %', out;
end $$;

-- v3 F6a (M7 commercial): sales read the commercial view without the SI cost; commercial_lead keeps assignments /
-- targets / rules; the mart is written only through mart_replace.
do $$
declare out text := ''; n int;
begin
  insert into public.app_user(email, role) values ('t11-sales@x.test','sales'),('t11-cl@x.test','commercial_lead'),('t11-mgmt@x.test','management');
  insert into public.commercial_daily (date, key, cost_per_kg_ma, cost_per_kg_si, rank) values ('2030-05-01', 'RPA|Karkas|Fresh', 30000, 29000, 1);

  perform set_config('request.jwt.claims', '{"email":"t11-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily; out := out || 'sales read commercial_daily=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.commercial_daily_sales where date = '2030-05-01'; out := out || 'sales read view=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin perform cost_per_kg_si from public.commercial_daily_sales limit 1; out := out || 'sales SI column in view: PRESENT(!); ';
  exception when others then out := out || 'sales SI column in view: absent; '; end;
  begin insert into public.sales_assignment (sales_rep, email) values ('t11', 't11-sales@x.test'); out := out || 'sales insert assignment: ALLOWED(!); ';
  exception when others then out := out || 'sales insert assignment: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t11-cl@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_assignment (sales_rep, email, key) values ('t11', 't11-sales@x.test', 'RPA|Karkas|Fresh'); out := out || 'cl insert assignment: OK; ';
  exception when others then out := out || 'cl insert assignment: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_target (week_start, sales_rep, target_kg) values ('2030-04-29', 't11', 1000); out := out || 'cl insert target: OK; ';
  exception when others then out := out || 'cl insert target: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.price_floor_rule (group_code, markup_rp_per_kg) values ('KARKAS', 500); out := out || 'cl insert floor rule: OK; ';
  exception when others then out := out || 'cl insert floor rule: DENIED(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.commercial_daily where date = '2030-05-01'; out := out || 'cl read commercial_daily=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.commercial_daily (date, key) values ('2030-05-02', 'x'); out := out || 'cl direct mart: ALLOWED(!); ';
  exception when others then out := out || 'cl direct mart: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t11-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.urgency_rule (form, age_from, status) values ('fresh', 9, 'aman'); out := out || 'mgmt insert urgency rule: ALLOWED(!); ';
  exception when others then out := out || 'mgmt insert urgency rule: denied; '; end;
  select count(*) into n from public.urgency_rule; out := out || 'mgmt read urgency rules=' || n || case when n = 5 then '' else '(!)' end || '; ';
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F6a (rolled back): %', out;
end $$;

-- v3 F6b (M7 approval): sales file pending requests; commercial_lead decides up to the limit (Rp 500/kg), finance above;
-- a decision is final; scorecard mart via mart_replace.
do $$
declare out text := ''; n int; small uuid; big uuid;
begin
  insert into public.app_user(email, role) values ('t12-sales@x.test','sales'),('t12-cl@x.test','commercial_lead'),('t12-fin@x.test','finance');

  perform set_config('request.jwt.claims', '{"email":"t12-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.discount_approval (key, requested_price, floor_price, rp_per_kg_below, kg, total_below) values ('K', 30000, 30300, 300, 100, 30000) returning id into small;
    insert into public.discount_approval (key, requested_price, floor_price, rp_per_kg_below, kg, total_below) values ('K', 29000, 30300, 1300, 100, 130000) returning id into big;
    out := out || 'sales file requests: OK; ';
  exception when others then out := out || 'sales file requests: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.discount_approval (key, requested_price, floor_price, rp_per_kg_below, kg, total_below, status) values ('K', 1, 2, 1, 1, 1, 'approved'); out := out || 'sales insert approved: ALLOWED(!); ';
  exception when others then out := out || 'sales insert approved: denied; '; end;
  begin update public.discount_approval set status = 'approved' where id = small; out := out || 'sales approve: ALLOWED(!); ';
  exception when others then out := out || 'sales approve: denied; '; end;
  select count(*) into n from public.discount_approval where id in (small, big) and requested_by = 't12-sales@x.test'; out := out || 'requested_by stamped=' || n || case when n = 2 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t12-cl@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.discount_approval set status = 'approved', decided_by = 't12-cl@x.test', decided_at = now() where id = small; out := out || 'cl approve 300/kg: OK; ';
  exception when others then out := out || 'cl approve 300/kg: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.discount_approval set status = 'approved', decided_by = 't12-cl@x.test', decided_at = now() where id = big; out := out || 'cl approve 1300/kg: ALLOWED(!); ';
  exception when others then out := out || 'cl approve 1300/kg: denied; '; end;
  begin update public.discount_approval set status = 'rejected' where id = small; out := out || 'change final decision: ALLOWED(!); ';
  exception when others then out := out || 'change final decision: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t12-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.discount_approval set status = 'approved', decided_by = 't12-fin@x.test', decided_at = now() where id = big; out := out || 'finance approve 1300/kg: OK; ';
  exception when others then out := out || 'finance approve 1300/kg: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.discount_approval set requested_price = 1 where id = big; out := out || 'edit request after decision: ALLOWED(!); ';
  exception when others then out := out || 'edit request after decision: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t12-cl@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_scorecard_weekly (week_start, sales_rep) values ('2030-05-06', 'x'); out := out || 'cl direct scorecard: ALLOWED(!); ';
  exception when others then out := out || 'cl direct scorecard: denied; '; end;
  select (public.mart_replace('sales_scorecard_weekly', '2030-05-06', '[{"week_start":"2030-05-06","sales_rep":"Budi","actual_kg":10}]'::jsonb) ->> 'written')::int into n;
  out := out || 'cl mart_replace scorecard written=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F6b (rolled back): %', out;
end $$;
