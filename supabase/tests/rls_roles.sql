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
  -- PRD v4 §7.2: a version is written only by public.release_month
  begin select public.release_month('2030-03-01', 'V1', '{}', encode(sha256(convert_to('{}', 'UTF8')), 'hex'), null, '{"revenue":"100"}'::jsonb, null, null, null) into vid; out := out || 'finance lock V1: OK; ';
  exception when others then out := out || 'finance lock V1: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.month_outlook_version set revenue = 1 where id = vid; out := out || 'edit locked version: ALLOWED(!); ';
  exception when others then out := out || 'edit locked version: denied; '; end;
  begin insert into public.closing_adjustment (month_outlook_id, code, description, pl_line, amount) values (mid, 'DI-T', 'rls', 'COGS - Live Bird', -1); out := out || 'finance adjustment: OK; ';
  exception when others then out := out || 'finance adjustment: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.outlook_accuracy (month_outlook_id, version, metric, scope, value) values (mid, 'V1', 'MAPE', 'revenue', 0.1); out := out || 'finance accuracy: OK; ';
  exception when others then out := out || 'finance accuracy: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.pl_daily (date, pl_line, basis, actual) values ('2030-03-01', 'Revenue - Trading', 'journal', 1); out := out || 'finance direct pl_daily: ALLOWED(!); ';
  exception when others then out := out || 'finance direct pl_daily: denied; '; end;
  begin perform public.mart_replace('pl_daily', '2030-03-02', '[]'::jsonb); out := out || 'finance mart_replace: ALLOWED(!); ';
  exception when others then out := out || 'finance mart_replace: denied; '; end;
  execute 'reset role';
  -- S1 (PRD v4 §8): only the server rebuild job (service role) writes the mart
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select (public.mart_replace('pl_daily', '2030-03-02', '[{"date":"2030-03-02","pl_line":"Revenue - Trading","basis":"journal","actual":5}]'::jsonb) ->> 'written')::int into n;
  out := out || 'service mart_replace pl_daily written=' || n || case when n = 1 then '' else '(!)' end || '; ';
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
  begin perform public.mart_replace('cash_position_daily', '2030-04-01', '[]'::jsonb); out := out || 'finance mart_replace: ALLOWED(!); ';
  exception when others then out := out || 'finance mart_replace: denied; '; end;
  execute 'reset role';
  -- S1 (PRD v4 §8): only the server rebuild job (service role) writes the mart
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select (public.mart_replace('cash_position_daily', '2030-04-01', '[{"date":"2030-04-01","total_closing":100}]'::jsonb) ->> 'written')::int into n;
  out := out || 'service mart_replace cash_position written=' || n || case when n = 1 then '' else '(!)' end || '; ';
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
  -- S2 (PRD v4 §8): no assignment = no SKU in the view
  select count(*) into n from public.commercial_daily_sales where date = '2030-05-01'; out := out || 'sales read view without assignment=' || n || case when n = 0 then '' else '(!)' end || '; ';
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

  perform set_config('request.jwt.claims', '{"email":"t11-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily_sales where date = '2030-05-01'; out := out || 'sales read view with assignment=' || n || case when n = 1 then '' else '(!)' end || '; ';
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
  begin perform public.mart_replace('sales_scorecard_weekly', '2030-05-06', '[]'::jsonb); out := out || 'cl mart_replace: ALLOWED(!); ';
  exception when others then out := out || 'cl mart_replace: denied; '; end;
  execute 'reset role';
  -- S1 (PRD v4 §8): only the server rebuild job (service role) writes the mart
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select (public.mart_replace('sales_scorecard_weekly', '2030-05-06', '[{"week_start":"2030-05-06","sales_rep":"Budi","actual_kg":10}]'::jsonb) ->> 'written')::int into n;
  out := out || 'service mart_replace scorecard written=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  raise exception 'RLS-RESULTS v3 F6b (rolled back): %', out;
end $$;

-- v4 irisan 0 (docs/PRD-v4.md §8, §9.1 G2): matrix over the 9 roles. Every signed-in role: mart_replace refused (S1),
-- no direct mart write (S1), no write to the status registry; sales: no cost audit rows (S4); nobody decides their own
-- discount request; a locked version is neither edited nor deleted; the service role writes the mart and its status.
do $$
declare
  out text := ''; n int; ok boolean; r text; mid uuid; vid uuid; req uuid;
  roles text[] := array['admin','inventory_accounting','sales','ppic','purchasing','finance','management','commercial_lead','cost_accounting'];
begin
  foreach r in array roles loop
    insert into public.app_user(email, role) values ('t20-' || r || '@x.test', r);
  end loop;
  insert into public.month_outlook (month) values ('2030-06-01') returning id into mid;
  insert into public.month_outlook_version (month_outlook_id, version, snapshot, snapshot_sha256, revenue) values (mid, 'V1', '{}'::jsonb, 'x', 100) returning id into vid;
  insert into public.cost_pool (period_start, period_end) values ('2030-06-01', '2030-06-30');

  foreach r in array roles loop
    perform set_config('request.jwt.claims', format('{"email":"t20-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin perform public.mart_replace('pl_daily_v4', '2030-06-01', '[]'::jsonb); out := out || r || ' mart_replace: ALLOWED(!); ';
    exception when insufficient_privilege then out := out || r || ' mart_replace: denied; '; end;
    ok := true;
    begin insert into public.pl_daily_v4 (date, segment, pl_line, basis, actual) values ('2030-06-01', 'Trading', 'Revenue - Trading', 'journal', 1); ok := false; exception when others then null; end;
    begin insert into public.sku_balance_daily (date, key) values ('2030-06-01', 'x'); ok := false; exception when others then null; end;
    begin insert into public.demand_weekly (week_start, key) values ('2030-06-03', 'x'); ok := false; exception when others then null; end;
    begin insert into public.data_status (table_name, scope) values ('pl_daily_v4', '2030-06-01'); ok := false; exception when others then null; end;
    update public.pl_daily set actual = 0 where date = '2030-06-01'; get diagnostics n = row_count; if n > 0 then ok := false; end if;
    out := out || r || ' direct mart/status write: ' || case when ok then 'denied' else 'ALLOWED(!)' end || '; ';
    begin update public.month_outlook_version set revenue = 1 where id = vid; get diagnostics n = row_count;
      out := out || r || ' edit locked version rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' edit locked version: denied; '; end;
    begin delete from public.month_outlook_version where id = vid; get diagnostics n = row_count;
      out := out || r || ' delete version rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' delete version: denied; '; end;
    select count(*) into n from public.audit_log where table_name = 'cost_pool';
    if r = 'sales' then out := out || 'sales audit cost_pool rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    elsif r in ('admin','finance') then out := out || r || ' audit cost_pool rows=' || n || case when n > 0 then '' else '(!)' end || '; ';
    end if;
    execute 'reset role';
  end loop;

  begin delete from public.month_outlook_version where id = vid; out := out || 'owner delete locked version: ALLOWED(!); ';
  exception when others then out := out || 'owner delete locked version: denied; '; end;

  -- self-approval: a commercial lead files a request, then tries to decide it
  insert into public.discount_approval (key, customer, requested_price, floor_price, rp_per_kg_below, kg, total_below, requested_by, status)
  values ('RPA|Karkas|Fresh', 'PT Uji', 29800, 30000, 200, 10, 2000, 't20-commercial_lead@x.test', 'pending') returning id into req;
  perform set_config('request.jwt.claims', '{"email":"t20-commercial_lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.discount_approval set status = 'approved', decided_by = 't20-commercial_lead@x.test', decided_at = now() where id = req;
    out := out || 'cl approve own request: ALLOWED(!); ';
  exception when others then out := out || 'cl approve own request: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t20-finance@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.discount_approval set status = 'approved', decided_by = 't20-finance@x.test', decided_at = now() where id = req;
    out := out || 'finance approve request of cl: OK; ';
  exception when others then out := out || 'finance approve request of cl: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- S1: the service role (server rebuild job) writes the mart and records its status
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select (public.mart_replace('pl_daily_v4', '2030-06-01', '[{"date":"2030-06-01","segment":"Trading","pl_line":"Revenue - Trading","basis":"journal","actual":7}]'::jsonb) ->> 'written')::int into n;
  out := out || 'service mart_replace pl_daily_v4 written=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';
  select count(*) into n from public.data_status where table_name = 'pl_daily_v4' and scope = '2030-06-01' and built_at is not null;
  out := out || 'data_status recorded=' || n || case when n = 1 then '' else '(!)' end || '; ';
  -- signed in but claiming the service role in the JWT is not enough: the grant is on the database role
  perform set_config('request.jwt.claims', '{"email":"t20-admin@x.test","role":"service_role"}', true);
  execute 'set local role authenticated';
  begin perform public.mart_replace('pl_daily_v4', '2030-06-01', '[]'::jsonb); out := out || 'authenticated with service claim: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'authenticated with service claim: denied; '; end;
  execute 'reset role';

  -- S6: SECURITY DEFINER hygiene
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  out := out || 'definer without search_path=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  out := out || 'definer callable by anon=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and p.prorettype = 'pg_catalog.trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  out := out || 'definer trigger fn callable by authenticated=' || n || case when n = 0 then '' else '(!)' end || '; ';
  ok := has_function_privilege('authenticated', 'public.mart_replace(text,text,jsonb)', 'execute');
  out := out || 'mart_replace granted to authenticated=' || ok || case when ok then '(!)' else '' end || '; ';

  raise exception 'RLS-RESULTS v4 irisan 0 G2 (rolled back): %', out;
end $$;

-- v4 irisan 0: K7 partial delivery (fixture delivery-partial: PO 1.800 kg, delivered 600 kg, outstanding 1.200 kg),
-- C29 / C38 in the database (S5), S2 discount scope, the §4.2 tables and the 4 v3 tables not covered above.
do $$
declare
  out text := ''; n int; v numeric; wid uuid; cw uuid; lid uuid; lid2 uuid; cid uuid; mid uuid; pid uuid; req uuid;
begin
  insert into public.app_user(email, role) values ('t21-sales@x.test','sales'),('t21-sales2@x.test','sales'),('t21-mgmt@x.test','management'),
    ('t21-fin@x.test','finance'),('t21-ppic@x.test','ppic'),('t21-cl@x.test','commercial_lead'),('t21-ia@x.test','inventory_accounting'),('t21-admin@x.test','admin');
  select id into wid from public.week where status <> 'closed' order by week_start desc limit 1;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2030-06-03', '2030-06-05', '2030-06-02', 'closed') returning id into cw;
  insert into public.sales_line (week_id, date, status, item_code, kg, price, customer, delivery_date, demand_status)
  values (wid, '2030-06-04', 'Order', 'JLB0593', 1800, 30000, 'PT Uji', '2030-06-05', 'Confirmed') returning id into lid;
  insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (cw, '2030-06-04', 'Order', 'JLB0593', 100, 30000, 'PT Uji') returning id into lid2;

  -- K7: Terkirim records kg; fulfilled_kg follows Σ delivery
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.delivery (sales_line_id, date, kg, document_ref) values (lid, '2030-06-05', 600, 'DO-T21-1'); out := out || 'sales deliver 600: OK; ';
  exception when others then out := out || 'sales deliver 600: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select kg - fulfilled_kg - cancelled_kg into v from public.sales_line where id = lid;
  out := out || 'outstanding=' || v || case when v = 1200 then '' else '(!)' end || '; ';
  select count(*) into n from public.sales_line where id = lid and status = 'Order'; out := out || 'line still Order=' || n || case when n = 1 then '' else '(!)' end || '; ';
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.delivery (sales_line_id, date, kg) values (lid, '2030-06-06', 1300); out := out || 'deliver beyond order: ALLOWED(!); ';
  exception when others then out := out || 'deliver beyond order: denied; '; end;
  begin update public.sales_line set fulfilled_kg = 1800 where id = lid; out := out || 'set fulfilled_kg directly: ALLOWED(!); ';
  exception when others then out := out || 'set fulfilled_kg directly: denied; '; end;
  begin update public.sales_line set cancelled_kg = 1300 where id = lid; out := out || 'cancel more than outstanding: ALLOWED(!); ';
  exception when others then out := out || 'cancel more than outstanding: denied; '; end;
  begin update public.sales_line set cancelled_kg = 200 where id = lid; out := out || 'cancel 200: OK; ';
  exception when others then out := out || 'cancel 200: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.delivery (sales_line_id, date, kg) values (lid, '2030-06-06', 1001); out := out || 'deliver over (kg − cancelled): ALLOWED(!); ';
  exception when others then out := out || 'deliver over (kg − cancelled): denied; '; end;
  begin insert into public.delivery (sales_line_id, date, kg) values (lid2, '2030-06-06', 10); out := out || 'sales deliver closed week: ALLOWED(!); ';
  exception when others then out := out || 'sales deliver closed week: denied; '; end;
  begin update public.delivery set kg = 1 where sales_line_id = lid; get diagnostics n = row_count; out := out || 'sales edit delivery rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales edit delivery: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.delivery (sales_line_id, date, kg) values (lid, '2030-06-06', 1); out := out || 'mgmt deliver: ALLOWED(!); ';
  exception when others then out := out || 'mgmt deliver: denied; '; end;
  select count(*) into n from public.delivery where sales_line_id = lid; out := out || 'mgmt read delivery=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';
  -- Admin corrects a delivery by soft delete: fulfilled_kg follows
  perform set_config('request.jwt.claims', '{"email":"t21-admin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  update public.delivery set deleted_at = now() where sales_line_id = lid;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select fulfilled_kg into v from public.sales_line where id = lid; out := out || 'fulfilled after soft delete=' || v || case when v = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.rebuild_queue where date = '2030-06-05' and status = 'queued'; out := out || 'delivery queued rebuild=' || n || case when n = 1 then '' else '(!)' end || '; ';

  -- C29: Σ allocation ≤ kg − cancelled (1.600 kg)
  perform set_config('request.jwt.claims', '{"email":"t21-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation (date, sales_line_id, lot_ref, kg) values ('2030-06-05', lid, 'LOT-A', 1000); out := out || 'allocate 1000: OK; ';
  exception when others then out := out || 'allocate 1000: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.allocation (date, sales_line_id, lot_ref, kg) values ('2030-06-05', lid, 'LOT-B', 601); out := out || 'over-allocate: ALLOWED(!); ';
  exception when others then out := out || 'over-allocate: denied; '; end;
  begin insert into public.allocation (date, sales_line_id, lot_ref, kg) values ('2030-06-05', lid, 'LOT-B', 600); out := out || 'allocate up to cap: OK; ';
  exception when others then out := out || 'allocate up to cap: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- C38: with m7_approval on, an order under the floor needs an approved request
  perform set_config('request.jwt.claims', '', true);
  update public.app_setting set value = '{"enabled": true}' where key = 'm7_approval';
  insert into public.commercial_daily (date, key, price_floor) values ((now() at time zone 'Asia/Jakarta')::date, 'RPA|Karkas|Fresh', 30000)
    on conflict (date, key) do update set price_floor = 30000;
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wid, current_date, 'Order', 'JLB0593', 10, 29000, 'PT Lain');
    out := out || 'order under floor via API: ALLOWED(!); ';
  exception when others then out := out || 'order under floor via API: denied; '; end;
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wid, current_date, 'Order', 'JLB0593', 10, 30500, 'PT Lain');
    out := out || 'order above floor: OK; ';
  exception when others then out := out || 'order above floor: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into public.discount_approval (key, customer, requested_price, floor_price, rp_per_kg_below, kg, total_below, requested_by, status, decided_by, decided_at)
  values ('RPA|Karkas|Fresh', 'PT Lain', 29000, 30000, 1000, 10, 10000, 't21-sales@x.test', 'approved', 't21-fin@x.test', now()) returning id into req;
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wid, current_date, 'Order', 'JLB0593', 10, 29000, 'PT Lain');
    out := out || 'order under floor with approval: OK; ';
  exception when others then out := out || 'order under floor with approval: DENIED(!) ' || sqlerrm || '; '; end;
  -- S2: sales reads only own / assigned discount requests
  select count(*) into n from public.discount_approval where id = req; out := out || 'sales read own request=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-sales2@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.discount_approval where id = req; out := out || 'other sales read request=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  update public.app_setting set value = '{"enabled": false}' where key = 'm7_approval';
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wid, current_date, 'Order', 'JLB0593', 10, 20000, 'PT Lain');
    out := out || 'flag off, under floor: OK; ';
  exception when others then out := out || 'flag off, under floor: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- approved weekly plan keeps its numbers
  perform set_config('request.jwt.claims', '', true);
  insert into public.plan_week (week_start, version, head_count, approved_by, approved_at) values ('2030-06-03', 1, 100, 't21-fin@x.test', now()) returning id into pid;
  perform set_config('request.jwt.claims', '{"email":"t21-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.plan_week set head_count = 200 where id = pid; out := out || 'edit approved plan: ALLOWED(!); ';
  exception when others then out := out || 'edit approved plan: denied; '; end;
  begin update public.plan_week set copied_to_batch_at = now() where id = pid; out := out || 'copy approved plan to batch: OK; ';
  exception when others then out := out || 'copy approved plan to batch: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- §4.2 tables
  perform set_config('request.jwt.claims', '', true);
  insert into public.month_outlook (month) values ('2030-07-01') returning id into mid;
  perform set_config('request.jwt.claims', '{"email":"t21-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.cost_event (date, pl_line, amount, reason) values ('2030-07-02', 'Maintenance', -38800000, 'perbaikan mesin'); out := out || 'finance cost_event: OK; ';
  exception when others then out := out || 'finance cost_event: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.budget (month, segment, metric, value, locked) values ('2030-07-01', 'Trading', 'revenue', 1000, true); out := out || 'finance budget: OK; ';
  exception when others then out := out || 'finance budget: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.budget set value = 2 where month = '2030-07-01'; out := out || 'finance edit locked budget: ALLOWED(!); ';
  exception when others then out := out || 'finance edit locked budget: denied; '; end;
  begin insert into public.assumption_register (month_outlook_id, code, name, value_num) values (mid, 'RR', 'run-rate 7 hari', 310.4); out := out || 'finance assumption: OK; ';
  exception when others then out := out || 'finance assumption: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.fixed_cost_schedule set day_basis = 'working', owner = 'HR', posting_day = 25 where code = (select code from public.fixed_cost_schedule order by code limit 1);
    get diagnostics n = row_count; out := out || 'finance 8.3 fields rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance 8.3 fields: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.cost_event; out := out || 'sales read cost_event=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.budget; out := out || 'sales read budget=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.budget; out := out || 'mgmt read budget=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.assumption_register (month_outlook_id, code, name) values (mid, 'X', 'x'); out := out || 'mgmt assumption: ALLOWED(!); ';
  exception when others then out := out || 'mgmt assumption: denied; '; end;
  select count(*) into n from public.status_map; out := out || 'mgmt read status_map=' || n || case when n >= 15 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.cost_event (date, pl_line, amount, reason) values ('2030-07-02', 'x', 1, 'x'); out := out || 'ppic cost_event: ALLOWED(!); ';
  exception when others then out := out || 'ppic cost_event: denied; '; end;
  begin insert into public.demand_shortfall (week_start, key) values ('2030-06-03', 'x'); out := out || 'ppic direct shortfall mart: ALLOWED(!); ';
  exception when others then out := out || 'ppic direct shortfall mart: denied; '; end;
  begin insert into public.plan_variance_daily (date, key) values ('2030-06-03', 'x'); out := out || 'ppic direct variance mart: ALLOWED(!); ';
  exception when others then out := out || 'ppic direct variance mart: denied; '; end;
  -- v3 tables without an entry above (allocation_line, ccc_daily, outlook_assumption, substitution)
  begin insert into public.substitution (key_demand, key_substitute) values ('RPA|Karkas|Fresh', 'RPA|Karkas|Frozen'); out := out || 'ppic substitution: OK; ';
  exception when others then out := out || 'ppic substitution: DENIED(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.ccc_daily; out := out || 'ppic read ccc=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.substitution (key_demand, key_substitute) values ('RPA|BLD|Fresh', 'RPA|BLD|Frozen'); out := out || 'sales substitution: ALLOWED(!); ';
  exception when others then out := out || 'sales substitution: denied; '; end;
  select count(*) into n from public.allocation_line; out := out || 'sales read allocation_line=' || n || case when n = 0 then '' else '(!)' end || '; ';
  begin insert into public.outlook_assumption (month_outlook_id, code) values (mid, 'X'); out := out || 'sales outlook_assumption: ALLOWED(!); ';
  exception when others then out := out || 'sales outlook_assumption: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t21-admin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.ccc_daily (date) values ('2030-06-01'); out := out || 'admin direct ccc mart: ALLOWED(!); ';
  exception when others then out := out || 'admin direct ccc mart: denied; '; end;
  begin insert into public.forecast_accuracy_daily (month_outlook_id, version, date, segment) values (mid, 'V1', '2030-07-01', 'Trading'); out := out || 'admin direct accuracy mart: ALLOWED(!); ';
  exception when others then out := out || 'admin direct accuracy mart: denied; '; end;
  execute 'reset role';

  -- §4.1 defaults and seed
  select runrate_window_days + v1_lock_week + case when spot_enabled then 100 else 0 end into n from public.parameter where week_id = wid;
  out := out || 'parameter runrate 7 + lock week 3 + spot off=' || n || case when n = 10 then '' else '(!)' end || '; ';
  select count(*) into n from public.sku_key where product_class = 'by_product' and sku in ('Kepala','Ceker','Usus','HJA (Hati/Jantung/Ampela)','Lemak');
  out := out || 'by-product keys=' || n || case when n > 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.sku_key where product_class = 'by_product' and sku = 'Karkas'; out := out || 'karkas by-product=' || n || case when n = 0 then '' else '(!)' end || '; ';

  raise exception 'RLS-RESULTS v4 irisan 0 K7/S5/§4.2 (rolled back): %', out;
end $$;

-- v4 irisan 1: flag v4_design (off by default, only Admin changes it) and the week-level rebuild trigger: a change of the
-- run-rate, parameter or sell price of a week queues the Monday of that week (the weekly rows of pl_daily_v4 depend on them).
do $$
declare out text := ''; n int; wid uuid; ws date; b boolean;
begin
  insert into public.app_user(email, role) values ('t22-admin@x.test','admin'),('t22-ppic@x.test','ppic'),('t22-fin@x.test','finance'),('t22-mgmt@x.test','management');
  select id, week_start into wid, ws from public.week order by week_start desc limit 1;
  select (value ->> 'enabled')::boolean into b from public.app_setting where key = 'v4_design';
  out := out || 'v4_design default enabled=' || coalesce(b::text, 'missing') || case when b = false then '' else '(!)' end || '; ';

  perform set_config('request.jwt.claims', '{"email":"t22-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  update public.app_setting set value = '{"enabled": true}' where key = 'v4_design'; get diagnostics n = row_count;
  out := out || 'ppic set v4_design rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t22-admin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  update public.app_setting set value = '{"enabled": true, "roles": ["management"]}' where key = 'v4_design'; get diagnostics n = row_count;
  out := out || 'admin set v4_design rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  b := public.module_enabled('v4_design'); out := out || 'admin sees v4_design for management only=' || case when b then 'ON(!)' else 'off' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t22-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  b := public.module_enabled('v4_design'); out := out || 'management sees v4_design=' || case when b then 'on' else 'off(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  delete from public.rebuild_queue;
  update public.parameter set lb_price_today = coalesce(lb_price_today, 0) + 1 where week_id = wid;
  select count(*) into n from public.rebuild_queue where date = ws and status = 'queued';
  out := out || 'parameter change queued the week=' || n || case when n = 1 then '' else '(!)' end || '; ';
  delete from public.rebuild_queue;
  update public.runrate set week_adjustment = coalesce(week_adjustment, 0) + 1 where week_id = wid and id = (select id from public.runrate where week_id = wid limit 1);
  select count(*) into n from public.rebuild_queue where date = ws and status = 'queued';
  out := out || 'run-rate change queued the week=' || n || case when n = 1 then '' else '(!)' end || '; ';
  select count(*) into n from public.rebuild_queue where status = 'queued';
  out := out || 'queued rows once=' || n || case when n = 1 then '' else '(!)' end || '; ';

  raise exception 'RLS-RESULTS v4 irisan 1 (rolled back): %', out;
end $$;

-- v4 irisan 2: budget (P4) and one-off costs (§3.3) are Finance's and hidden from Sales; a locked budget is revised by
-- a new version; the register is agreed by Finance only; the month marts, data_status and the cash horizon are written
-- by the server job only; template 8.3 columns are checked in the database; a locked version stays as it was.
do $$
declare out text := ''; n int; mo uuid; vid uuid; fid uuid; b text;
begin
  insert into public.app_user(email, role) values ('t23-fin@x.test','finance'),('t23-sales@x.test','sales'),('t23-mgmt@x.test','management'),('t23-ppic@x.test','ppic'),('t23-admin@x.test','admin');
  insert into public.month_outlook (month, status) values ('2030-07-01', 'open') returning id into mo;
  insert into public.assumption_register (month_outlook_id, code, name, value_num, owner, source) values (mo, 'runrate_revenue', 'Run-rate', 310400000, 'Group Project Finance', 'engine');
  insert into public.coa_map (account, name, type, pl_line, driver_type) values ('9-T23', 'Gaji uji', 'LabaRugi', 'Salaries and allowance', 'fixed') on conflict (account) do update set driver_type = 'fixed';

  -- Finance: budget version 1, a one-off cost, agrees the run-rate
  perform set_config('request.jwt.claims', '{"email":"t23-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.budget (version, month, segment, metric, value, locked) values (1, '2030-07-01', 'Total', 'revenue', 8000000000, true); out := out || 'finance budget v1: OK; ';
  exception when others then out := out || 'finance budget v1: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.budget set value = 1 where month = '2030-07-01' and version = 1; out := out || 'finance edit locked budget: ALLOWED(!); ';
  exception when others then out := out || 'finance edit locked budget: denied; '; end;
  begin insert into public.budget (version, month, segment, metric, value) values (2, '2030-07-01', 'Total', 'revenue', 7500000000); out := out || 'finance budget v2: OK; ';
  exception when others then out := out || 'finance budget v2: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.cost_event (date, pl_line, amount, reason) values ('2030-07-15', 'Maintenance Expenses', 25000000, 'perbaikan chiller'); out := out || 'finance cost_event: OK; ';
  exception when others then out := out || 'finance cost_event: DENIED(!) ' || sqlerrm || '; '; end;
  update public.assumption_register set status = 'agreed', agreed_at = now() where month_outlook_id = mo; get diagnostics n = row_count;
  out := out || 'finance agree register rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.fixed_cost_schedule (code, account, pl_line, description, amount_per_month, start_date, day_basis, posting_day, basis_doc, owner, version)
    values ('T83|9-T23|2030-07-01', '9-T23', 'Salaries and allowance', 'payroll', 85565549, '2030-07-01', 'calendar', 25, 'payroll', 'HR', 1) returning id into fid; out := out || 'finance template 8.3 row: OK; ';
  exception when others then out := out || 'finance template 8.3 row: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.fixed_cost_schedule (code, pl_line, description, start_date, day_basis) values ('T83|x|2030-07-02', 'Rent Expenses', 'x', '2030-07-01', 'mingguan'); out := out || 'day_basis mingguan: ALLOWED(!); ';
  exception when others then out := out || 'day_basis mingguan: rejected; '; end;
  begin insert into public.fixed_cost_schedule (code, pl_line, description, start_date, posting_day) values ('T83|x|2030-07-03', 'Rent Expenses', 'x', '2030-07-01', 32); out := out || 'posting day 32: ALLOWED(!); ';
  exception when others then out := out || 'posting day 32: rejected; '; end;
  -- marts and the status registry: no client write
  begin insert into public.pl_daily_v4 (date, segment, pl_line, basis, actual) values ('2030-07-01', 'Trading', 'Revenue - Trading', 'journal', 1); out := out || 'finance write pl_daily_v4: ALLOWED(!); ';
  exception when others then out := out || 'finance write pl_daily_v4: denied; '; end;
  begin insert into public.data_status (table_name, scope, status) values ('month_lock', '2030-07-01', 'validated'); out := out || 'finance write data_status: ALLOWED(!); ';
  exception when others then out := out || 'finance write data_status: denied; '; end;
  begin insert into public.cash_position_daily (date, total_closing, horizon) values ('2030-07-01', 1, '{}'); out := out || 'finance write cash horizon: ALLOWED(!); ';
  exception when others then out := out || 'finance write cash horizon: denied; '; end;
  begin perform public.mart_replace('pl_daily_v4', '2030-07-01', '[]'::jsonb); out := out || 'finance mart_replace: ALLOWED(!); ';
  exception when others then out := out || 'finance mart_replace: denied; '; end;
  -- V1 with the v4 columns (written as the system here: release_month itself is tested in irisan 4); nobody changes it
  execute 'reset role';
  insert into public.month_outlook_version (month_outlook_id, version, cut_off_date, locked_by, snapshot, snapshot_sha256, revenue, gp, nibt, rule_version, anomaly_days, po_share, approved_by)
    values (mo, 'V1', '2030-07-18', 't23-fin@x.test', '{"rule_version":"v4-2026-10"}', repeat('a', 64), 7764100000, 292500000, 75300000, 'v4-2026-10', '[{"date":"2030-07-15","reason":"nol"}]', 0.775, 't23-fin@x.test') returning id into vid;
  out := out || 'V1 with v4 columns stored; ';
  execute 'set local role authenticated';
  begin update public.month_outlook_version set revenue = 1 where id = vid; get diagnostics n = row_count; out := out || 'finance change V1 rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance change V1: denied; '; end;
  execute 'reset role';

  -- Sales sees neither budget nor one-off costs; Management reads, never writes; PPIC cannot add one-off costs
  perform set_config('request.jwt.claims', '{"email":"t23-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.budget where month = '2030-07-01'; out := out || 'sales read budget=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.cost_event where date = '2030-07-15'; out := out || 'sales read cost_event=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t23-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.budget where month = '2030-07-01'; out := out || 'mgmt read budget=' || n || case when n = 2 then '' else '(!)' end || '; ';
  begin insert into public.budget (version, month, segment, metric, value) values (3, '2030-07-01', 'Total', 'gp', 1); out := out || 'mgmt write budget: ALLOWED(!); ';
  exception when others then out := out || 'mgmt write budget: denied; '; end;
  update public.assumption_register set status = 'proposed' where month_outlook_id = mo; get diagnostics n = row_count;
  out := out || 'mgmt change register rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t23-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.cost_event (date, pl_line, amount, reason) values ('2030-07-16', 'Maintenance Expenses', 1, 'x'); out := out || 'ppic cost_event: ALLOWED(!); ';
  exception when others then out := out || 'ppic cost_event: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- a one-off cost queues its date for the month rebuild; the cash mart carries the horizon column
  select count(*) into n from public.rebuild_queue where date = '2030-07-15' and status = 'queued'; out := out || 'cost_event queued rebuild=' || n || case when n >= 1 then '' else '(!)' end || '; ';
  select data_type into b from information_schema.columns where table_schema = 'public' and table_name = 'cash_position_daily' and column_name = 'horizon';
  out := out || 'cash_position_daily.horizon=' || coalesce(b, 'missing(!)') || '; ';
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'cash_position_daily'
    and column_name in ('closing_without_affiliate','operating_in','operating_out','affiliate_net','lowest_without_affiliate','lowest_without_date','affiliate_assumption');
  out := out || 'cash split columns=' || n || case when n = 7 then '' else '(!)' end || '; ';

  raise exception 'RLS-RESULTS v4 irisan 2 (rolled back): %', out;
end $$;

-- v4 irisan 3: the written reason that opens a PERIKSA step is PPIC's (§6.4); the M3 marts are server-only; one DO
-- per PO line once (K7, re-upload and parallel Terkirim); capacity rows seeded empty for PPIC; demand_weekly columns.
do $$
declare out text := ''; n int; wid uuid; lid uuid; b text;
begin
  insert into public.app_user(email, role) values ('t24-ppic@x.test','ppic'),('t24-sales@x.test','sales'),('t24-fin@x.test','finance'),('t24-mgmt@x.test','management');
  select id into wid from public.week where status <> 'closed' order by week_start desc limit 1;
  insert into public.sales_line (week_id, date, status, item_code, kg, price, customer, delivery_date, demand_status, po_ref)
  values (wid, '2030-06-04', 'Order', 'JLB0593', 1800, 30000, 'PT Uji', '2030-06-05', 'Confirmed', 'PO-T24') returning id into lid;

  perform set_config('request.jwt.claims', '{"email":"t24-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_check_reason (week_start, code, reason) values ('2030-06-03', 'C41', 'kekurangan dibeli trading'); out := out || 'ppic reason C41: OK; ';
  exception when others then out := out || 'ppic reason C41: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason) values ('2030-06-03', 'C41', 'alasan kedua'); out := out || 'second active reason: ALLOWED(!); ';
  exception when others then out := out || 'second active reason: rejected; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason) values ('2030-06-03', 'C44', 'ok'); out := out || 'reason too short: ALLOWED(!); ';
  exception when others then out := out || 'reason too short: rejected; '; end;
  begin insert into public.demand_shortfall (week_start, key, shortfall_kg) values ('2030-06-03', 'Usus', 1); out := out || 'ppic write demand_shortfall: ALLOWED(!); ';
  exception when others then out := out || 'ppic write demand_shortfall: denied; '; end;
  begin insert into public.plan_variance_daily (date, key, variance_kg) values ('2030-06-04', 'Karkas', 1); out := out || 'ppic write plan_variance_daily: ALLOWED(!); ';
  exception when others then out := out || 'ppic write plan_variance_daily: denied; '; end;
  update public.capacity set cut_capacity_head = 3000 where date = '2026-10-20'; get diagnostics n = row_count;
  out := out || 'ppic fills seeded capacity rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t24-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_check_reason (week_start, code, reason) values ('2030-06-03', 'C44', 'forecast menyusul'); out := out || 'sales reason: ALLOWED(!); ';
  exception when others then out := out || 'sales reason: denied; '; end;
  update public.capacity set cut_capacity_head = 1 where date = '2026-10-21'; get diagnostics n = row_count;
  out := out || 'sales change capacity rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  begin insert into public.delivery (sales_line_id, date, kg, document_ref) values (lid, '2030-06-05', 600, 'DO-T24'); out := out || 'sales deliver DO-T24: OK; ';
  exception when others then out := out || 'sales deliver DO-T24: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.delivery (sales_line_id, date, kg, document_ref) values (lid, '2030-06-05', 600, 'DO-T24'); out := out || 'same DO again: ALLOWED(!); ';
  exception when others then out := out || 'same DO again: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  select kg - fulfilled_kg into n from public.sales_line where id = lid; out := out || 'outstanding after one DO=' || n || case when n = 1200 then '' else '(!)' end || '; ';
  select count(*) into n from public.capacity where note like 'Maklon%' and cut_capacity_head is null; out := out || 'maklon seed rows empty=' || n || case when n >= 12 then '' else '(!)' end || '; ';
  select count(*) into n from public.capacity where note like 'RPA Rawa Terate%'; out := out || 'Rawa Terate seed rows=' || n || case when n = 29 then '' else '(!)' end || '; ';
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'demand_weekly' and column_name in ('unit','product_class','source_forecast');
  out := out || 'demand_weekly v4 columns=' || n || case when n = 3 then '' else '(!)' end || '; ';
  begin insert into public.demand_weekly (week_start, key, product_class) values ('2030-06-03', 'x', 'lainnya'); out := out || 'product_class lainnya: ALLOWED(!); ';
  exception when others then out := out || 'product_class lainnya: rejected; '; end;

  raise exception 'RLS-RESULTS v4 irisan 3 (rolled back): %', out;
end $$;

-- v4 irisan 4: §7.2 release only through release_week / release_month (role, SHA-256, controls per rule, STALE, version
-- order, FINAL after month end, K9, C48); overrides per control for the role the policy names, no generic admin override;
-- C48 blocks posting a costing; batches from 1 Nov 2026 take the own-RPA mode; DI-01 columns on the ledger.
do $$
declare out text := ''; n int; wk uuid; r text;
  ok8 text := '{"engineVersion":"t","controls":{"overall":"BELUM DIISI","controls":[{"no":8,"status":"BELUM DIISI"},{"no":11,"status":"LULUS"}]}}';
  bad11 text := '{"engineVersion":"t","controls":{"overall":"ADA GAGAL","controls":[{"no":8,"status":"LULUS"},{"no":11,"status":"GAGAL"}]}}';
  m1 text := '{"rule_version":"v4-test","controls":[{"code":"C33","status":"LULUS"},{"code":"C34","status":"LULUS"},{"code":"C49","status":"BELUM DIISI"}]}';
begin
  insert into public.app_user(email, role) values ('t25-fin@x.test','finance'),('t25-adm@x.test','admin'),('t25-sales@x.test','sales'),('t25-ca@x.test','cost_accounting');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2031-03-03', '2031-03-06', '2031-02-28') returning id into wk;
  delete from public.rebuild_queue where date between '2031-03-03' and '2031-03-09';

  -- sales may not release; finance with a changed snapshot is refused
  perform set_config('request.jwt.claims', '{"email":"t25-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'sales release_week: ALLOWED(!); ';
  exception when others then out := out || 'sales release_week: denied; '; end;
  begin perform public.release_month('2026-01-01', 'V1', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2026-01-31', '{}'::jsonb, 'v4-test', null, null); out := out || 'sales release_month: ALLOWED(!); ';
  exception when others then out := out || 'sales release_month: denied; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C8', 'alasan sales yang panjang', 'file'); out := out || 'sales override: ALLOWED(!); ';
  exception when others then out := out || 'sales override: denied; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t25-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk, ok8, repeat('0', 64), null, '[]'::jsonb); out := out || 'SHA mismatch: ALLOWED(!); ';
  exception when others then out := out || 'SHA mismatch: rejected; '; end;
  begin insert into public.release (week_id, update_date, engine_version, snapshot, snapshot_sha256, control_status, controls, released_by)
    values (wk, '2031-03-06', 't', ok8::jsonb, 'x', 'LULUS', '{}'::jsonb, 'x'); out := out || 'direct release insert: ALLOWED(!); ';
  exception when others then out := out || 'direct release insert: denied; '; end;
  -- flag off (v1 rule): GAGAL rejects, even with an override; BELUM DIISI releases
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C11', 'stok minus karena DO terlambat', 'SJ-1'); out := out || 'finance override C11: OK; ';
  exception when others then out := out || 'finance override C11: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(wk, bad11, encode(sha256(convert_to(bad11, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'v1 rule C11 GAGAL with override: ALLOWED(!); ';
  exception when others then out := out || 'v1 rule C11 GAGAL: rejected (' || sqlerrm || '); '; end;
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'v1 rule C8 BELUM DIISI: released; ';
  exception when others then out := out || 'v1 rule C8 BELUM DIISI: REJECTED(!) ' || sqlerrm || '; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C45', 'mart lama tapi angka benar', 'cek'); out := out || 'override C45: ALLOWED(!); ';
  exception when others then out := out || 'override C45: denied; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C48', 'batch tanpa output', 'cek'); out := out || 'override C48: ALLOWED(!); ';
  exception when others then out := out || 'override C48: denied; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C9', 'pendek', 'x'); out := out || 'override short reason: ALLOWED(!); ';
  exception when others then out := out || 'override short reason: rejected; '; end;
  execute 'reset role';

  -- flag on (§7.2): BELUM DIISI and STALE reject; admin has no override for C1–C20; finance's override lifts C8
  update public.app_setting set value = '{"enabled": true}' where key = 'v4_release';
  perform set_config('request.jwt.claims', '{"email":"t25-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'strict C8 BELUM DIISI: ALLOWED(!); ';
  exception when others then out := out || 'strict C8 BELUM DIISI: rejected (' || sqlerrm || '); '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t25-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C8', 'admin ingin melewati', 'file'); out := out || 'admin override C8: ALLOWED(!); ';
  exception when others then out := out || 'admin override C8: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t25-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-03-03', 'C8', 'parameter shrink disepakati rapat', 'notulen 5 Mar'); out := out || 'finance override C8: OK; ';
  exception when others then out := out || 'finance override C8: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'strict with override C8: released; ';
  exception when others then out := out || 'strict with override C8: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select created_role into r from public.release_override where code = 'C8' and scope = '2031-03-03' and deleted_at is null;
  out := out || 'override role stamped=' || coalesce(r, 'null') || case when r = 'finance' then '' else '(!)' end || '; ';
  insert into public.rebuild_queue (date, reason) values ('2031-03-04', 'uji STALE');
  perform set_config('request.jwt.claims', '{"email":"t25-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'strict STALE: ALLOWED(!); ';
  exception when others then out := out || 'strict STALE: rejected (' || sqlerrm || '); '; end;
  -- monthly: order, FINAL after the month end, K9, overrides per version, immutability
  begin perform public.release_month('2026-02-01', 'V2', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2026-02-20', '{}'::jsonb, 'v4-test', null, null); out := out || 'V2 before V1: ALLOWED(!); ';
  exception when others then out := out || 'V2 before V1: rejected; '; end;
  begin perform public.release_month('2030-06-01', 'FINAL', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2030-06-30', '{}'::jsonb, 'v4-test', null, null); out := out || 'FINAL before month end: ALLOWED(!); ';
  exception when others then out := out || 'FINAL before month end: rejected; '; end;
  begin perform public.release_month('2030-06-01', 'V1', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2030-06-10', '{}'::jsonb, 'v4-test', null, null); out := out || 'V1 before K9 date: ALLOWED(!); ';
  exception when others then out := out || case when sqlerrm like '%K9%' then 'V1 before K9 date: rejected; ' else 'V1 before K9: wrong reason(!) ' || sqlerrm || '; ' end; end;
  begin perform public.release_month('2026-01-01', 'V1', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2026-01-20', '{"revenue":"1"}'::jsonb, 'v4-test', null, null); out := out || 'V1 C49 BELUM DIISI: ALLOWED(!); ';
  exception when others then out := out || 'V1 C49 BELUM DIISI: rejected (' || sqlerrm || '); '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2026-01-01:V1', 'C49', 'P&L bulan berjalan belum ditutup Accurate', 'email 20 Jan'); out := out || 'finance override C49 V1: OK; ';
  exception when others then out := out || 'finance override C49 V1: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_month('2026-01-01', 'V1', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2026-01-20', '{"revenue":"1"}'::jsonb, 'v4-test', null, null); out := out || 'V1 with override: locked; ';
  exception when others then out := out || 'V1 with override: REJECTED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_month('2026-01-01', 'V1', m1, encode(sha256(convert_to(m1, 'UTF8')), 'hex'), '2026-01-20', '{"revenue":"1"}'::jsonb, 'v4-test', null, null); out := out || 'V1 twice: ALLOWED(!); ';
  exception when others then out := out || 'V1 twice: rejected; '; end;
  begin insert into public.month_outlook_version (month_outlook_id, version, snapshot, snapshot_sha256) select id, 'V2', '{}'::jsonb, 'x' from public.month_outlook where month = '2026-01-01';
    out := out || 'direct version insert: ALLOWED(!); ';
  exception when others then out := out || 'direct version insert: denied; '; end;
  begin update public.month_outlook_version set revenue = 2 where version = 'V1' and month_outlook_id = (select id from public.month_outlook where month = '2026-01-01'); get diagnostics n = row_count;
    out := out || 'V1 rewritten rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'V1 rewrite: rejected; '; end;
  execute 'reset role';
  select count(*) into n from public.release r join public.week w on w.id = r.week_id where w.week_start = '2031-03-03';
  out := out || 'releases written=' || n || case when n = 2 then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v4 irisan 4a (rolled back): %', out;
end $$;

-- v4 irisan 4b: C48 on posting and on FINAL; own-RPA mode from 1 Nov 2026; overhead per head; DI-01 ledger columns;
-- override roles per control for M1 (cost accounting) and none for sales.
do $$
declare out text := ''; n int; wk uuid; bid uuid; bid2 uuid; rid uuid; m text := '{"rule_version":"v4-test","controls":[]}'; t text;
begin
  insert into public.app_user(email, role) values ('t26-fin@x.test','finance'),('t26-ca@x.test','cost_accounting'),('t26-inv@x.test','inventory_accounting');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2026-11-02', '2026-11-05', '2026-10-31') returning id into wk;
  insert into public.batch (week_id, date, status, batch_ref) values (wk, '2026-11-03', 'Aktual', 'T26-A') returning id into bid;
  select cost_mode into t from public.batch where id = bid;
  out := out || 'batch 3 Nov cost_mode=' || t || case when t = 'own' then '' else '(!)' end || '; ';
  insert into public.batch (week_id, date, status, batch_ref, cost_mode) values (wk, '2026-11-04', 'Aktual', 'T26-B', 'own') returning id into bid2;
  select count(*) into n from information_schema.columns where table_schema = 'public' and ((table_name = 'overhead_rate' and column_name = 'rate_per_head') or (table_name = 'lot_movement' and column_name in ('revenue_date','cost_ma_revenue')));
  out := out || 'v4 irisan 4 columns=' || n || case when n = 3 then '' else '(!)' end || '; ';

  perform set_config('request.jwt.claims', '{"email":"t26-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation_run (batch_id, total_cost, total_allocated, status) values (bid, 12000000, 12000000, 'posted'); out := out || 'post costing without output: ALLOWED(!); ';
  exception when others then out := out || 'post costing without output: rejected (C48); '; end;
  begin insert into public.allocation_run (batch_id, total_cost, total_allocated, status) values (bid, 12000000, 12000000, 'draft') returning id into rid; out := out || 'draft without output: OK; ';
  exception when others then out := out || 'draft without output: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.allocation_run set status = 'posted' where id = rid; out := out || 'draft → posted without output: ALLOWED(!); ';
  exception when others then out := out || 'draft to posted without output: rejected; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2026-11-01:FINAL', 'C21', 'selisih pembulatan alokasi', 'WP 3 Nov'); out := out || 'cost accounting override C21: OK; ';
  exception when others then out := out || 'cost accounting override C21: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2026-11-01:FINAL', 'C35', 'rekening baru belum diunggah', 'BCA'); out := out || 'cost accounting override C35: ALLOWED(!); ';
  exception when others then out := out || 'cost accounting override C35: denied; '; end;
  execute 'reset role';
  insert into public.batch_output_sku (batch_id, item_code, kg) values (bid2, 'JLB0593', 900);
  perform set_config('request.jwt.claims', '{"email":"t26-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation_run (batch_id, total_cost, total_allocated, status) values (bid2, 1, 1, 'posted'); out := out || 'post costing with output: OK; ';
  exception when others then out := out || 'post costing with output: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t26-inv@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.release_override_policy set allowed_roles = array['inventory_accounting'] where code = 'C26'; get diagnostics n = row_count;
    out := out || 'non-admin edits override policy rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'non-admin edits override policy: denied; '; end;
  begin insert into public.lot_movement (movement_ref, lot_ref, date, type, kg, ref_table, revenue_date, cost_ma_revenue) values ('t26', 'L', '2026-11-03', 'out_sale', -1, 'sales_line', '2026-10-31', -1);
    out := out || 'client writes lot_movement: ALLOWED(!); ';
  exception when others then out := out || 'client writes lot_movement: denied; '; end;
  execute 'reset role';

  -- FINAL of September 2026 is refused while an Aktual batch of the month has no output (C48), whatever the controls say
  insert into public.batch (week_id, date, status, batch_ref) values (wk, '2026-09-30', 'Aktual', 'T26-SEP');
  perform set_config('request.jwt.claims', '{"email":"t26-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_month('2026-09-01', 'FINAL', m, encode(sha256(convert_to(m, 'UTF8')), 'hex'), '2026-09-30', '{}'::jsonb, 'v4-test', null, null); out := out || 'FINAL with C48 batch: ALLOWED(!); ';
  exception when others then out := out || case when sqlerrm like '%C48%' and sqlerrm like '%T26-SEP%' then 'FINAL with C48 batch: rejected; ' else 'FINAL wrong reason(!) ' || sqlerrm || '; ' end; end;
  execute 'reset role';
  raise exception 'RLS-RESULTS v4 irisan 4b (rolled back): %', out;
end $$;

-- v4 irisan 5 (journey B, S5): C38 cannot be bypassed through the API — not by sending the order again with the same
-- approval, not as an Aktual line, not as a spot sale, not by allocating a line priced under the floor; spot (K8) only
-- today, before the cut-off, with spot_enabled, for a "jual hari ini" key, within its free fresh kg, without a PO.
do $$
declare out text := ''; n int; wk uuid; ap uuid; l1 uuid; l2 uuid; t date := (now() at time zone 'Asia/Jakarta')::date; x text;
begin
  insert into public.app_user(email, role) values ('t27-sales@x.test','sales'),('t27-sales2@x.test','sales'),('t27-lead@x.test','commercial_lead'),
    ('t27-fin@x.test','finance'),('t27-ppic@x.test','ppic'),('t27-adm@x.test','admin');
  update public.app_setting set value = '{"enabled": true}' where key = 'm7_approval';
  insert into public.week (week_start, update_date, tb_opening_date) values (t - (extract(isodow from t)::int - 1), t, t - extract(isodow from t)::int)
    on conflict (week_start) do nothing;
  select id into wk from public.week where week_start = t - (extract(isodow from t)::int - 1);
  update public.week set status = 'open' where id = wk;
  insert into public.parameter (week_id) values (wk) on conflict (week_id) do nothing;
  update public.parameter set spot_enabled = true, cut_off_time = '23:59:59' where week_id = wk;
  insert into public.commercial_daily (date, key, form, free_fresh_kg, cost_per_kg_ma, price_floor, price_list, urgency, rank)
    values (t, 'T27-KEY', 'fresh', 480, 29850, 30850, 33000, 'jual_hari_ini', 1) on conflict (date, key) do update set price_floor = excluded.price_floor, urgency = excluded.urgency, free_fresh_kg = excluded.free_fresh_kg;
  insert into public.sales_assignment (sales_rep, email, key) values ('T27', 't27-sales@x.test', 'T27-KEY');

  -- journey B: Sales sees the SKU of the assignment with MA and floor; the order under the floor is refused, the request waits
  perform set_config('request.jwt.claims', '{"email":"t27-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily_sales where key = 'T27-KEY' and date = t and price_floor is not null; out := out || 'sales sees assigned SKU with floor=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price) values (wk, t, 'Order', 'T27-KEY', 'PT Uji', 300, 30000); out := out || 'order under floor: ALLOWED(!); ';
  exception when others then out := out || 'order under floor: rejected (C38); '; end;
  begin insert into public.discount_approval (key, customer, requested_price, floor_price, rp_per_kg_below, kg, total_below, status) values ('T27-KEY', 'PT Uji', 30000, 30850, 850, 300, 255000, 'pending') returning id into ap;
    out := out || 'request pending: OK; ';
  exception when others then out := out || 'request pending: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price, source, document_ref) values (wk, t, 'Aktual', 'T27-KEY', 'PT Uji', 300, 30000, 'Ops', 'SJ-T27'); out := out || 'signed DO (Aktual, Ops) under floor by sales: OK, delivery fact (Q74); ';
  exception when others then out := out || 'signed DO (Aktual, Ops) by sales: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'PT Uji', 100, 30000); out := out || 'spot under floor: ALLOWED(!); ';
  exception when others then out := out || 'spot under floor: rejected; '; end;
  begin update public.discount_approval set status = 'approved' where id = ap; get diagnostics n = row_count; out := out || 'sales approves own rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales approves own: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t27-sales2@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily_sales where key = 'T27-KEY'; out := out || 'sales without assignment sees=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  -- 850 Rp/kg is above the lead's limit: Finance decides
  perform set_config('request.jwt.claims', '{"email":"t27-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.discount_approval set status = 'approved', decided_by = 't27-lead@x.test', decided_at = now() where id = ap; out := out || 'lead approves 850 Rp/kg: ALLOWED(!); ';
  exception when others then out := out || 'lead approves above limit: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t27-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.discount_approval set status = 'approved', decided_by = 't27-fin@x.test', decided_at = now() where id = ap; out := out || 'finance approves: OK; ';
  exception when others then out := out || 'finance approves: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"t27-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price, po_ref) values (wk, t, 'Order', 'T27-KEY', 'PT Uji', 300, 30000, 'PO-T27') returning id into l1; out := out || 'order with approval: OK; ';
  exception when others then out := out || 'order with approval: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price, po_ref) values (wk, t, 'Order', 'T27-KEY', 'PT Uji', 300, 30000, 'PO-T27b'); out := out || 'same approval again: ALLOWED(!); ';
  exception when others then out := out || 'same approval again: rejected; '; end;
  begin update public.sales_line set kg = 400 where id = l1; out := out || 'raise kg beyond approval: ALLOWED(!); ';
  exception when others then out := out || 'raise kg beyond approval: rejected; '; end;
  execute 'reset role';
  select case when sales_line_id = l1 then 'linked' else coalesce(sales_line_id::text, 'free') end into x from public.discount_approval where id = ap;
  out := out || 'approval used by the order=' || x || case when x = 'linked' then '' else '(!)' end || '; ';

  -- a line under the floor written while the guard did not apply (system / flag off) cannot be allocated
  perform set_config('request.jwt.claims', '', true);
  insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price, po_ref) values (wk, t, 'Order', 'T27-KEY', 'PT Lama', 200, 29000, 'PO-T27c') returning id into l2;
  perform set_config('request.jwt.claims', '{"email":"t27-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.allocation (date, sales_line_id, lot_ref, kg) values (t, l2, 'LOT-T27', 100); out := out || 'allocate unapproved line: ALLOWED(!); ';
  exception when others then out := out || case when sqlerrm like 'C38%' then 'allocate unapproved line: rejected (C38); ' else 'allocate unapproved line: rejected (other: ' || sqlerrm || '); ' end; end;
  begin insert into public.allocation (date, sales_line_id, lot_ref, kg) values (t, l1, 'LOT-T27', 100); out := out || 'allocate approved line: OK; ';
  exception when others then out := out || 'allocate approved line: ' || case when sqlerrm like 'C38%' then 'DENIED(!) ' else 'other check: ' end || sqlerrm || '; '; end;
  execute 'reset role';

  -- spot (K8)
  perform set_config('request.jwt.claims', '{"email":"t27-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung A', 100, 31000); out := out || 'spot at floor: OK; ';
  exception when others then out := out || 'spot at floor: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung A', 500, 31000); out := out || 'spot above free fresh: ALLOWED(!); ';
  exception when others then out := out || 'spot above free fresh: rejected; '; end;
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price, po_ref) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung A', 10, 31000, 'PO-X'); out := out || 'spot with PO: ALLOWED(!); ';
  exception when others then out := out || 'spot with PO: rejected; '; end;
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t + 1, 'Order', 'spot', 'T27-KEY', 'Warung A', 10, 31000); out := out || 'spot tomorrow: ALLOWED(!); ';
  exception when others then out := out || 'spot tomorrow: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t27-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung B', 50, 31500); out := out || 'lead records spot: OK; ';
  exception when others then out := out || 'lead records spot: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price, po_ref) values (wk, t, 'Order', 'T27-KEY', 'PT Uji', 10, 31000, 'PO-L'); out := out || 'lead writes a PO line at the floor (as sales, v3): OK; ';
  exception when others then out := out || 'lead writes a PO line: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  update public.commercial_daily set urgency = 'jual_minggu_ini' where date = t and key = 'T27-KEY';
  perform set_config('request.jwt.claims', '{"email":"t27-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung A', 10, 31000); out := out || 'spot not jual hari ini: ALLOWED(!); ';
  exception when others then out := out || 'spot not jual hari ini: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  update public.commercial_daily set urgency = 'jual_hari_ini' where date = t and key = 'T27-KEY';
  update public.parameter set cut_off_time = '00:00:00' where week_id = wk;
  perform set_config('request.jwt.claims', '{"email":"t27-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung A', 10, 31000); out := out || 'spot after cut-off: ALLOWED(!); ';
  exception when others then out := out || 'spot after cut-off: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  update public.parameter set cut_off_time = '23:59:59', spot_enabled = false where week_id = wk;
  perform set_config('request.jwt.claims', '{"email":"t27-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, channel, key_manual, customer, kg, price) values (wk, t, 'Order', 'spot', 'T27-KEY', 'Warung A', 10, 31000); out := out || 'spot disabled: ALLOWED(!); ';
  exception when others then out := out || 'spot disabled: rejected; '; end;
  execute 'reset role';

  -- Accurate actuals are booked facts: Admin may write an Aktual line under the floor
  perform set_config('request.jwt.claims', '{"email":"t27-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, key_manual, customer, kg, price, source) values (wk, t, 'Aktual', 'T27-KEY', 'PT Uji', 5, 29000, 'Accurate'); out := out || 'admin Accurate Aktual under floor: OK; ';
  exception when others then out := out || 'admin Accurate Aktual under floor: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'sales_scorecard_weekly' and column_name = 'kg_spot';
  out := out || 'scorecard kg_spot column=' || n || case when n = 1 then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v4 irisan 5 (rolled back): %', out;
end $$;

-- v5/0 (PRD v5 §5, §5.3, Bab 8): role operations_director, the LB price decision, commitments and their lock, the
-- locked price list, answers to a surplus, size → class map, marts without client writes, seeds and defaults.
do $$
declare out text := ''; n int; c1 uuid; c2 uuid; pw uuid; r text; t date := (now() at time zone 'Asia/Jakarta')::date;
  ws date := (t - (extract(isodow from t)::int - 1)) + 7;
begin
  insert into public.app_user(email, role) values ('t30-od@x.test','operations_director'),('t30-sales@x.test','sales'),('t30-lead@x.test','commercial_lead'),
    ('t30-ppic@x.test','ppic'),('t30-mgmt@x.test','management'),('t30-fin@x.test','finance');
  insert into public.sales_assignment (sales_rep, email, key) values ('T30', 't30-sales@x.test', 'T30-A');
  insert into public.cash_position_daily (date, total_closing) values ('2031-01-01', 1);
  insert into public.lot_revaluation (date, lot_ref, amount) values ('2031-01-01', 'T30-LOT', 1);
  insert into public.plan_week (week_start, head_count) values (ws, 1000) returning id into pw;

  -- the operations director decides the LB price; nobody else does, and a decision is never edited
  perform set_config('request.jwt.claims', '{"email":"t30-od@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.lb_price_decision (date, price, volume_kg_lb, decided_by) values (t, 24600, 18358, 'someone@else'); out := out || 'opsdir decides LB price: OK; ';
  exception when others then out := out || 'opsdir decides LB price: DENIED(!) ' || sqlerrm || '; '; end;
  select decided_by into r from public.lb_price_decision where date = t order by decided_at desc limit 1;
  out := out || 'decider stamped=' || coalesce(r, 'null') || case when r = 't30-od@x.test' then '' else '(!)' end || '; ';
  begin update public.lb_price_decision set price = 1 where date = t; get diagnostics n = row_count; out := out || 'edit decision rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'edit decision: rejected; '; end;
  select count(*) into n from public.cash_position_daily where date = '2031-01-01'; out := out || 'opsdir reads cash=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.sales_commitment (week_start, key, fresh_kg) values (ws, 'T30-A', 1); out := out || 'opsdir writes commitment: ALLOWED(!); ';
  exception when others then out := out || 'opsdir writes commitment: denied; '; end;
  execute 'reset role';
  foreach r in array array['t30-sales@x.test','t30-mgmt@x.test','t30-ppic@x.test'] loop
    perform set_config('request.jwt.claims', json_build_object('email', r, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin insert into public.lb_price_decision (date, price) values (t, 20000); out := out || split_part(r, '@', 1) || ' decides LB price: ALLOWED(!); ';
    exception when others then out := out || split_part(r, '@', 1) || ' decides LB price: denied; '; end;
    execute 'reset role';
  end loop;

  -- K26: Sales drafts for the assigned key only; the commercial lead locks; a locked row is fixed; a new version needs a reason
  perform set_config('request.jwt.claims', '{"email":"t30-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.lb_price_decision; out := out || 'sales reads LB decisions=' || n || case when n = 0 then '' else '(!)' end || '; ';
  begin insert into public.sales_commitment (week_start, key, fresh_kg, frozen_kg, price) values (ws, 'T30-A', 500, 100, 36000) returning id into c1; out := out || 'sales drafts assigned key: OK; ';
  exception when others then out := out || 'sales drafts assigned key: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg) values (ws, 'T30-B', 1); out := out || 'sales drafts unassigned key: ALLOWED(!); ';
  exception when others then out := out || 'sales drafts unassigned key: rejected; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg, status) values (ws, 'T30-A', 1, 'locked'); out := out || 'sales inserts locked: ALLOWED(!); ';
  exception when others then out := out || 'sales inserts locked: rejected; '; end;
  begin update public.sales_commitment set status = 'locked' where id = c1; out := out || 'sales locks: ALLOWED(!); ';
  exception when others then out := out || 'sales locks: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t30-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.sales_commitment set status = 'locked' where id = c1; out := out || 'lead locks: OK; ';
  exception when others then out := out || 'lead locks: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.sales_commitment set fresh_kg = 900 where id = c1; out := out || 'change locked commitment: ALLOWED(!); ';
  exception when others then out := out || 'change locked commitment: rejected; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg) values (ws, 'T30-B', 50); out := out || 'lead drafts any key: OK; ';
  exception when others then out := out || 'lead drafts any key: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select locked_by into r from public.sales_commitment where id = c1; out := out || 'locked_by=' || coalesce(r, 'null') || case when r = 't30-lead@x.test' then '' else '(!)' end || '; ';
  perform set_config('request.jwt.claims', '{"email":"t30-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_commitment (week_start, key, fresh_kg) values (ws, 'T30-A', 600); out := out || 'new version without reason: ALLOWED(!); ';
  exception when others then out := out || 'new version without reason: rejected; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg, reason) values (ws, 'T30-A', 600, 'pelanggan menambah order') returning id into c2; out := out || 'new version with reason: OK; ';
  exception when others then out := out || 'new version with reason: DENIED(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.sales_commitment where key = 'T30-B'; out := out || 'sales sees unassigned commitments=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t30-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.sales_commitment set status = 'locked' where id = c2; out := out || 'lead locks version 2: OK; ';
  exception when others then out := out || 'lead locks version 2: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select string_agg(version || ':' || status, ',' order by version) into r from public.sales_commitment where key = 'T30-A' and week_start = ws;
  out := out || 'versions=' || coalesce(r, 'none') || case when r = '1:superseded,2:locked' then '' else '(!)' end || '; ';

  -- K24: price list by the commercial lead, fixed once locked
  perform set_config('request.jwt.claims', '{"email":"t30-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.price_list_week (week_start, key, price_fresh, price_frozen) values (ws, 'T30-A', 36705, 31658); out := out || 'lead writes price list: OK; ';
  exception when others then out := out || 'lead writes price list: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set locked_at = now() where week_start = ws and key = 'T30-A'; out := out || 'lead locks price list: OK; ';
  exception when others then out := out || 'lead locks price list: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set price_fresh = 1 where week_start = ws and key = 'T30-A'; out := out || 'change locked price list: ALLOWED(!); ';
  exception when others then out := out || 'change locked price list: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t30-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.price_list_week (week_start, key, price_fresh) values (ws, 'T30-C', 1); out := out || 'sales writes price list: ALLOWED(!); ';
  exception when others then out := out || 'sales writes price list: denied; '; end;
  -- §4.6: Sales answer a surplus for their keys
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response, absorb_kg, price) values (pw, 'T30-A', 600, 'absorb', 600, 31000); out := out || 'sales answers surplus: OK; ';
  exception when others then out := out || 'sales answers surplus: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'T30-B', 600, 'reduce'); out := out || 'sales answers unassigned key: ALLOWED(!); ';
  exception when others then out := out || 'sales answers unassigned key: rejected; '; end;
  begin insert into public.size_class_map (size_kg, weight_class, effective_from) values (1.3, 'S', '2026-10-01'); out := out || 'sales maps size: ALLOWED(!); ';
  exception when others then out := out || 'sales maps size: denied; '; end;
  select count(*) into n from public.lot_revaluation; out := out || 'sales reads lot_revaluation=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  -- PPIC maps sizes; marts are not written by clients
  perform set_config('request.jwt.claims', '{"email":"t30-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.size_class_map (size_kg, weight_class, effective_from) values (1.3, 'S', '2026-10-01'); out := out || 'ppic maps size: OK; ';
  exception when others then out := out || 'ppic maps size: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.demand_class_weekly (week_start, ship_date, size_code, weight_class) values (ws, ws, 'Uk 1.3', 'S'); out := out || 'ppic writes demand_class_weekly: ALLOWED(!); ';
  exception when others then out := out || 'ppic writes demand_class_weekly: denied; '; end;
  begin insert into public.plan_week_class (plan_week_id, weight_class, kg_lb) values (pw, 'S', 1000); out := out || 'ppic writes plan_week_class: OK; ';
  exception when others then out := out || 'ppic writes plan_week_class: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t30-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.lot_revaluation; out := out || 'finance reads lot_revaluation=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.input_completeness_daily (date, kind, owner_role, status) values (t, 'costing_wp', 'cost_accounting', 'late'); out := out || 'finance writes completeness: ALLOWED(!); ';
  exception when others then out := out || 'finance writes completeness: denied; '; end;
  begin insert into public.input_task (due_date, rule_kind, ref, status) values (t, 'costing_wp', 'B1', 'passed'); out := out || 'finance ticks a task: ALLOWED(!); ';
  exception when others then out := out || 'finance ticks a task: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- seeds and defaults
  select count(*) into n from public.weight_class where code in ('K','S','B') and avg_kg is null and min_kg is null and note is not null;
  out := out || 'K/S/B seeded empty=' || n || case when n = 3 then '' else '(!)' end || '; ';
  select count(*) into n from public.input_task_rule where kind <> 'po_lines'; out := out || 'task rules=' || n || case when n = 13 then '' else '(!)' end || '; ';  -- §3.1 seed (v5/5 adds po_lines)
  select count(*) into n from public.app_setting where key like 'v5\_%' and (value ->> 'enabled')::boolean = false; out := out || 'v5 flags off=' || n || case when n = 6 then '' else '(!)' end || '; ';
  select count(*) into n from public.parameter where commitment_lock_dow = 5 and commitment_lock_time = '17:00' and wp_due_time = '12:00' and revaluation_sold_mode = 'cogs_line' and cost_anomaly_ratio = 3;
  out := out || 'parameter defaults on existing weeks=' || case when n > 0 then 'yes' else 'no(!)' end || '; ';
  begin insert into public.pl_daily_v4 (date, segment, pl_line, basis, forecast) values ('2031-01-01', 'Umum', 'Beban tetap belum dijurnal', 'fixed_estimate', -1); out := out || 'basis fixed_estimate: OK; ';
  exception when others then out := out || 'basis fixed_estimate: REJECTED(!) ' || sqlerrm || '; '; end;
  select count(*) into n from information_schema.columns where table_schema = 'public' and (
    (table_name = 'item_map' and column_name = 'size_kg') or (table_name = 'sales_line' and column_name in ('size_kg','commitment_id'))
    or (table_name = 'batch' and column_name in ('wp_due_at','wp_received_at','invoice_status')) or (table_name = 'upload' and column_name in ('checks','ok_count','preview_fingerprint'))
    or (table_name in ('lot','sku_balance_daily') and column_name = 'cost_status'));
  out := out || 'v5 columns=' || n || case when n = 11 then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5/0 (rolled back): %', out;
end $$;

-- v5/1 (PRD v5 §4.1, K20–K22, §4.6): the costing columns of the commercial mart and its sales view (a cost per SKU,
-- never per lot), no client writes to them, the WP stamp on a batch, lot_revaluation.sold_by_date.
do $$
declare out text := ''; n int; wk uuid; b1 uuid; b2 uuid; r text; ts timestamptz;
begin
  insert into public.app_user(email, role) values ('t31-ca@x.test','cost_accounting'),('t31-sales@x.test','sales'),('t31-lead@x.test','commercial_lead'),('t31-mgmt@x.test','management');
  insert into public.sales_assignment (sales_rep, email, key) values ('T31', 't31-sales@x.test', 'T31-A');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2031-06-02', '2031-06-05', '2031-05-31') returning id into wk;
  insert into public.batch (week_id, date, status, batch_ref, lb_kg) values (wk, '2031-06-03', 'Aktual', 'T31-B1', 1000) returning id into b1;
  insert into public.batch (week_id, date, status, batch_ref, lb_kg) values (wk, '2031-06-04', 'Aktual', 'T31-B2', 1000) returning id into b2;
  insert into public.commercial_daily (date, key, cost_per_kg, cost_status, cost_check) values ('2031-06-03', 'T31-A', 3176, 'estimasi', false), ('2031-06-03', 'T31-Z', 15299, 'final', true);

  select count(*) into n from information_schema.columns where table_schema = 'public'
    and ((table_name in ('commercial_daily','commercial_daily_sales_v5') and column_name in ('cost_per_kg','cost_status','cost_check')) or (table_name = 'lot_revaluation' and column_name = 'sold_by_date'));
  out := out || 'v5/1 columns=' || n || case when n = 7 then '' else '(!)' end || '; ';
  begin insert into public.commercial_daily (date, key, cost_status) values ('2031-06-03', 'T31-X', 'kira-kira'); out := out || 'unknown cost status: ALLOWED(!); ';
  exception when others then out := out || 'unknown cost status: rejected; '; end;
  out := out || 'clients execute tg_wp_received=' || has_function_privilege('authenticated', 'public.tg_wp_received()', 'execute')::text
    || case when has_function_privilege('authenticated', 'public.tg_wp_received()', 'execute') then '(!)' else '' end || '; ';

  -- sales: the assigned SKU through the view, with its cost status; never the mart itself
  perform set_config('request.jwt.claims', '{"email":"t31-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*), max(cost_status) into n, r from public.commercial_daily_sales_v5 where date = '2031-06-03';
  out := out || 'sales view rows=' || n || ' status=' || coalesce(r, 'null') || case when n = 1 and r = 'estimasi' then '' else '(!)' end || '; ';
  select count(*) into n from public.commercial_daily where date = '2031-06-03'; out := out || 'sales reads mart=' || n || case when n = 0 then '' else '(!)' end || '; ';
  begin insert into public.batch_output_sku (batch_id, item_code, kg) values (b1, 'T31-ITEM', 10); out := out || 'sales uploads WP: ALLOWED(!); ';
  exception when others then out := out || 'sales uploads WP: denied; '; end;
  execute 'reset role';

  -- the commercial lead reads every SKU with its C54 flag and cannot write the mart
  perform set_config('request.jwt.claims', '{"email":"t31-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily where date = '2031-06-03' and cost_check; out := out || 'lead sees C54 rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin update public.commercial_daily set cost_status = 'final' where date = '2031-06-03'; get diagnostics n = row_count; out := out || 'lead edits cost status rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'lead edits cost status: rejected; '; end;
  begin insert into public.commercial_daily (date, key, cost_per_kg) values ('2031-06-04', 'T31-A', 1); out := out || 'lead writes mart: ALLOWED(!); ';
  exception when others then out := out || 'lead writes mart: denied; '; end;
  execute 'reset role';

  -- K21: the WP upload stamps the batch (sementara); a deleted row does not
  perform set_config('request.jwt.claims', '{"email":"t31-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.batch_output_sku (batch_id, item_code, kg) values (b1, 'T31-ITEM', 10); out := out || 'cost accounting uploads WP: OK; ';
  exception when others then out := out || 'cost accounting uploads WP: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.batch_output_sku (batch_id, item_code, kg, deleted_at) values (b2, 'T31-ITEM', 10, now()); out := out || 'deleted WP row: inserted; ';
  exception when others then out := out || 'deleted WP row: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select wp_received_at into ts from public.batch where id = b1; out := out || 'B1 wp_received_at ' || case when ts is null then 'null(!)' else 'set' end || '; ';
  select wp_received_at into ts from public.batch where id = b2; out := out || 'B2 wp_received_at ' || case when ts is null then 'null' else 'set(!)' end || '; ';

  -- management reads lot_revaluation with sold_by_date; sales do not
  insert into public.lot_revaluation (date, lot_ref, key, amount_sold, sold_by_date) values ('2031-06-05', 'T31-LOT', 'T31-A', 1213469, '[{"date":"2031-06-04","kg":"500.00","amount":"1213469.00"}]');
  perform set_config('request.jwt.claims', '{"email":"t31-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.lot_revaluation where lot_ref = 'T31-LOT' and jsonb_array_length(sold_by_date) = 1; out := out || 'management reads revaluation=' || n || case when n = 1 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t31-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.lot_revaluation where lot_ref = 'T31-LOT'; out := out || 'sales reads revaluation=' || n || case when n = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5/1 (rolled back): %', out;
end $$;
-- v5/5 (PRD v5 §4.9, K34, K35): reminders are Finance's and read by every app user, never edited; the K35 override is
-- Finance's only; with v5_input on a red cell of the completeness grid (late, or not due and past its deadline) rejects
-- release_week until a K35 override exists for the week; with the flag off the release is as in v4; the grid is a mart.
do $$
declare out text := ''; n int; wk uuid; r text;
  ok8 text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]}}';
begin
  insert into public.app_user(email, role) values ('t35-fin@x.test','finance'),('t35-ca@x.test','cost_accounting'),('t35-sales@x.test','sales'),('t35-adm@x.test','admin');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2031-07-07', '2031-07-10', '2031-07-06') returning id into wk;
  delete from public.rebuild_queue where date between '2031-07-07' and '2031-07-13';
  insert into public.input_completeness_daily (date, kind, owner_role, status, due_at) values
    ('2031-07-08', 'costing_wp', 'cost_accounting', 'late', '2031-07-08T12:00:00+07'),
    ('2031-07-09', 'gl_daily', 'inventory_accounting', 'passed', '2031-07-09T16:00:00+07');

  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'input_completeness_daily' and column_name = 'due_at';
  out := out || 'grid due_at column=' || n || case when n = 1 then '' else '(!)' end || '; ';
  select count(*) into n from public.input_task_rule where kind = 'po_lines' and owner_role = 'sales' and due_rule = 'cut_date - 1 day 12:00';
  out := out || 'PO task rule=' || n || case when n = 1 then '' else '(!)' end || '; ';
  select count(*) into n from public.release_override_policy where code = 'K35' and allowed_roles = array['finance'];
  out := out || 'K35 policy finance=' || n || case when n = 1 then '' else '(!)' end || '; ';

  -- reminders: Finance sends (stamped as the sender), the cost accountant reads but does not send or edit
  perform set_config('request.jwt.claims', '{"email":"t35-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.input_reminder (date, kind, owner_role, note, sent_by) values ('2031-07-08', 'costing_wp', 'cost_accounting', 'WP batch 8/7', 'orang@lain'); out := out || 'finance reminds: OK; ';
  exception when others then out := out || 'finance reminds: DENIED(!) ' || sqlerrm || '; '; end;
  select sent_by into r from public.input_reminder where date = '2031-07-08' limit 1;
  out := out || 'sender stamped=' || coalesce(r, 'null') || case when r = 't35-fin@x.test' then '' else '(!)' end || '; ';
  begin insert into public.input_completeness_daily (date, kind, owner_role, status) values ('2031-07-10', 'gl_daily', 'inventory_accounting', 'passed'); out := out || 'finance writes grid: ALLOWED(!); ';
  exception when others then out := out || 'finance writes grid: denied; '; end;
  begin update public.input_completeness_daily set status = 'passed' where date = '2031-07-08'; get diagnostics n = row_count; out := out || 'finance turns cell green rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance turns cell green: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"t35-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.input_reminder where owner_role = 'cost_accounting' and date = '2031-07-08'; out := out || 'owner reads reminder=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.input_reminder (date, kind, owner_role) values ('2031-07-08', 'costing_wp', 'cost_accounting'); out := out || 'cost accounting reminds: ALLOWED(!); ';
  exception when others then out := out || 'cost accounting reminds: denied; '; end;
  begin update public.input_reminder set note = 'sudah' where date = '2031-07-08'; get diagnostics n = row_count; out := out || 'edit reminder rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'edit reminder: rejected; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-07-07', 'K35', 'WP masuk sore, angka sudah dicek', 'WP-0708'); out := out || 'cost accounting K35 override: ALLOWED(!); ';
  exception when others then out := out || 'cost accounting K35 override: denied; '; end;
  execute 'reset role';

  -- flag off: the red cell does not hold the release (v4 rule); flag on: rejected until Finance records K35
  perform set_config('request.jwt.claims', '{"email":"t35-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'flag off red cell: released; ';
  exception when others then out := out || 'flag off red cell: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  update public.app_setting set value = '{"enabled": true}' where key = 'v5_input';
  -- a cell built "not due" whose deadline has passed is red as well
  insert into public.input_completeness_daily (date, kind, owner_role, status, due_at) values ('2031-07-10', 'stock_daily', 'inventory_accounting', 'not_due', now() - interval '1 hour');
  perform set_config('request.jwt.claims', '{"email":"t35-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'flag on red cell: RELEASED(!); ';
  exception when others then out := out || 'flag on red cell: rejected (' || case when sqlerrm like '%K35%costing_wp 08/07%stock_daily 10/07%' then 'K35 cells named' else sqlerrm || '(!)' end || '); '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-07-07', 'K35', 'WP masuk sore, angka sudah dicek', 'WP-0708'); out := out || 'finance K35 override: OK; ';
  exception when others then out := out || 'finance K35 override: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(wk, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'flag on with K35 override: released; ';
  exception when others then out := out || 'flag on with K35 override: REJECTED(!) ' || sqlerrm || '; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2031-07-07', 'K36', 'kode yang tidak ada', 'x'); out := out || 'override unknown code: ALLOWED(!); ';
  exception when others then out := out || 'override unknown code: rejected; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5/5 (rolled back): %', out;
end $$;
