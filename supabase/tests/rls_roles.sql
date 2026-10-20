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
  -- K49 (v5.1): Sales write sales_line only within an active assignment; this user sells every customer and key
  insert into public.sales_assignment (sales_rep, email) values ('T', 't-sales@x.test');
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
  -- K49 (v5.1): Sales write sales_line only within an active assignment; this user sells every customer and key
  insert into public.sales_assignment (sales_rep, email) values ('T6', 't6-sales@x.test');
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
  -- K49 (v5.1): Sales write sales_line only within an active assignment; these users sell every customer and key
  insert into public.sales_assignment (sales_rep, email) values ('T21', 't21-sales@x.test');
  insert into public.sales_assignment (sales_rep, email, key) values ('T21B', 't21-sales2@x.test', 'T21B-OTHER');
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
  -- K49 (v5.1): Sales write sales_line (deliveries update it) only within an active assignment
  insert into public.sales_assignment (sales_rep, email) values ('T24', 't24-sales@x.test');
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
  -- v5.2 B-REL-4: a week without a parameter row shows Sales no cost; this week's parameter keeps sales_sees_cost = true (default)
  insert into public.parameter (week_id) values (wk) on conflict (week_id) do nothing;
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

-- v5.1/1 (PRD v5.1 K43–K47, K49, K53; R1–R3, R5, R7, R8, R13, R40 and the schema of K39, K46): the release task is
-- not a grid cell (K44); no grid → no release (K45); C53 of controls_v3 holds the release like a v1 control (K47);
-- assignments and guards on base keys (K43); Sales write PO lines only in their scope (K49); the cost columns of the
-- Sales view follow sales_sees_cost (K53); rebuild triggers on the v5 tables (R13); lock_commitments in one
-- transaction (K46); the admin retires a locked row (R40); advance_update_date (K39).
do $$
declare out text := ''; n int; wk1 uuid; wk2 uuid; wk3 uuid; nx date := '2032-03-22'; r text; d date; x numeric;
  ok8 text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]}}';
  c53 text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]},"controls_v3":[{"code":"C53","status":"BELUM DIISI"},{"code":"C49","status":"BELUM DIISI"}]}';
begin
  insert into public.app_user(email, role) values ('v51-fin@x.test','finance'),('v51-adm@x.test','admin'),('v51-sales@x.test','sales'),
    ('v51-sales0@x.test','sales'),('v51-lead@x.test','commercial_lead'),('v51-ia@x.test','inventory_accounting');
  -- v5.2 O21(b): an assignment covers other forms only without a form suffix, so the base-key commitment below needs the
  -- assignment "RPA|Karkas" (was "RPA|Karkas|Fresh", which now covers that SKU only: block v5.2 B2 O21)
  insert into public.sales_assignment (sales_rep, email, customer, key) values ('V51', 'v51-sales@x.test', 'PT A', 'RPA|Karkas');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2032-03-01', '2032-03-04', '2032-02-29') returning id into wk1;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2032-03-08', '2032-03-10', '2032-03-07') returning id into wk2;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2032-03-15', '2032-03-17', '2032-03-14') returning id into wk3;
  insert into public.parameter (week_id) values (wk3) on conflict (week_id) do nothing;
  update public.parameter set sales_sees_cost = false where week_id = wk3;
  insert into public.sku_price (week_id, key, ref_sell_price) values (wk3, 'RPA|Karkas|Frozen', 21000);
  insert into public.commercial_daily (date, key, cost_per_kg, cost_status, cost_check) values ('2032-03-16', 'RPA|Karkas|Fresh', 30000, 'final', false);
  insert into public.input_completeness_daily (date, kind, owner_role, status, due_at) values
    ('2032-03-02', 'gl_daily', 'inventory_accounting', 'passed', '2032-03-02T16:00:00+07'),
    ('2032-03-03', 'costing_wp', 'cost_accounting', 'passed', '2032-03-03T12:00:00+07'),
    ('2032-03-04', 'release_week', 'finance', 'late', '2032-03-04T17:00:00+07');
  delete from public.rebuild_queue where date between '2032-03-01' and '2032-03-28';

  select count(*) into n from information_schema.columns where table_schema = 'public' and (
    (table_name = 'price_list_week' and column_name in ('deleted_at','deleted_by','price_frozen_source')) or (table_name = 'parameter' and column_name = 'po_unsized_mode'));
  out := out || 'v5.1 columns=' || n || case when n = 4 then '' else '(!)' end || '; ';
  r := public.base_key('RPA|Karkas|Fresh') || ',' || public.base_key('RPA|Karkas') || ',' || public.base_key('X|n/a') || ',' || public.base_key('RPA|Karkas|Frozen');
  out := out || 'base_key=' || r || case when r = 'RPA|Karkas,RPA|Karkas,X,RPA|Karkas' then '' else '(!)' end || '; ';
  select count(*) into n from public.parameter where week_id = wk3 and po_unsized_mode = 'warn'; out := out || 'po_unsized_mode default warn=' || n || case when n = 1 then '' else '(!)' end || '; ';
  out := out || 'clients execute tg_sales_line_scope=' || has_function_privilege('authenticated', 'public.tg_sales_line_scope()', 'execute')::text
    || case when has_function_privilege('authenticated', 'public.tg_sales_line_scope()', 'execute') then '(!)' else '' end || '; ';

  -- K45 / K44: with v5_input on a week without grid is not released; a week whose only red cell is the release task is
  update public.app_setting set value = '{"enabled": true}' where key = 'v5_input';
  perform set_config('request.jwt.claims', '{"email":"v51-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk2, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'K45 no grid: RELEASED(!); ';
  exception when others then out := out || 'K45 no grid: rejected (' || case when sqlerrm like '%grid kelengkapan belum dibangun%' then 'grid belum dibangun' else sqlerrm || '(!)' end || '); '; end;
  begin perform public.release_week(wk1, ok8, encode(sha256(convert_to(ok8, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'K44 only release task red: released; ';
  exception when others then out := out || 'K44 only release task red: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  update public.app_setting set value = '{"enabled": false}' where key = 'v5_input';

  -- K47: C53 BELUM DIISI in controls_v3 holds the release (strict mode); other v3 codes do not; Finance's override lifts it
  update public.app_setting set value = '{"enabled": true}' where key = 'v4_release';
  delete from public.rebuild_queue where date between '2032-03-15' and '2032-03-21';
  perform set_config('request.jwt.claims', '{"email":"v51-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wk3, c53, encode(sha256(convert_to(c53, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'K47 C53 BELUM DIISI: RELEASED(!); ';
  exception when others then out := out || 'K47 C53 BELUM DIISI: rejected (' || case when sqlerrm like '%C53 BELUM DIISI%' and sqlerrm not like '%C49%' then 'C53 only' else sqlerrm || '(!)' end || '); '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"v51-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2032-03-15', 'C53', 'WP batch sudah dicek manual', 'WP-0316'); out := out || 'admin C53 override: ALLOWED(!); ';
  exception when others then out := out || 'admin C53 override: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"v51-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2032-03-15', 'C53', 'WP batch sudah dicek manual', 'WP-0316'); out := out || 'finance C53 override: OK; ';
  exception when others then out := out || 'finance C53 override: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(wk3, c53, encode(sha256(convert_to(c53, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'K47 with C53 override: released; ';
  exception when others then out := out || 'K47 with C53 override: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  update public.app_setting set value = '{"enabled": false}' where key = 'v4_release';

  -- K43 / R5: a Sales user assigned "RPA|Karkas" (v5.2 O21: no form suffix) commits on the base key and reads it back; another key is refused.
  -- R13: the commitment queues a rebuild of its week.
  perform set_config('request.jwt.claims', '{"email":"v51-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_commitment (week_start, key, fresh_kg, price) values (nx, 'RPA|Karkas', 500, 25000); out := out || 'R5 base-key commitment: OK; ';
  exception when others then out := out || 'R5 base-key commitment: DENIED(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.sales_commitment where week_start = nx and key = 'RPA|Karkas'; out := out || 'sales reads it back=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin insert into public.sales_commitment (week_start, key, fresh_kg) values (nx, 'RPA|Kepala', 100); out := out || 'R5 other key: ALLOWED(!); ';
  exception when others then out := out || 'R5 other key: denied; '; end;
  begin perform public.lock_commitments(nx, '{}'::jsonb); out := out || 'sales locks commitments: ALLOWED(!); ';
  exception when others then out := out || 'sales locks commitments: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.rebuild_queue where date = nx and status = 'queued'; out := out || 'R13 commitment queues rebuild=' || n || case when n = 1 then '' else '(!)' end || '; ';

  -- K46: the lead locks the week in one call; the price list gets the fresh price and the frozen reference price
  perform set_config('request.jwt.claims', '{"email":"v51-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments(nx, '{}'::jsonb); out := out || 'lead locks drafts=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'lead locks: DENIED(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.sales_commitment where week_start = nx and key = 'RPA|Karkas' and status = 'locked' and locked_by = 'v51-lead@x.test';
  out := out || 'commitment locked by lead=' || n || case when n = 1 then '' else '(!)' end || '; ';
  select p.price_frozen_source into r from public.price_list_week p where p.week_start = nx and p.key = 'RPA|Karkas';
  select count(*) into n from public.price_list_week p where p.week_start = nx and p.key = 'RPA|Karkas' and p.price_fresh = 25000 and p.price_frozen = 21000 and p.locked_at is not null;
  out := out || 'price list fresh 25000 frozen 21000 from ' || coalesce(r, 'null') || case when n = 1 and r = 'sku_price' then '' else '(!)' end || '; ';
  begin perform public.lock_commitments(nx, '{}'::jsonb); out := out || 'lock without drafts: ACCEPTED(!); ';
  exception when others then out := out || 'lock without drafts: rejected; '; end;
  begin update public.sales_commitment set fresh_kg = 1 where week_start = nx and key = 'RPA|Karkas' and status = 'locked'; get diagnostics n = row_count; out := out || 'lead edits locked rows=' || n || '(!); ';
  exception when others then out := out || 'lead edits locked commitment: rejected; '; end;
  begin update public.price_list_week set price_fresh = 1 where week_start = nx and key = 'RPA|Karkas'; get diagnostics n = row_count; out := out || 'lead edits locked price rows=' || n || '(!); ';
  exception when others then out := out || 'lead edits locked price list: rejected; '; end;
  begin update public.price_list_week set deleted_at = now() where week_start = nx and key = 'RPA|Karkas'; get diagnostics n = row_count; out := out || 'lead retires locked price rows=' || n || '(!); ';
  exception when others then out := out || 'lead retires locked price list: rejected; '; end;
  execute 'reset role';

  -- K46: a new version after the lock without a reason (written before the guard) makes the whole lock fail
  perform set_config('request.jwt.claims', '', true);
  insert into public.sales_commitment (week_start, version, key, fresh_kg, price) values (nx, 2, 'RPA|Karkas', 600, 26000), (nx, 1, 'RPA|Sayap', 50, 30000);
  perform set_config('request.jwt.claims', '{"email":"v51-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.lock_commitments(nx, '{"RPA|Sayap": 28000}'::jsonb); out := out || 'v2 without reason: LOCKED(!); ';
  exception when others then out := out || 'v2 without reason: rejected (' || case when sqlstate = '23514' and sqlerrm like '%RPA|Karkas%' then 'key named' else sqlerrm || '(!)' end || '); '; end;
  execute 'reset role';
  select count(*) into n from public.sales_commitment where week_start = nx and status = 'draft'; out := out || 'drafts left=' || n || case when n = 2 then '' else '(!)' end || '; ';
  select count(*) into n from public.price_list_week where week_start = nx and key = 'RPA|Sayap'; out := out || 'price list untouched=' || case when n = 0 then 'yes' else 'no(!)' end || '; ';
  update public.sales_commitment set reason = 'harga naik minggu depan' where week_start = nx and key = 'RPA|Karkas' and status = 'draft';
  perform set_config('request.jwt.claims', '{"email":"v51-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments(nx, '{"RPA|Sayap": 28000}'::jsonb); out := out || 'with reason locks=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'with reason: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select string_agg(version || ':' || status, ',' order by version) into r from public.sales_commitment where week_start = nx and key = 'RPA|Karkas';
  out := out || 'versions ' || coalesce(r, 'none') || case when r = '1:superseded,2:locked' then '' else '(!)' end || '; ';
  select count(*) into n from public.price_list_week where week_start = nx and key = 'RPA|Sayap' and price_frozen = 28000 and price_frozen_source = 'form';
  out := out || 'frozen price from form=' || n || case when n = 1 then '' else '(!)' end || '; ';
  select count(*) into n from public.price_list_week where week_start = nx and key = 'RPA|Karkas' and price_fresh = 25000; out := out || 'locked price row kept=' || n || case when n = 1 then '' else '(!)' end || '; ';

  -- R40: the admin retires a locked commitment and a locked price-list row; nothing else of them changes
  perform set_config('request.jwt.claims', '{"email":"v51-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.sales_commitment set deleted_at = now(), deleted_by = 'v51-adm@x.test' where week_start = nx and key = 'RPA|Sayap' and status = 'locked'; get diagnostics n = row_count;
    out := out || 'admin retires locked commitment rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin retires locked commitment: REJECTED(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set deleted_at = now(), deleted_by = 'v51-adm@x.test' where week_start = nx and key = 'RPA|Sayap'; get diagnostics n = row_count;
    out := out || 'admin retires locked price rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin retires locked price list: REJECTED(!) ' || sqlerrm || '; '; end;
  begin update public.sales_commitment set fresh_kg = 1 where week_start = nx and key = 'RPA|Karkas' and status = 'locked'; get diagnostics n = row_count; out := out || 'admin edits locked rows=' || n || '(!); ';
  exception when others then out := out || 'admin edits locked commitment: rejected; '; end;
  execute 'reset role';

  -- K49: a Sales user writes PO lines only for an assigned customer and key; a Sales user without assignment writes none
  perform set_config('request.jwt.claims', '{"email":"v51-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wk2, '2032-03-09', 'Order', 'JLB0593', 10, 30000, 'PT A'); out := out || 'K49 assigned customer and key: OK; ';
  exception when others then out := out || 'K49 assigned customer and key: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wk2, '2032-03-09', 'Order', 'JLB0593', 10, 30000, 'PT B'); out := out || 'K49 other customer: ALLOWED(!); ';
  exception when others then out := out || 'K49 other customer: denied; '; end;
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wk2, '2032-03-09', 'Order', 'JLB0092', 10, 30000, 'PT A'); out := out || 'K49 other key: ALLOWED(!); ';
  exception when others then out := out || 'K49 other key: denied; '; end;
  begin update public.sales_line set customer = 'PT B' where week_id = wk2 and customer = 'PT A'; get diagnostics n = row_count; out := out || 'K49 move line to other customer rows=' || n || '(!); ';
  exception when others then out := out || 'K49 move line to other customer: rejected; '; end;
  -- K53: sales_sees_cost = false for the week → the cost columns are empty for Sales
  select count(*), max(cost_per_kg), max(cost_status) into n, x, r from public.commercial_daily_sales_v5 where date = '2032-03-16';
  out := out || 'K53 sales rows=' || n || ' cost=' || coalesce(x::text, 'null') || ' status=' || coalesce(r, 'null') || case when n = 1 and x is null and r is null then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"v51-sales0@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, item_code, kg, price, customer) values (wk2, '2032-03-09', 'Order', 'JLB0593', 10, 30000, 'PT A'); out := out || 'K49 sales without assignment: ALLOWED(!); ';
  exception when others then out := out || 'K49 sales without assignment: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"v51-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select max(cost_per_kg), max(cost_status) into x, r from public.commercial_daily_sales_v5 where date = '2032-03-16';
  out := out || 'K53 admin cost=' || coalesce(x::text, 'null') || case when x = 30000 and r = 'final' then '' else '(!)' end || '; ';
  execute 'reset role';

  -- K39: the upload owners move the update date through the RPC only; never backwards, never outside the week
  perform set_config('request.jwt.claims', '{"email":"v51-ia@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin d := public.advance_update_date(wk2, '2032-03-11'); out := out || 'K39 ia upload 11/03 → ' || to_char(d, 'DD/MM') || case when d = '2032-03-12' then '' else '(!)' end || '; ';
  exception when others then out := out || 'K39 ia: DENIED(!) ' || sqlerrm || '; '; end;
  d := public.advance_update_date(wk2, '2032-03-09'); out := out || 'earlier date keeps ' || to_char(d, 'DD/MM') || case when d = '2032-03-12' then '' else '(!)' end || '; ';
  d := public.advance_update_date(wk2, '2032-03-20'); out := out || 'outside week keeps ' || to_char(d, 'DD/MM') || case when d = '2032-03-12' then '' else '(!)' end || '; ';
  d := public.advance_update_date(wk2, '2032-03-14'); out := out || 'Sunday → ' || to_char(d, 'DD/MM') || case when d = '2032-03-15' then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"v51-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.advance_update_date(wk2, '2032-03-14'); out := out || 'K39 sales: ALLOWED(!); ';
  exception when others then out := out || 'K39 sales: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select update_date into d from public.week where id = wk2; out := out || 'week update_date ' || to_char(d, 'DD/MM') || case when d = '2032-03-15' then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5.1/1 (rolled back): %', out;
end $$;

-- ================================================================================================================
-- v5.2 B2 (docs/PRD-v5.2-B-db.md B-R82–B-R84, B-R94; probes P1–P16 of docs/v5.2/REVIEW-v5.1.md). Same convention as
-- above: results in the final error, (!) = unexpected. Every block is self-contained (own users, weeks, keys) and rolls
-- back. Run against the migrations of origin/main only (without the three v52 files) the blocks of the holes show (!):
-- that is the proof the hole exists (docs/v5.2/b2.md).
-- ================================================================================================================

-- B-R82 (K65): schema_registry and schema_version()
do $$
declare out text := ''; v text; n int; c boolean;
begin
  insert into public.app_user(email, role) values ('b82-fin@x.test','finance'),('b82-adm@x.test','admin');

  perform set_config('request.jwt.claims', '{"email":"b82-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin v := public.schema_version();
    out := out || 'authenticated reads schema_version=' || coalesce(v, 'null') || case when string_to_array(v, '.')::int[] >= array[5,2,2] then '' else '(!)' end || '; ';
  exception when others then out := out || 'authenticated schema_version: ERROR(!) ' || sqlerrm || '; '; end;
  begin select count(*) into n from public.schema_registry;
    out := out || 'finance reads registry rows=' || n || case when n >= 3 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance reads registry: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.schema_registry (version) values ('9.9.9'); out := out || 'finance insert into registry: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'finance insert into registry: denied; ';
            when others then out := out || 'finance insert into registry: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"b82-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.schema_registry (version) values ('9.9.9'); out := out || 'admin insert into registry: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'admin insert into registry: denied; ';
            when others then out := out || 'admin insert into registry: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.schema_registry set bundle_sha256 = 'x'; out := out || 'admin update registry: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'admin update registry: denied; ';
            when others then out := out || 'admin update registry: ERROR(!) ' || sqlerrm || '; '; end;
  begin delete from public.schema_registry; out := out || 'admin delete registry: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'admin delete registry: denied; ';
            when others then out := out || 'admin delete registry: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- a signed-in user who is not an app user reads no row (is_app_user)
  perform set_config('request.jwt.claims', '{"email":"b82-stranger@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*) into n from public.schema_registry; out := out || 'stranger reads registry rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'stranger reads registry: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- never for anon; the service role writes
  begin
    out := out || 'anon: select=' || has_table_privilege('anon', 'public.schema_registry', 'select')::text || ' execute schema_version=' || has_function_privilege('anon', 'public.schema_version()', 'execute')::text
      || case when has_table_privilege('anon', 'public.schema_registry', 'select') or has_function_privilege('anon', 'public.schema_version()', 'execute') then '(!)' else '' end || '; ';
    out := out || 'service_role insert=' || has_table_privilege('service_role', 'public.schema_registry', 'insert')::text
      || case when has_table_privilege('service_role', 'public.schema_registry', 'insert') then '' else '(!)' end || '; ';
  exception when others then out := out || 'privileges: ERROR(!) ' || sqlerrm || '; '; end;

  -- highest version numerically (99.10.0 > 99.9.3), a text row last; SECURITY DEFINER with a fixed search_path. The probe
  -- versions sit above every registered one (v6 registers 6.0.0), so the test does not depend on the latest bundle.
  begin
    insert into public.schema_registry (version, applied_at) values ('99.9.3', now() + interval '1 day'), ('99.10.0', now()), ('beta', now() + interval '2 days');
    v := public.schema_version(); out := out || 'highest=' || coalesce(v, 'null') || case when v = '99.10.0' then '' else '(!)' end || '; ';
    select p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x = 'search_path=""') into c from pg_proc p where p.oid = 'public.schema_version()'::regprocedure;
    out := out || 'definer with search_path=""=' || coalesce(c::text, 'null') || case when c then '' else '(!)' end || '; ';
    select count(*) into n from public.schema_registry where version = '5.1.0';
    out := out || 'v5.1 recorded as 5.1.0=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'ordering: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B2 B-R82 (rolled back): %', out;
end $$;

-- B-R83 A-REL-1 / K69 (probes P8, P8b): week.update_date changes only while the week is open, by Admin / Finance, or
-- forward through advance_update_date; Sales and the other daily roles are refused, also on released and closed weeks
do $$
declare out text := ''; n int; i int; e text; d date; wo uuid; wr uuid; wc uuid; roles text[] := array['sales','ppic','purch','lead','ca','ia'];
begin
  insert into public.app_user(email, role) values ('b69-sales@x.test','sales'),('b69-ppic@x.test','ppic'),('b69-purch@x.test','purchasing'),
    ('b69-lead@x.test','commercial_lead'),('b69-ca@x.test','cost_accounting'),('b69-ia@x.test','inventory_accounting'),
    ('b69-fin@x.test','finance'),('b69-adm@x.test','admin');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2033-03-07', '2033-03-10', '2033-03-05') returning id into wo;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2033-03-14', '2033-03-17', '2033-03-12', 'released') returning id into wr;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2033-03-21', '2033-03-24', '2033-03-19', 'closed') returning id into wc;
  delete from public.rebuild_queue where date between '2033-03-07' and '2033-03-27';

  -- P8: none of the daily roles moves update_date of an open week by a direct update
  i := 0;
  foreach e in array roles loop
    i := i + 1;
    perform set_config('request.jwt.claims', format('{"email":"b69-%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    -- a different date each time, never the current one (the week starts 07/03, its update date is 10/03; the check allows up to 14/03)
    begin update public.week set update_date = '2033-03-07'::date + case when i < 3 then i else i + 1 end where id = wo; get diagnostics n = row_count;
      out := out || 'P8 ' || e || ' moves update_date of an open week: ALLOWED rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || 'P8 ' || e || ' update_date open week: denied; ';
              when others then out := out || 'P8 ' || e || ' update_date open week: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  -- P8b: nor on a released or a closed week
  perform set_config('request.jwt.claims', '{"email":"b69-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.week set update_date = update_date - 3 where id = wr; get diagnostics n = row_count; out := out || 'P8b sales moves update_date of a released week: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P8b sales update_date released week: denied; ';
            when others then out := out || 'P8b sales update_date released week: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.week set update_date = update_date + 3 where id = wc; get diagnostics n = row_count; out := out || 'P8b sales moves update_date of a closed week: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P8b sales update_date closed week: denied; ';
            when others then out := out || 'P8b sales update_date closed week: ERROR(!) ' || sqlerrm || '; '; end;
  -- other columns of week stay closed to Sales as before
  begin update public.week set note = 'x' where id = wo; get diagnostics n = row_count; out := out || 'sales note: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'sales week note: denied; ';
            when others then out := out || 'sales week note: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- the same through the RPC: advance_update_date works for the upload owners, forward and inside the week only, open weeks only
  perform set_config('request.jwt.claims', '{"email":"b69-ia@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin d := public.advance_update_date(wo, '2033-03-11'); out := out || 'ia advance_update_date → ' || to_char(d, 'DD/MM') || case when d = '2033-03-12' then '' else '(!)' end || '; ';
  exception when others then out := out || 'ia advance_update_date: ERROR(!) ' || sqlerrm || '; '; end;
  begin d := public.advance_update_date(wo, '2033-03-08'); out := out || 'earlier date keeps ' || to_char(d, 'DD/MM') || case when d = '2033-03-12' then '' else '(!)' end || '; ';
  exception when others then out := out || 'earlier date: ERROR(!) ' || sqlerrm || '; '; end;
  begin d := public.advance_update_date(wr, '2033-03-16'); out := out || 'released week keeps ' || to_char(d, 'DD/MM') || case when d = '2033-03-17' then '' else '(!)' end || '; ';
  exception when others then out := out || 'released week: ERROR(!) ' || sqlerrm || '; '; end;
  -- a client cannot lean on the GUC of the RPC: backwards and beyond the Monday after the week are refused, also for Sales
  begin perform set_config('kgr.advance', 'on', true); update public.week set update_date = '2033-03-09' where id = wo; get diagnostics n = row_count;
    out := out || 'ia with forged GUC moves back: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'ia with forged GUC moves back: denied; ';
            when others then out := out || 'ia forged GUC back: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform set_config('kgr.advance', 'on', true); update public.week set update_date = '2033-03-20' where id = wo; get diagnostics n = row_count;
    out := out || 'ia with forged GUC beyond the next Monday: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'ia with forged GUC beyond the next Monday: denied; ';
            when others then out := out || 'ia forged GUC beyond: ERROR(!) ' || sqlerrm || '; '; end;
  perform set_config('kgr.advance', 'off', true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b69-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform set_config('kgr.advance', 'on', true); update public.week set update_date = '2033-03-13' where id = wo; get diagnostics n = row_count;
    out := out || 'sales with forged GUC: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'sales with forged GUC: denied; ';
            when others then out := out || 'sales forged GUC: ERROR(!) ' || sqlerrm || '; '; end;
  perform set_config('kgr.advance', 'off', true);
  begin perform public.advance_update_date(wo, '2033-03-12'); out := out || 'sales advance_update_date: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales advance_update_date: denied; ';
            when others then out := out || 'sales advance_update_date: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- Finance and Admin move it forward or back on an open week (audit_log keeps old and new); not on released / closed weeks
  perform set_config('request.jwt.claims', '{"email":"b69-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.week set update_date = '2033-03-09' where id = wo; get diagnostics n = row_count; out := out || 'finance moves back on open week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance moves back on open week: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.week set update_date = '2033-03-20' where id = wr; get diagnostics n = row_count; out := out || 'finance moves update_date of a released week: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'finance update_date released week: denied; ';
            when others then out := out || 'finance update_date released week: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.week set status = 'released' where id = wo; get diagnostics n = row_count; out := out || 'finance opens→released status rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance status: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.week set status = 'open' where id = wo; get diagnostics n = row_count; out := out || 'finance released→open status rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance status back: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b69-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.week set update_date = '2033-03-11' where id = wo; get diagnostics n = row_count; out := out || 'admin moves forward on open week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin moves forward on open week: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.week set update_date = '2033-03-26' where id = wc; get diagnostics n = row_count; out := out || 'admin moves update_date of a closed week: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin update_date closed week: denied; ';
            when others then out := out || 'admin update_date closed week: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.week set status = 'open' where id = wr; get diagnostics n = row_count; out := out || 'admin reopens a released week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin reopen: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.week set update_date = '2033-03-18' where id = wr; get diagnostics n = row_count; out := out || 'admin moves update_date once reopened rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin moves update_date once reopened: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.audit_log where table_name = 'week' and row_id in (wo::text, wr::text) and changes ? 'update_date' and actor in ('b69-fin@x.test', 'b69-adm@x.test');
  out := out || 'audit rows of update_date by finance / admin=' || n || case when n = 3 then '' else '(!)' end || '; ';
  select update_date into d from public.week where id = wo; out := out || 'open week update_date ' || to_char(d, 'DD/MM') || case when d = '2033-03-11' then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-1 K69 (rolled back): %', out;
end $$;

-- B-R83 A-REL-2 / B-REL-4 (probe P7): Sales read no cost-derived column of the two commercial views (cost_per_kg_ma,
-- price_floor, margin_*, and the v5 cost) when the week's sales_sees_cost is false, and none when the week has no
-- parameter row; the column lists stay as they were; rpc floor_of does not hand the floor to clients
do $$
declare out text := ''; n int; r record; cols text; fl numeric;
  cols_v4 text := 'date:date, key:text, group_code:text, form:text, free_fresh_kg:numeric(12,2), free_frozen_kg:numeric(12,2), oldest_age_days:integer(32,0), hours_to_cutoff:integer(32,0), cost_per_kg_ma:numeric(18,4), price_floor:numeric(18,4), price_list:numeric(18,4), margin_per_kg_list:numeric(18,4), realized_price_7d:numeric(18,4), margin_per_kg_realized:numeric(18,4), holding_loss_per_day:numeric(18,2), downgrade_risk_rp:numeric(18,2), urgency:text, priority_score:numeric(18,2), rank:integer(32,0), ordered_today_kg:numeric(12,2)';
  cols_v5 text;
  v text;
begin
  cols_v5 := cols_v4 || ', cost_per_kg:numeric(18,4), cost_status:text, cost_check:boolean';
  insert into public.app_user(email, role) values ('b7-sales@x.test','sales'),('b7-sales2@x.test','sales'),('b7-mgmt@x.test','management'),('b7-adm@x.test','admin');
  insert into public.sales_assignment (sales_rep, email, key) values ('B7', 'b7-sales@x.test', 'B7-A'), ('B7b', 'b7-sales2@x.test', 'B7-A');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2033-05-02', '2033-05-05', '2033-04-30'), ('2033-05-09', '2033-05-12', '2033-05-07');
  insert into public.parameter (week_id, sales_sees_cost) select id, false from public.week where week_start = '2033-05-02' on conflict (week_id) do update set sales_sees_cost = false;
  insert into public.parameter (week_id, sales_sees_cost) select id, true from public.week where week_start = '2033-05-09' on conflict (week_id) do update set sales_sees_cost = true;
  -- week 2033-05-02: sales_sees_cost = false; week 2033-05-09: true; week 2033-05-16: no week row at all; week of 2033-05-23: week without parameter row
  insert into public.week (week_start, update_date, tb_opening_date) values ('2033-05-23', '2033-05-26', '2033-05-21');
  delete from public.parameter p using public.week w where p.week_id = w.id and w.week_start = '2033-05-23';
  insert into public.commercial_daily (date, key, group_code, free_fresh_kg, cost_per_kg_ma, cost_per_kg_si, price_floor, price_list, margin_per_kg_list, realized_price_7d, margin_per_kg_realized,
                                       holding_loss_per_day, downgrade_risk_rp, cost_per_kg, cost_status, cost_check)
  values ('2033-05-03', 'B7-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 100, 200, 20900, 'final', true),
         ('2033-05-10', 'B7-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 100, 200, 20900, 'final', true),
         ('2033-05-17', 'B7-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 100, 200, 20900, 'final', true),
         ('2033-05-24', 'B7-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 100, 200, 20900, 'final', true),
         ('2033-05-03', 'B7-Z', 'G', 10, 31000, 31100, 33000, 36000, 5000, 35500, 4500, 100, 200, 30900, 'final', true);

  perform set_config('request.jwt.claims', '{"email":"b7-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  -- sales_sees_cost = false: v4 view and v5 view
  begin
    select count(*) as n, count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) as shown
      into r from public.commercial_daily_sales where date = '2033-05-03';
    out := out || 'P7 v4 view sales_sees_cost=false rows=' || r.n || ' cost columns shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'P7 v4 view: ERROR(!) ' || sqlerrm || '; '; end;
  begin
    select count(*) as n, count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) + count(cost_per_kg) + count(cost_status) + count(cost_check) as shown,
           max(price_list) as pl, max(realized_price_7d) as rp, max(ordered_today_kg) as ot
      into r from public.commercial_daily_sales_v5 where date = '2033-05-03';
    out := out || 'P7 v5 view sales_sees_cost=false rows=' || r.n || ' cost columns shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end
      || '; list price and realized price stay=' || coalesce(r.pl::text, 'null') || '/' || coalesce(r.rp::text, 'null') || case when r.pl = 26000 and r.rp = 25500 then '' else '(!)' end || '; ';
  exception when others then out := out || 'P7 v5 view: ERROR(!) ' || sqlerrm || '; '; end;
  -- sales_sees_cost = true: the values are there
  begin
    select count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) + count(cost_per_kg) as shown into r from public.commercial_daily_sales_v5 where date = '2033-05-10';
    out := out || 'v5 view sales_sees_cost=true cost columns shown=' || r.shown || case when r.shown = 5 then '' else '(!)' end || '; ';
    select count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) as shown into r from public.commercial_daily_sales where date = '2033-05-10';
    out := out || 'v4 view sales_sees_cost=true cost columns shown=' || r.shown || case when r.shown = 4 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sees_cost=true: ERROR(!) ' || sqlerrm || '; '; end;
  -- B-REL-4: no parameter row for the week (or no week) → hidden
  begin
    select count(*) as n, count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) + count(cost_per_kg) + count(cost_status) + count(cost_check) as shown
      into r from public.commercial_daily_sales_v5 where date = '2033-05-24';
    out := out || 'P7 v5 view week without parameter row rows=' || r.n || ' cost columns shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
    select count(*) as n, count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) as shown into r from public.commercial_daily_sales where date = '2033-05-24';
    out := out || 'P7 v4 view week without parameter row cost columns shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
    select count(*) as n, count(cost_per_kg_ma) + count(price_floor) as shown into r from public.commercial_daily_sales_v5 where date = '2033-05-17';
    out := out || 'P7 v5 view date without a week cost columns shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'B-REL-4: ERROR(!) ' || sqlerrm || '; '; end;
  -- the other SKU is not in the view (assignment); the table itself is closed to Sales
  begin select count(*) into n from public.commercial_daily_sales_v5 where key = 'B7-Z'; out := out || 'unassigned SKU rows=' || n || case when n = 0 then '' else '(!)' end || '; '; exception when others then out := out || 'unassigned SKU: ERROR(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.commercial_daily; out := out || 'sales reads table commercial_daily rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  -- rpc floor_of is not a back door to price_floor
  begin fl := public.floor_of('B7-A', '2033-05-03'); out := out || 'P7 sales rpc floor_of: ALLOWED floor=' || coalesce(fl::text, 'null') || '(!); ';
  exception when insufficient_privilege then out := out || 'sales rpc floor_of: denied; ';
            when others then out := out || 'sales rpc floor_of: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- management and admin see everything, in both views, whatever sales_sees_cost says
  foreach v in array array['b7-mgmt','b7-adm'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', v), true);
    execute 'set local role authenticated';
    select count(cost_per_kg_ma) + count(price_floor) + count(margin_per_kg_list) + count(margin_per_kg_realized) + count(cost_per_kg) as shown, count(*) as n into r
      from public.commercial_daily_sales_v5 where date in ('2033-05-03', '2033-05-24') and key = 'B7-A';
    out := out || v || ' v5 view cost columns shown=' || r.shown || case when r.n = 2 and r.shown = 10 then '' else '(!)' end || '; ';
    select count(*) into n from public.commercial_daily_sales where date = '2033-05-03'; out := out || v || ' v4 view rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
    execute 'reset role';
  end loop;
  -- a second rep on the same SKU: same rule; floor_of still works inside the C38 triggers (owner), not for the service role revoke
  perform set_config('request.jwt.claims', '', true);
  out := out || 'owner floor_of=' || coalesce(public.floor_of('B7-A', '2033-05-03')::text, 'null') || case when public.floor_of('B7-A', '2033-05-03') = 23000 then '' else '(!)' end || '; ';

  -- the column lists (names, order, types) are those of origin/main (docs/v5.2/bukti/b2-views.txt has the \d+ of both)
  select string_agg(column_name || ':' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales';
  out := out || 'v4 view columns unchanged=' || (cols = cols_v4)::text || case when cols = cols_v4 then '' else '(!)' end || '; ';
  select string_agg(column_name || ':' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales_v5';
  out := out || 'v5 view columns unchanged=' || (cols = cols_v5)::text || case when cols = cols_v5 then '' else '(!)' end || '; ';
  out := out || 'anon on views: v4=' || has_table_privilege('anon', 'public.commercial_daily_sales', 'select')::text || ' v5=' || has_table_privilege('anon', 'public.commercial_daily_sales_v5', 'select')::text
    || case when has_table_privilege('anon', 'public.commercial_daily_sales', 'select') or has_table_privilege('anon', 'public.commercial_daily_sales_v5', 'select') then '(!)' else '' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-2 B-REL-4 P7 (rolled back): %', out;
end $$;

-- B-R83 A-REL-3 (probe P1): Sales do not read plan_week_class and demand_class_weekly, and read surplus answers of their
-- assigned keys only; the surplus of their keys comes through surplus_for_sales_v52 (limited columns)
do $$
declare out text := ''; n int; pw uuid; r record; e text; cols text;
begin
  insert into public.app_user(email, role) values ('b1-sales@x.test','sales'),('b1-lead@x.test','commercial_lead'),('b1-ppic@x.test','ppic'),
    ('b1-mgmt@x.test','management'),('b1-fin@x.test','finance'),('b1-adm@x.test','admin');
  insert into public.sales_assignment (sales_rep, email, key) values ('B1', 'b1-sales@x.test', 'RPA|Karkas');
  insert into public.plan_week (week_start, version, head_count, surplus_kg_by_key) values ('2033-06-06', 1, 1000, '{"RPA|Karkas|Fresh": 150.5, "Trading|BLP|Frozen": 700}'::jsonb) returning id into pw;
  insert into public.plan_week_class (plan_week_id, weight_class, kg_lb, heads, fresh_kg_by_key, frozen_kg_by_key) values (pw, 'K', 5000, 1000, '{"Trading|BLP|Frozen": 100}'::jsonb, '{}'::jsonb);
  insert into public.demand_class_weekly (week_start, ship_date, size_code, size_kg, weight_class, net_kg, kg_lb, heads) values ('2033-06-06', '2033-06-08', '1.2', 1.2, 'K', 1000, 1500, 600);
  -- answers written as the lead (and one for an own key of the Sales user)
  perform set_config('request.jwt.claims', '{"email":"b1-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'RPA|Karkas|Fresh', 150.5, 'absorb'), (pw, 'Trading|BLP|Frozen', 700, 'reduce');
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"b1-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.plan_week_class; out := out || 'P1 sales reads plan_week_class rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.demand_class_weekly; out := out || 'P1 sales reads demand_class_weekly rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.surplus_response where key = 'Trading|BLP|Frozen'; out := out || 'P1 sales reads surplus answer of an unassigned key rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.surplus_response where key = 'RPA|Karkas|Fresh'; out := out || 'sales reads surplus answer of an assigned key rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  begin
    select count(*) as n, min(key) as k, max(plan_surplus_kg) as kg, max(response) as resp into r from public.surplus_for_sales_v52;
    out := out || 'surplus_for_sales_v52 rows=' || r.n || ' key=' || coalesce(r.k, 'null') || ' plan surplus=' || coalesce(r.kg::text, 'null') || ' answer=' || coalesce(r.resp, 'null')
      || case when r.n = 1 and r.k = 'RPA|Karkas|Fresh' and r.kg = 150.50 and r.resp = 'absorb' then '' else '(!)' end || '; ';
  exception when others then out := out || 'surplus_for_sales_v52: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- everybody else reads as before: the planners, management, finance, the lead, admin
  foreach e in array array['b1-lead','b1-ppic','b1-mgmt','b1-fin','b1-adm'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    select count(*) into n from public.plan_week_class; out := out || e || ' reads plan_week_class rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select count(*) into n from public.demand_class_weekly; out := out || e || ' demand_class_weekly rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select count(*) into n from public.surplus_response; out := out || e || ' surplus answers rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
    begin select count(*) into n from public.surplus_for_sales_v52; out := out || e || ' surplus_for_sales_v52 rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
    exception when others then out := out || e || ' surplus_for_sales_v52: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);

  begin select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'surplus_for_sales_v52';
    out := out || 'surplus_for_sales_v52 columns=' || coalesce(cols, 'null')
      || case when cols = 'week_start,plan_version,plan_week_id,key,plan_surplus_kg,answered_surplus_kg,response,absorb_kg,price,responded_by,responded_at' then '' else '(!)' end || '; ';
    out := out || 'anon on surplus_for_sales_v52=' || has_table_privilege('anon', 'public.surplus_for_sales_v52', 'select')::text
      || case when has_table_privilege('anon', 'public.surplus_for_sales_v52', 'select') then '(!)' else '' end || '; ';
  exception when others then out := out || 'surplus_for_sales_v52 columns: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-3 P1 (rolled back): %', out;
end $$;

-- B-R83 A-REL-4 (probe P10): a Sales user cannot take over, blank out or retire another rep's PO line; the line as it was
-- (OLD) must be in scope as well as the line as it becomes (NEW); a line without customer only as a new spot sale
do $$
declare out text := ''; n int; wk uuid; la uuid; lb uuid; lb1 uuid; lb2 uuid; lb3 uuid; lb4 uuid; lc uuid; lc2 uuid; ld uuid; ok boolean;
begin
  insert into public.app_user(email, role) values ('b10-s1@x.test','sales'),('b10-s2@x.test','sales'),('b10-s3@x.test','sales'),('b10-adm@x.test','admin');
  insert into public.sales_assignment (sales_rep, email, customer, key) values ('B10a', 'b10-s1@x.test', 'PT A', null), ('B10b', 'b10-s2@x.test', 'PT B', null),
    ('B10c', 'b10-s3@x.test', null, 'B10-K1');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2033-07-04', '2033-07-07', '2033-07-02') returning id into wk;
  -- the lines as the system wrote them (an upload): rep A's PO, rep B's PO, a line without customer, a line of key K2
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT A', 'B10-K1', 100, 30000, 'po') returning id into la;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT B', 'B10-K1', 100, 30000, 'po') returning id into lb;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT B', 'B10-K1', 100, 30000, 'po') returning id into lb1;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT B', 'B10-K1', 100, 30000, 'po') returning id into lb2;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT B', 'B10-K1', 100, 30000, 'po') returning id into lb3;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT B', 'B10-K1', 100, 30000, 'po') returning id into lb4;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', null, 'B10-K1', 100, 30000, 'po') returning id into lc;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', null, 'B10-K1', 100, 30000, 'po') returning id into lc2;
  insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price, channel) values (wk, '2033-07-05', 'Order', 'PT C', 'B10-K2', 100, 30000, 'po') returning id into ld;

  perform set_config('request.jwt.claims', '{"email":"b10-s1@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  -- P10: rep A blanks out / takes over / retires the PO of rep B
  begin update public.sales_line set customer = null where id = lb1; get diagnostics n = row_count; out := out || 'P10 A blanks customer of B''s PO: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P10 A blanks customer of B''s PO: denied; '; when others then out := out || 'P10 blank: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set customer = 'PT A' where id = lb2; get diagnostics n = row_count; out := out || 'P10 A takes over B''s PO: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P10 A takes over B''s PO: denied; '; when others then out := out || 'P10 take over: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set deleted_at = now(), deleted_by = 'b10-s1@x.test' where id = lb3; get diagnostics n = row_count; out := out || 'P10 A retires B''s PO: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P10 A retires B''s PO: denied; '; when others then out := out || 'P10 retire: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set kg = 1 where id = lb4; get diagnostics n = row_count; out := out || 'A changes kg of B''s PO: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'A changes kg of B''s PO: denied; '; when others then out := out || 'kg: ERROR(!) ' || sqlerrm || '; '; end;
  -- a line without a customer is nobody's: not retired, not claimed, by a rep bound to a customer
  begin update public.sales_line set deleted_at = now(), deleted_by = 'b10-s1@x.test' where id = lc; get diagnostics n = row_count; out := out || 'P10 A retires a line without customer: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P10 A retires a line without customer: denied; '; when others then out := out || 'retire null: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set customer = 'PT A' where id = lc2; get diagnostics n = row_count; out := out || 'A claims a line without customer: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'A claims a line without customer: denied; '; when others then out := out || 'claim: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price) values (wk, '2033-07-06', 'Order', null, 'B10-K1', 5, 30000); out := out || 'A inserts a PO line without customer: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'A inserts a PO line without customer: denied; '; when others then out := out || 'insert null: ERROR(!) ' || sqlerrm || '; '; end;
  -- own line: change and retire stay possible; a new line for PT A and K1 as before
  begin update public.sales_line set kg = 90 where id = la; get diagnostics n = row_count; out := out || 'A changes own PO rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'A changes own PO: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price) values (wk, '2033-07-06', 'Order', 'PT A', 'B10-K2', 5, 30000); out := out || 'A inserts a PO for PT A: OK; ';
  exception when others then out := out || 'A inserts a PO for PT A: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set deleted_at = now(), deleted_by = 'b10-s1@x.test' where id = la; get diagnostics n = row_count; out := out || 'A retires own PO rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'A retires own PO: DENIED(!) ' || sqlerrm || '; '; end;
  -- the function itself: a spot sale without customer is in scope of a customer-bound rep, a PO line is not
  execute 'reset role';
  begin
    ok := public.sales_line_in_scope(null, 'B10-K1', true); out := out || 'new spot sale without customer in scope=' || ok::text || case when ok then '' else '(!)' end || '; ';
    ok := public.sales_line_in_scope(null, 'B10-K1', false); out := out || 'other change without customer in scope=' || ok::text || case when not ok then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales_line_in_scope: ERROR(!) ' || sqlerrm || '; '; end;
  -- rep C: key-bound, every customer: the line of another key by update is refused (before and after)
  perform set_config('request.jwt.claims', '{"email":"b10-s3@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.sales_line set customer = 'PT C2' where id = ld; get diagnostics n = row_count; out := out || 'C edits a line of another key: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'C edits a line of another key: denied; '; when others then out := out || 'C key: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set key_manual = 'B10-K2' where id = lb; get diagnostics n = row_count; out := out || 'C moves a K1 line to K2: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'C moves a K1 line to K2: denied; '; when others then out := out || 'C move: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.sales_line set kg = 77 where id = lb; get diagnostics n = row_count; out := out || 'C edits a K1 line of any customer rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'C edits a K1 line: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  -- admin is not restricted
  perform set_config('request.jwt.claims', '{"email":"b10-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.sales_line set customer = 'PT Z' where id = lb; get diagnostics n = row_count; out := out || 'admin edits any line rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin edits: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    out := out || 'clients execute sales_line_in_scope=' || has_function_privilege('authenticated', 'public.sales_line_in_scope(text,text,boolean)', 'execute')::text
      || case when has_function_privilege('authenticated', 'public.sales_line_in_scope(text,text,boolean)', 'execute') then '(!)' else '' end || '; ';
  exception when others then out := out || 'sales_line_in_scope privileges: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-4 P10 (rolled back): %', out;
end $$;

-- B-R83 A-REL-7 (probe P13): a Sales user does not overwrite another's surplus answer; responded_by / responded_at are
-- stamped on every write (insert and update) with the signed-in user
do $$
declare out text := ''; n int; pw uuid; r1 uuid; r2 uuid; r3 uuid; who text; t0 timestamptz;
begin
  insert into public.app_user(email, role) values ('b13-s1@x.test','sales'),('b13-s2@x.test','sales'),('b13-s3@x.test','sales'),('b13-lead@x.test','commercial_lead'),('b13-adm@x.test','admin');
  insert into public.sales_assignment (sales_rep, email, key) values ('B13a', 'b13-s1@x.test', 'B13|Karkas'), ('B13b', 'b13-s2@x.test', 'B13|Karkas'), ('B13c', 'b13-s3@x.test', 'B13|Kepala');
  insert into public.plan_week (week_start, version, head_count, surplus_kg_by_key) values ('2033-08-01', 1, 1000, '{"B13|Karkas|Fresh": 100}'::jsonb) returning id into pw;

  -- the lead's answer
  perform set_config('request.jwt.claims', '{"email":"b13-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  insert into public.surplus_response (plan_week_id, key, surplus_kg, response, responded_by) values (pw, 'B13|Karkas|Fresh', 100, 'reduce', 'someone.else@x.test') returning id into r1;
  select responded_by into who from public.surplus_response where id = r1; out := out || 'lead insert stamps responded_by=' || coalesce(who, 'null') || case when who = 'b13-lead@x.test' then '' else '(!)' end || '; ';
  execute 'reset role';

  -- P13: Sales A (assigned) overwrites the lead's answer
  perform set_config('request.jwt.claims', '{"email":"b13-s1@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.surplus_response set response = 'absorb', absorb_kg = 100 where id = r1; get diagnostics n = row_count;
    out := out || 'P13 sales overwrites the lead''s answer: rows=' || n || case when n = 0 then ' (refused)' else '(!)' end || '; ';
  exception when insufficient_privilege then out := out || 'P13 sales overwrites the lead''s answer: denied; ';
            when others then out := out || 'P13 overwrite: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.surplus_response set deleted_at = now() where id = r1; get diagnostics n = row_count;
    out := out || 'sales retires the lead''s answer: rows=' || n || case when n = 0 then ' (refused)' else '(!)' end || '; ';
  exception when insufficient_privilege then out := out || 'sales retires the lead''s answer: denied; ';
            when others then out := out || 'retire: ERROR(!) ' || sqlerrm || '; '; end;
  -- an answer of their own: written with a forged responder, stamped with the real one
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response, responded_by, responded_at) values (pw, 'B13|Karkas|Fresh', 100, 'absorb', 'b13-lead@x.test', '2020-01-01') returning id into r2;
    select responded_by, responded_at into who, t0 from public.surplus_response where id = r2;
    out := out || 'sales insert stamps responded_by=' || coalesce(who, 'null') || case when who = 'b13-s1@x.test' and t0 > now() - interval '1 hour' then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales insert own answer: DENIED(!) ' || sqlerrm || '; '; end;
  -- updating the own answer works and keeps the stamp true even when the update names someone else
  begin update public.surplus_response set absorb_kg = 80, responded_by = 'b13-lead@x.test', responded_at = '2020-01-01' where id = r2; get diagnostics n = row_count;
    select responded_by, responded_at into who, t0 from public.surplus_response where id = r2;
    out := out || 'sales updates own answer rows=' || n || ' responded_by=' || coalesce(who, 'null') || case when n = 1 and who = 'b13-s1@x.test' and t0 > now() - interval '1 hour' then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales updates own answer: DENIED(!) ' || sqlerrm || '; '; end;
  -- an unassigned key
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'B13|Kepala|Fresh', 10, 'absorb'); out := out || 'sales answers an unassigned key: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales answers an unassigned key: denied; ';
            when others then out := out || 'unassigned key: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- Sales B (same key) cannot overwrite A's answer either
  perform set_config('request.jwt.claims', '{"email":"b13-s2@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.surplus_response set response = 'reduce', absorb_kg = 0 where id = r2; get diagnostics n = row_count;
    out := out || 'P13 sales B overwrites sales A''s answer: rows=' || n || case when n = 0 then ' (refused)' else '(!)' end || '; ';
  exception when insufficient_privilege then out := out || 'P13 sales B overwrites sales A''s answer: denied; ';
            when others then out := out || 'B overwrite: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'B13|Karkas|Fresh', 100, 'partial') returning id into r3; out := out || 'sales B adds an own (newer) answer: OK; ';
  exception when others then out := out || 'sales B adds an own answer: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select absorb_kg, responded_by into n, who from public.surplus_response where id = r2;
  out := out || 'A''s answer after the attempts: absorb_kg=' || coalesce(n::text, 'null') || ' by ' || coalesce(who, 'null') || case when n = 80 and who = 'b13-s1@x.test' then '' else '(!)' end || '; ';

  -- the lead and the admin may correct any answer; the stamp then names them
  perform set_config('request.jwt.claims', '{"email":"b13-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.surplus_response set response = 'partial', absorb_kg = 50 where id = r2; get diagnostics n = row_count; select responded_by into who from public.surplus_response where id = r2;
    out := out || 'lead corrects an answer rows=' || n || ' responded_by=' || coalesce(who, 'null') || case when n = 1 and who = 'b13-lead@x.test' then '' else '(!)' end || '; ';
  exception when others then out := out || 'lead corrects: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b13-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.surplus_response set note = 'dikoreksi' where id = r2; get diagnostics n = row_count; select responded_by into who from public.surplus_response where id = r2;
    out := out || 'admin updates an answer rows=' || n || ' responded_by=' || coalesce(who, 'null') || case when n = 1 and who = 'b13-adm@x.test' then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin updates: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-7 P13 (rolled back): %', out;
end $$;

-- B-R83 A-REL-8 / O21(b) (probe P6): assignment_covers(a_key, k) = the exact key, or an assignment key without form suffix
-- for every form of it; a null assignment key = every key; one rule in every guard, policy and view that matches an
-- assignment (the v4 view included)
do $$
declare out text := ''; n int; pw uuid; wk uuid; ok boolean; t record;
begin
  insert into public.app_user(email, role) values ('b21-base@x.test','sales'),('b21-fresh@x.test','sales'),('b21-all@x.test','sales'),('b21-lead@x.test','commercial_lead');
  insert into public.sales_assignment (sales_rep, email, key) values ('B21a', 'b21-base@x.test', 'B21|Karkas'), ('B21b', 'b21-fresh@x.test', 'B21|Karkas|Fresh'), ('B21c', 'b21-all@x.test', null);

  -- the rule itself
  begin
    for t in select * from (values
      ('B21|Karkas', 'B21|Karkas', true), ('B21|Karkas', 'B21|Karkas|Fresh', true), ('B21|Karkas', 'B21|Karkas|Frozen', true), ('B21|Karkas', 'B21|Karkas|n/a', true),
      ('B21|Karkas', 'B21|Kepala|Fresh', false), ('B21|Karkas', 'B21|Kepala', false), ('B21|Karkas|Fresh', 'B21|Karkas|Fresh', true),
      ('B21|Karkas|Fresh', 'B21|Karkas|Frozen', false), ('B21|Karkas|Fresh', 'B21|Karkas', false), ('B21|Karkas|Fresh', 'B21|Karkas|n/a', false),
      (null, 'B21|Anything|Frozen', true), (null, null, true), ('B21|Karkas', null, false), ('B21|Karkas|Fresh', null, false)) as v(a, k, want) loop
      ok := public.assignment_covers(t.a, t.k);
      if ok is distinct from t.want then out := out || 'assignment_covers(' || coalesce(t.a, 'null') || ', ' || coalesce(t.k, 'null') || ')=' || coalesce(ok::text, 'null') || '(!); '; end if;
    end loop;
    out := out || 'assignment_covers table of 14 cases checked; ';
  exception when others then out := out || 'assignment_covers: ERROR(!) ' || sqlerrm || '; '; end;

  insert into public.week (week_start, update_date, tb_opening_date) values ('2033-08-08', '2033-08-11', '2033-08-06') returning id into wk;
  insert into public.parameter (week_id, sales_sees_cost) values (wk, true) on conflict (week_id) do update set sales_sees_cost = true;
  insert into public.plan_week (week_start, version, head_count) values ('2033-08-08', 1, 1000) returning id into pw;
  insert into public.commercial_daily (date, key, group_code, free_fresh_kg, price_floor) values
    ('2033-08-09', 'B21|Karkas|Fresh', 'G', 5, 20000), ('2033-08-09', 'B21|Karkas|Frozen', 'G', 5, 21000), ('2033-08-09', 'B21|Kepala|Fresh', 'G', 5, 22000);
  insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2033-08-15', 'B21|Karkas|Fresh', 10, 30000), ('2033-08-15', 'B21|Karkas|Frozen', 10, 30000), ('2033-08-15', 'B21|Kepala', 10, 30000);
  insert into public.discount_approval (key, customer, requested_price, floor_price, rp_per_kg_below, kg, total_below, requested_by) values
    ('B21|Karkas|Fresh', 'PT A', 19000, 20000, 1000, 10, 10000, 'other@x.test'), ('B21|Karkas|Frozen', 'PT A', 20000, 21000, 1000, 10, 10000, 'other@x.test');

  -- the assignment "B21|Karkas" (base key): every form of Karkas, nothing of Kepala; same in both views, commitments, answers, lines, discounts
  perform set_config('request.jwt.claims', '{"email":"b21-base@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily_sales; out := out || 'base-key rep: v4 view rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
  select count(*) into n from public.commercial_daily_sales_v5; out := out || 'base-key rep: v5 view rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
  select count(*) into n from public.sales_commitment; out := out || 'base-key rep reads commitments=' || n || case when n = 2 then '' else '(!)' end || '; ';
  select count(*) into n from public.discount_approval; out := out || 'base-key rep reads discount requests=' || n || case when n = 2 then '' else '(!)' end || '; ';
  begin insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2033-08-22', 'B21|Karkas', 5, 30000), ('2033-08-22', 'B21|Karkas|Frozen', 5, 30000); out := out || 'base-key rep commits base and Frozen: OK; ';
  exception when others then out := out || 'base-key rep commits: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2033-08-22', 'B21|Kepala', 5, 30000); out := out || 'base-key rep commits another SKU: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'base-key rep commits another SKU: denied; '; when others then out := out || 'other SKU: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'B21|Karkas|Frozen', 10, 'absorb'); out := out || 'base-key rep answers a Frozen surplus: OK; ';
  exception when others then out := out || 'base-key rep answers a Frozen surplus: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price) values (wk, '2033-08-10', 'Order', 'PT A', 'B21|Karkas|Frozen', 5, 30000); out := out || 'base-key rep orders a Frozen line: OK; ';
  exception when others then out := out || 'base-key rep orders a Frozen line: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- the assignment "B21|Karkas|Fresh": that SKU only (Fresh does not cover Frozen, nor the base key)
  perform set_config('request.jwt.claims', '{"email":"b21-fresh@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily_sales; out := out || 'Fresh rep: v4 view rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  select count(*) into n from public.commercial_daily_sales_v5 where key = 'B21|Karkas|Frozen'; out := out || 'P6 Fresh rep sees a Frozen row in the v5 view=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.sales_commitment where key = 'B21|Karkas|Frozen'; out := out || 'P6 Fresh rep reads a Frozen commitment=' || n || case when n = 0 then '' else '(!)' end || '; ';
  select count(*) into n from public.discount_approval where key = 'B21|Karkas|Frozen'; out := out || 'P6 Fresh rep reads a Frozen discount request=' || n || case when n = 0 then '' else '(!)' end || '; ';
  begin insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2033-08-29', 'B21|Karkas|Frozen', 5, 30000); out := out || 'P6 Fresh rep commits on Frozen: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'P6 Fresh rep commits on Frozen: denied; '; when others then out := out || 'Frozen commit: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2033-08-29', 'B21|Karkas', 5, 30000); out := out || 'P6 Fresh rep commits on the base key: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'P6 Fresh rep commits on the base key: denied; '; when others then out := out || 'base commit: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2033-08-29', 'B21|Karkas|Fresh', 5, 30000); out := out || 'Fresh rep commits on Fresh: OK; ';
  exception when others then out := out || 'Fresh rep commits on Fresh: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'B21|Karkas|Frozen', 10, 'absorb'); out := out || 'P6 Fresh rep answers a Frozen surplus: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'P6 Fresh rep answers a Frozen surplus: denied; '; when others then out := out || 'Frozen surplus: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price) values (wk, '2033-08-10', 'Order', 'PT A', 'B21|Karkas|Frozen', 5, 30000); out := out || 'P6 Fresh rep orders a Frozen line: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'P6 Fresh rep orders a Frozen line: denied; '; when others then out := out || 'Frozen line: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price) values (wk, '2033-08-10', 'Order', 'PT A', 'B21|Karkas|Fresh', 5, 30000); out := out || 'Fresh rep orders a Fresh line: OK; ';
  exception when others then out := out || 'Fresh rep orders a Fresh line: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- the assignment with key null: everything
  perform set_config('request.jwt.claims', '{"email":"b21-all@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.commercial_daily_sales; out := out || 'null-key rep: v4 view rows=' || n || case when n = 3 then '' else '(!)' end || '; ';
  select count(*) into n from public.sales_commitment; out := out || 'null-key rep reads commitments=' || n || case when n >= 3 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-8 O21 P6 (rolled back): %', out;
end $$;

-- B-R83 A-REL-9 (probe P11): a locked price-list row is never edited; the Admin retires it once (deleted_at set, the rest
-- as it was) and a retired row is neither edited nor revived by anybody, the commercial lead included
do $$
declare out text := ''; n int; x numeric; da timestamptz;
begin
  insert into public.app_user(email, role) values ('b11-lead@x.test','commercial_lead'),('b11-adm@x.test','admin'),('b11-sales@x.test','sales');
  insert into public.price_list_week (week_start, key, price_fresh, price_frozen, locked_at, locked_by) values
    ('2033-09-05', 'B11-A', 25000, 21000, now(), 'b11-lead@x.test'), ('2033-09-05', 'B11-B', 26000, 22000, now(), 'b11-lead@x.test'),
    ('2033-09-05', 'B11-C', 27000, 23000, now(), 'b11-lead@x.test'), ('2033-09-05', 'B11-D', 28000, 24000, null, null),
    ('2033-09-05', 'B11-E', 29000, 25000, now(), 'b11-lead@x.test');

  perform set_config('request.jwt.claims', '{"email":"b11-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  -- the Admin retires locked rows A, B and E (R40)
  begin update public.price_list_week set deleted_at = now(), deleted_by = 'b11-adm@x.test' where week_start = '2033-09-05' and key in ('B11-A', 'B11-B', 'B11-E'); get diagnostics n = row_count;
    out := out || 'admin retires locked price rows=' || n || case when n = 3 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin retires locked price rows: REJECTED(!) ' || sqlerrm || '; '; end;
  -- the Admin cannot change the price while retiring, cannot unlock, cannot edit a live locked row
  begin update public.price_list_week set deleted_at = now(), price_fresh = 1 where week_start = '2033-09-05' and key = 'B11-C'; get diagnostics n = row_count; out := out || 'admin retires and changes the price: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin retires and changes the price: denied; '; when others then out := out || 'retire+price: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set locked_at = null where week_start = '2033-09-05' and key = 'B11-C'; get diagnostics n = row_count; out := out || 'admin unlocks a locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin unlocks a locked row: denied; '; when others then out := out || 'unlock: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set price_fresh = 1 where week_start = '2033-09-05' and key = 'B11-C'; get diagnostics n = row_count; out := out || 'admin edits a live locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin edits a live locked row: denied; '; when others then out := out || 'edit locked: ERROR(!) ' || sqlerrm || '; '; end;
  -- the retired row stays retired for the Admin as well
  begin update public.price_list_week set deleted_at = null, deleted_by = null where week_start = '2033-09-05' and key = 'B11-A'; get diagnostics n = row_count; out := out || 'P11 admin revives a retired row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P11 admin revives a retired row: denied; '; when others then out := out || 'admin revive: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set deleted_at = now() + interval '1 day' where week_start = '2033-09-05' and key = 'B11-A'; get diagnostics n = row_count; out := out || 'admin retires a retired row again: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin retires a retired row again: denied; '; when others then out := out || 'retire twice: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '{"email":"b11-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  -- P11: the lead revives the retired row and puts a new price on it
  begin update public.price_list_week set deleted_at = null, deleted_by = null, price_fresh = 99999 where week_start = '2033-09-05' and key = 'B11-B'; get diagnostics n = row_count;
    out := out || 'P11 lead revives a retired row with a new price: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P11 lead revives a retired row with a new price: denied; '; when others then out := out || 'lead revive: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set price_fresh = 99999 where week_start = '2033-09-05' and key = 'B11-E'; get diagnostics n = row_count;
    out := out || 'P11 lead edits the price of a retired row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P11 lead edits the price of a retired row: denied; '; when others then out := out || 'lead edit retired: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set price_fresh = 99999 where week_start = '2033-09-05' and key = 'B11-C'; get diagnostics n = row_count;
    out := out || 'lead edits a live locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'lead edits a live locked row: denied; '; when others then out := out || 'lead edit locked: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set deleted_at = now() where week_start = '2033-09-05' and key = 'B11-C'; get diagnostics n = row_count;
    out := out || 'lead retires a locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'lead retires a locked row: denied; '; when others then out := out || 'lead retire: ERROR(!) ' || sqlerrm || '; '; end;
  -- an unlocked row is the lead's to edit and to lock
  begin update public.price_list_week set price_fresh = 28500 where week_start = '2033-09-05' and key = 'B11-D'; get diagnostics n = row_count;
    out := out || 'lead edits an unlocked row rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'lead edits an unlocked row: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.price_list_week set locked_at = now() where week_start = '2033-09-05' and key = 'B11-D'; get diagnostics n = row_count;
    out := out || 'lead locks an unlocked row rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'lead locks: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b11-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.price_list_week set price_fresh = 1 where week_start = '2033-09-05' and key = 'B11-D'; get diagnostics n = row_count; out := out || 'sales edits a price row: rows=' || n || case when n = 0 then ' (refused)' else '(!)' end || '; ';
  exception when insufficient_privilege then out := out || 'sales edits a price row: denied; '; when others then out := out || 'sales edit: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select price_fresh, deleted_at into x, da from public.price_list_week where week_start = '2033-09-05' and key = 'B11-B';
  out := out || 'retired row B stays at ' || x::text || ' retired=' || (da is not null)::text || case when x = 26000 and da is not null then '' else '(!)' end || '; ';
  select price_fresh, deleted_at into x, da from public.price_list_week where week_start = '2033-09-05' and key = 'B11-E';
  out := out || 'retired row E stays at ' || x::text || ' retired=' || (da is not null)::text || case when x = 29000 and da is not null then '' else '(!)' end || '; ';
  select price_fresh, deleted_at into x, da from public.price_list_week where week_start = '2033-09-05' and key = 'B11-A';
  out := out || 'retired row A stays at ' || x::text || ' retired=' || (da is not null)::text || case when x = 25000 and da is not null then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-9 P11 (rolled back): %', out;
end $$;

-- B-R83 A-REL-10 / O31(a) (probe P12): lock_commitments refuses a week that has started (unless admin), refuses (23514,
-- keys listed) a key whose sizes carry different prices, writes one price per key, leaves a retired locked price row alone
do $$
declare out text := ''; n int; x numeric; da timestamptz; r text;
  cur date := date_trunc('week', (now() at time zone 'Asia/Jakarta')::date)::date;
  nx date := date_trunc('week', date '2033-10-05')::date; nx2 date := date_trunc('week', date '2033-10-05')::date + 7;
begin
  insert into public.app_user(email, role) values ('b12-lead@x.test','commercial_lead'),('b12-adm@x.test','admin'),('b12-sales@x.test','sales');
  delete from public.rebuild_queue where date >= '2020-01-01' and date <= '2020-01-31';

  -- P12: a week that has started. Drafts for two past Mondays and for the running week.
  insert into public.sales_commitment (week_start, key, fresh_kg, price) values ('2020-01-06', 'B12-P1', 10, 30000), ('2020-01-13', 'B12-P2', 10, 30000), (cur, 'B12-P3', 10, 30000);
  perform set_config('request.jwt.claims', '{"email":"b12-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments('2020-01-06', '{}'::jsonb); out := out || 'P12 lead locks a past week: LOCKED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P12 lead locks a past week: denied; ';
            when others then out := out || 'P12 lead past week: ERROR(!) ' || sqlerrm || '; '; end;
  begin n := public.lock_commitments(cur, '{}'::jsonb); out := out || 'P12 lead locks the running week: LOCKED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P12 lead locks the running week: denied; ';
            when others then out := out || 'P12 lead running week: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b12-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments('2020-01-13', '{}'::jsonb); out := out || 'sales locks: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales locks: denied; ';
            when others then out := out || 'sales lock: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  -- the admin corrects a week that has started
  perform set_config('request.jwt.claims', '{"email":"b12-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments('2020-01-13', '{}'::jsonb); out := out || 'admin locks a past week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin locks a past week: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.sales_commitment where week_start in ('2020-01-06', cur) and status = 'locked'; out := out || 'drafts of the refused weeks locked=' || n || case when n = 0 then '' else '(!)' end || '; ';

  -- P12: one key, two sizes, two prices. Next week: K differs, OK agrees, N has one size, M has a size without price
  insert into public.sales_commitment (week_start, key, size_kg, fresh_kg, price) values
    (nx, 'B12-K', 1.0, 10, 100), (nx, 'B12-K', 1.2, 10, 120), (nx, 'B12-OK', 1.0, 10, 90), (nx, 'B12-OK', 1.2, 10, 90), (nx, 'B12-N', null, 10, 50),
    (nx, 'B12-M', 1.0, 10, null), (nx, 'B12-M', 1.2, 10, 70);
  perform set_config('request.jwt.claims', '{"email":"b12-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments(nx, '{}'::jsonb); out := out || 'P12 differing prices per size: LOCKED rows=' || n || '(!); ';
  exception when others then
    out := out || 'P12 differing prices per size: rejected (' || case when sqlstate = '23514' and sqlerrm like '%B12-K%' and sqlerrm not like '%B12-OK%' and sqlerrm not like '%B12-M%' then '23514, only B12-K named' else sqlstate || ' ' || sqlerrm || '(!)' end || '); ';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.sales_commitment where week_start = nx and status = 'draft'; out := out || 'drafts after the refusal=' || n || case when n = 7 then '' else '(!)' end || '; ';
  select count(*) into n from public.price_list_week where week_start = nx; out := out || 'price list rows after the refusal=' || n || case when n = 0 then '' else '(!)' end || '; ';
  -- the lead aligns the prices: now the week locks and each key has its one price
  update public.sales_commitment set price = 100 where week_start = nx and key = 'B12-K' and size_kg = 1.2 and status = 'draft';
  perform set_config('request.jwt.claims', '{"email":"b12-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments(nx, '{}'::jsonb); out := out || 'aligned prices lock rows=' || n || case when n = 7 then '' else '(!)' end || '; ';
  exception when others then out := out || 'aligned prices: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select string_agg(key || '=' || price_fresh::text, ',' order by key) into r from public.price_list_week where week_start = nx;
  out := out || 'price list ' || coalesce(r, 'none') || case when r = 'B12-K=100.0000,B12-M=70.0000,B12-N=50.0000,B12-OK=90.0000' then '' else '(!)' end || '; ';

  -- a locked price row that the Admin retired is left alone by the lock (not revived, not repriced)
  insert into public.price_list_week (week_start, key, price_fresh, price_frozen, locked_at, locked_by, deleted_at, deleted_by) values (nx2, 'B12-R', 31000, 27000, now(), 'b12-lead@x.test', now(), 'b12-adm@x.test');
  insert into public.sales_commitment (week_start, key, fresh_kg, price) values (nx2, 'B12-R', 10, 130), (nx2, 'B12-S', 10, 140);
  perform set_config('request.jwt.claims', '{"email":"b12-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.lock_commitments(nx2, '{}'::jsonb); out := out || 'lock beside a retired locked price row rows=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'lock beside a retired row: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select price_fresh, deleted_at into x, da from public.price_list_week where week_start = nx2 and key = 'B12-R';
  out := out || 'P11 retired price row after the lock stays at ' || coalesce(x::text, 'null') || ' retired=' || (da is not null)::text || case when x = 31000 and da is not null then '' else '(!)' end || '; ';
  select price_fresh into x from public.price_list_week where week_start = nx2 and key = 'B12-S' and deleted_at is null;
  out := out || 'new key gets its price=' || coalesce(x::text, 'null') || case when x = 140 then '' else '(!)' end || '; ';
  out := out || 'anon executes lock_commitments=' || has_function_privilege('anon', 'public.lock_commitments(date,jsonb)', 'execute')::text
    || case when has_function_privilege('anon', 'public.lock_commitments(date,jsonb)', 'execute') then '(!)' else '' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B2 A-REL-10 O31 P12 (rolled back): %', out;
end $$;

-- B-R83 B-REL-7: the triggers find a line's SKU through the item map as the engine does (trim of JS white space, upper
-- case): a code typed in lower case or with spaces is the same SKU, not "no SKU" (a false denial)
do $$
declare out text := ''; n int; wk uuid; k text; c text; i int;
begin
  insert into public.app_user(email, role) values ('b7x-sales@x.test','sales');
  -- JLB0593 is RPA|Karkas|Fresh and JLB0092 RPA|Kepala|Fresh in the seed
  insert into public.sales_assignment (sales_rep, email, key) values ('B7X', 'b7x-sales@x.test', 'RPA|Karkas|Fresh');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2033-11-07', '2033-11-10', '2033-11-05') returning id into wk;

  begin
    k := public.sales_key(' jlb0593 ', null); out := out || 'sales_key(lower case, spaces)=' || coalesce(k, 'null') || case when k = 'RPA|Karkas|Fresh' then '' else '(!)' end || '; ';
    k := public.sales_key(E' JLB0593　', null); out := out || 'sales_key(nbsp, ideographic space)=' || coalesce(k, 'null') || case when k = 'RPA|Karkas|Fresh' then '' else '(!)' end || '; ';
    k := public.sales_key(E'\tJLB0593\n', null); out := out || 'sales_key(tab, newline)=' || coalesce(k, 'null') || case when k = 'RPA|Karkas|Fresh' then '' else '(!)' end || '; ';
    k := public.sales_key('JLB0593', '  X|Y  '); out := out || 'sales_key(key_manual wins, trimmed)=' || coalesce(k, 'null') || case when k = 'X|Y' then '' else '(!)' end || '; ';
    k := public.sales_key('   ', null); out := out || 'sales_key(blank)=' || coalesce(k, 'null') || case when k is null then '' else '(!)' end || '; ';
    k := public.sales_key('NOPE-123', null); out := out || 'sales_key(unknown)=' || coalesce(k, 'null') || case when k is null then '' else '(!)' end || '; ';
    -- every white-space character JS trim() removes, at both ends, and none in the middle
    for i in select unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) loop
      c := public.norm_code(chr(i) || 'ab' || chr(i) || 'c' || chr(i));
      if c is distinct from 'AB' || chr(i) || 'C' then out := out || 'norm_code U+' || to_hex(i) || ' wrong(!); '; end if;
    end loop;
    out := out || 'norm_code on 25 white-space characters checked; ';
    c := public.norm_code(E'​' || 'ab'); out := out || 'norm_code keeps zero-width space=' || (c = E'​' || 'AB')::text || case when c = E'​' || 'AB' then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales_key / norm_code: ERROR(!) ' || sqlerrm || '; '; end;

  perform set_config('request.jwt.claims', '{"email":"b7x-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.sales_line (week_id, date, status, customer, item_code, kg, price) values (wk, '2033-11-08', 'Order', 'PT A', ' jlb0593 ', 5, 30000); out := out || 'B-REL-7 assigned SKU typed in lower case with spaces: OK; ';
  exception when insufficient_privilege then out := out || 'B-REL-7 assigned SKU typed in lower case with spaces: DENIED(!); '; when others then out := out || 'lower case: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, item_code, kg, price) values (wk, '2033-11-08', 'Order', 'PT A', E'JLB0593 ', 5, 30000); out := out || 'B-REL-7 assigned SKU with a trailing nbsp: OK; ';
  exception when insufficient_privilege then out := out || 'B-REL-7 assigned SKU with a trailing nbsp: DENIED(!); '; when others then out := out || 'nbsp: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, key_manual, kg, price) values (wk, '2033-11-08', 'Order', 'PT A', ' RPA|Karkas|Fresh ', 5, 30000); out := out || 'key_manual with spaces: OK; ';
  exception when others then out := out || 'key_manual with spaces: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, item_code, kg, price) values (wk, '2033-11-08', 'Order', 'PT A', ' jlb0092 ', 5, 30000); out := out || 'another SKU in lower case: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'another SKU in lower case: denied; '; when others then out := out || 'other SKU: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.sales_line (week_id, date, status, customer, item_code, kg, price) values (wk, '2033-11-08', 'Order', 'PT A', '   ', 5, 30000); out := out || 'blank item code: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'blank item code: denied; '; when others then out := out || 'blank: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5.2 B2 B-REL-7 (rolled back): %', out;
end $$;

-- B-R83 B-REL-2 / O38 (probe P16b): release_override_policy (who may override which control) is changed by migrations
-- only; the Admin cannot widen it and then override his own release
do $$
declare out text := ''; n int; r text[]; wk date := '2033-12-05'; wid uuid; o text := '{"engineVersion":"t","controls":{"overall":"ADA GAGAL","controls":[{"no":8,"status":"LULUS"},{"no":11,"status":"GAGAL"}]}}';
begin
  insert into public.app_user(email, role) values ('b16-adm@x.test','admin'),('b16-fin@x.test','finance'),('b16-sales@x.test','sales');
  insert into public.week (week_start, update_date, tb_opening_date) values (wk, '2033-12-08', '2033-12-03') returning id into wid;
  delete from public.rebuild_queue where date between wk and wk + 6;

  perform set_config('request.jwt.claims', '{"email":"b16-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  -- the probe: the Admin adds himself to C11, then overrides a failing control of the week
  begin update public.release_override_policy set allowed_roles = array['finance', 'admin'] where code = 'C11'; get diagnostics n = row_count;
    out := out || 'P16b admin widens the policy of C11: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'P16b admin widens the policy of C11: denied; '; when others then out := out || 'P16b widen: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', wk::text, 'C11', 'override oleh admin sendiri', 'tidak ada'); out := out || 'P16b admin overrides C11 afterwards: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'P16b admin overrides C11 afterwards: denied; '; when others then out := out || 'P16b override: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.release_override_policy (code, allowed_roles, note) values ('C77', array['admin'], 'x'); out := out || 'admin inserts a policy row: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'admin inserts a policy row: denied; '; when others then out := out || 'insert policy: ERROR(!) ' || sqlerrm || '; '; end;
  begin delete from public.release_override_policy where code = 'C11'; get diagnostics n = row_count; out := out || 'admin deletes a policy row: rows=' || n || case when n = 0 then ' (refused)' else '(!)' end || '; ';
  exception when insufficient_privilege then out := out || 'admin deletes a policy row: denied; '; when others then out := out || 'delete policy: ERROR(!) ' || sqlerrm || '; '; end;
  out := out || 'authenticated privileges on the policy: insert=' || has_table_privilege('authenticated', 'public.release_override_policy', 'insert')::text || ' update=' || has_table_privilege('authenticated', 'public.release_override_policy', 'update')::text
    || ' delete=' || has_table_privilege('authenticated', 'public.release_override_policy', 'delete')::text || ' truncate=' || has_table_privilege('authenticated', 'public.release_override_policy', 'truncate')::text
    || case when has_table_privilege('authenticated', 'public.release_override_policy', 'insert') or has_table_privilege('authenticated', 'public.release_override_policy', 'update')
                 or has_table_privilege('authenticated', 'public.release_override_policy', 'delete') or has_table_privilege('authenticated', 'public.release_override_policy', 'truncate') then '(!)' else '' end || '; ';
  begin perform public.release_week(wid, o, encode(sha256(convert_to(o, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'admin releases a week with C11 GAGAL: RELEASED(!); ';
  exception when others then out := out || 'admin releases a week with C11 GAGAL: rejected; '; end;
  execute 'reset role';
  select allowed_roles into r from public.release_override_policy where code = 'C11';
  out := out || 'policy of C11 stays ' || coalesce(r::text, 'null') || case when r = array['finance'] then '' else '(!)' end || '; ';

  -- everyone still reads the policy; the migration-owned rows are there, C55 (O32b) and C53 / K35 (v5) included
  perform set_config('request.jwt.claims', '{"email":"b16-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.release_override_policy; out := out || 'sales reads the policy rows>=30=' || (n >= 30)::text || case when n >= 30 then '' else '(!)' end || '; ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select allowed_roles into r from public.release_override_policy where code = 'C55'; out := out || 'policy of C55=' || coalesce(r::text, 'none') || case when r = array['finance'] then '' else '(!)' end || '; ';
  select allowed_roles into r from public.release_override_policy where code = 'C53'; out := out || 'policy of C53=' || coalesce(r::text, 'none') || case when r = array['finance'] then '' else '(!)' end || '; ';
  select allowed_roles into r from public.release_override_policy where code = 'K35'; out := out || 'policy of K35=' || coalesce(r::text, 'none') || case when r = array['finance'] then '' else '(!)' end || '; ';

  -- Finance, the role the policy names, still overrides (the policy is read at the moment of the insert)
  perform set_config('request.jwt.claims', '{"email":"b16-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', wk::text, 'C11', 'selisih sudah dijelaskan', 'WP-1'); out := out || 'finance overrides C11: OK; ';
  exception when others then out := out || 'finance overrides C11: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5.2 B2 B-REL-2 O38 P16b (rolled back): %', out;
end $$;

-- B-R84 (K68; probes P2, P3, P4, P5): the database computes C53 (from batch.wp_received_at) and the K35 grid per day; the
-- client snapshot is evidence, not the verdict; release_month holds V1 on C55 (a complete week is released: next block)
do $$
declare out text := ''; n int; r text; t text; today date := (now() at time zone 'Asia/Jakarta')::date;
  w2 uuid; w3 uuid; w3b uuid; w4 uuid; w4b uuid; wcur uuid; cur date := date_trunc('week', (now() at time zone 'Asia/Jakarta')::date)::date;
  s_nov3 text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]}}';
  s_lulus text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]},"controls_v3":[{"code":"C53","status":"LULUS"},{"code":"C54","status":"LULUS"}]}';
  s_belum text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]},"controls_v3":[{"code":"C53","status":"BELUM DIISI"}]}';
  s_gagal text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]},"controls_v3":[{"code":"C53","status":"GAGAL"}]}';
  s_plain text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"}]}}';
begin
  insert into public.app_user(email, role) values ('b84-fin@x.test','finance'),('b84-adm@x.test','admin');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-01-01', '2024-01-04', '2023-12-30') returning id into w2;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-01-08', '2024-01-11', '2024-01-06') returning id into w3;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-01-15', '2024-01-18', '2024-01-13') returning id into w3b;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-01-22', '2024-01-25', '2024-01-20') returning id into w4;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-01-29', '2024-02-01', '2024-01-27') returning id into w4b;
  delete from public.rebuild_queue where date between '2024-01-01' and '2024-03-31';
  update public.app_setting set value = '{"enabled": false}' where key in ('v4_release', 'v5_costing', 'v5_input');

  -- the helper C53 of the tables: Aktual, no WP, past the deadline (cut date + hours/24 rounded, at wp_due_time, WIB)
  begin
    insert into public.batch (week_id, date, status, batch_ref, lb_kg) values (w3, '2024-01-09', 'Aktual', 'B84-LATE', 1000);
    insert into public.batch (week_id, date, status, batch_ref, lb_kg, wp_received_at) values (w3, '2024-01-09', 'Aktual', 'B84-GOT', 1000, '2024-01-10T09:00:00+07');
    insert into public.batch (week_id, date, status, batch_ref, lb_kg) values (w3, '2024-01-09', 'Rencana', 'B84-PLAN', 1000);
    r := public.c53_late_batches(w3, '2024-01-10T11:59:00+07'); out := out || 'C53 helper before the deadline=' || coalesce(r, 'none') || case when r is null then '' else '(!)' end || '; ';
    r := public.c53_late_batches(w3, '2024-01-10T12:01:00+07'); out := out || 'C53 helper after the deadline=' || coalesce(r, 'none') || case when r like 'B84-LATE tenggat 10/01 12.00' then '' else '(!)' end || '; ';
    insert into public.parameter (week_id, wp_due_hours, wp_due_time) values (w3b, 36, '09:30') on conflict (week_id) do update set wp_due_hours = 36, wp_due_time = '09:30';
    insert into public.batch (week_id, date, status, batch_ref, lb_kg) values (w3b, '2024-01-16', 'Aktual', 'B84-36H', 1000);
    r := public.c53_late_batches(w3b, '2024-01-18T09:29:00+07'); out := out || '36 h → 2 days: before=' || coalesce(r, 'none') || case when r is null then '' else '(!)' end || '; ';
    r := public.c53_late_batches(w3b, '2024-01-18T09:31:00+07'); out := out || '36 h → 2 days: after=' || coalesce(r, 'none') || case when r like 'B84-36H tenggat 18/01 09.30' then '' else '(!)' end || '; ';
    update public.batch set wp_received_at = '2024-01-19T09:00:00+07' where batch_ref = 'B84-36H';
    r := public.c53_late_batches(w3b, now()); out := out || 'WP received (even after the deadline) is not "belum diisi" (engine c53)=' || coalesce(r, 'none') || case when r is null then '' else '(!)' end || '; ';
  exception when others then out := out || 'C53 helper: ERROR(!) ' || sqlerrm || '; '; end;

  -- P2: v5_costing on, a snapshot without controls_v3 (a forged or old client) is not accepted
  update public.app_setting set value = '{"enabled": true}' where key = 'v5_costing';
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w2, s_nov3, encode(sha256(convert_to(s_nov3, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P2 snapshot without controls_v3, v5_costing on: RELEASED(!); ';
  exception when others then out := out || 'P2 snapshot without controls_v3, v5_costing on: rejected (' || case when sqlerrm like '%snapshot tidak lengkap%' then 'snapshot tidak lengkap' else sqlerrm || '(!)' end || '); '; end;
  begin perform public.release_week(w2, s_lulus, encode(sha256(convert_to(s_lulus, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'complete snapshot, no late batch: released; ';
  exception when others then out := out || 'complete snapshot, no late batch: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  begin select count(*) into n from public.release r2 where r2.week_id = w2 and r2.note is null; out := out || 'released w/o note=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'release.note: ERROR(!) ' || sqlerrm || '; '; end;

  -- P3: v4_release off, v5_costing on, a late WP and a snapshot that says C53 LULUS
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w3, s_lulus, encode(sha256(convert_to(s_lulus, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P3 late WP, snapshot says LULUS, v4_release off: RELEASED(!); ';
  exception when others then out := out || 'P3 late WP, snapshot says LULUS, v4_release off: rejected (' || case when sqlerrm like '%C53 BELUM DIISI%' and sqlerrm like '%B84-LATE%' and sqlerrm not like '%B84-GOT%' then 'C53, only the late batch named' else sqlerrm || '(!)' end || '); '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2024-01-08', 'C53', 'WP B84-LATE sudah dicek manual', 'WP-84'); out := out || 'finance C53 override: OK; ';
  exception when others then out := out || 'finance C53 override: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(w3, s_lulus, encode(sha256(convert_to(s_lulus, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P3 with the C53 override: released; ';
  exception when others then out := out || 'P3 with the C53 override: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  begin select note into t from public.release where week_id = w3; out := out || 'release.note=' || coalesce(t, 'null') || case when t like 'K68 C53: DB BELUM DIISI (B84-LATE tenggat%≠ snapshot LULUS%override C53%' then '' else '(!)' end || '; ';
  exception when others then out := out || 'release.note: ERROR(!) ' || sqlerrm || '; '; end;
  select status into t from public.week where id = w3; out := out || 'week status=' || t || case when t = 'released' then '' else '(!)' end || '; ';

  -- P3b: nothing is late in the tables, but the snapshot itself says C53 BELUM DIISI / GAGAL: held too (O22b), lifted by the override
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w3b, s_belum, encode(sha256(convert_to(s_belum, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P3 snapshot C53 BELUM DIISI, v4_release off: RELEASED(!); ';
  exception when others then out := out || 'P3 snapshot C53 BELUM DIISI, v4_release off: rejected (' || case when sqlerrm like '%C53 BELUM DIISI (snapshot)%' then 'C53 snapshot' else sqlerrm || '(!)' end || '); '; end;
  begin perform public.release_week(w3b, s_gagal, encode(sha256(convert_to(s_gagal, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'snapshot C53 GAGAL: RELEASED(!); ';
  exception when others then out := out || 'snapshot C53 GAGAL: rejected; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2024-01-15', 'C53', 'C53 diperiksa ulang manual', 'WP-85'); out := out || 'finance C53 override: OK; ';
  exception when others then out := out || 'finance C53 override: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(w3b, s_belum, encode(sha256(convert_to(s_belum, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'snapshot C53 BELUM DIISI with the override: released; ';
  exception when others then out := out || 'snapshot C53 BELUM DIISI with the override: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  begin select note into t from public.release where week_id = w3b; out := out || 'release.note=' || coalesce(t, 'null') || case when t like 'K68 C53: DB LULUS ≠ snapshot BELUM DIISI%override C53%' then '' else '(!)' end || '; ';
  exception when others then out := out || 'release.note: ERROR(!) ' || sqlerrm || '; '; end;

  -- v5_costing off: C53 of the snapshot as in v5.1 (strict mode only), nothing computed from the tables
  update public.app_setting set value = '{"enabled": false}' where key = 'v5_costing';
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-02-19', '2024-02-22', '2024-02-17') returning id into wcur;
  insert into public.batch (week_id, date, status, batch_ref, lb_kg) values (wcur, '2024-02-20', 'Aktual', 'B84-OFF', 1000);
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wcur, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'v5_costing off, late batch, snapshot without controls_v3: released (as v5.1); ';
  exception when others then out := out || 'v5_costing off: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- P4: v5_input on. One cell on Monday only: the other days of the past week have no grid
  update public.app_setting set value = '{"enabled": true}' where key = 'v5_input';
  insert into public.input_completeness_daily (date, kind, owner_role, status) values ('2024-01-22', 'gl_daily', 'inventory_accounting', 'passed');
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w4, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P4 one Monday cell only: RELEASED(!); ';
  exception when others then out := out || 'P4 one Monday cell only: rejected (' || case when sqlerrm like '%grid belum dibangun untuk 23/01, 24/01, 25/01, 26/01, 27/01, 28/01%' then 'grid belum dibangun untuk 23/01 … 28/01' else sqlerrm || '(!)' end || '); '; end;
  execute 'reset role';
  -- two days still missing (27/01, 28/01): the message names exactly those
  insert into public.input_completeness_daily (date, kind, owner_role, status) select d::date, 'gl_daily', 'inventory_accounting', 'passed' from generate_series('2024-01-23'::date, '2024-01-26'::date, interval '1 day') d;
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w4, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P4 grid until Friday: RELEASED(!); ';
  exception when others then out := out || 'P4 grid until Friday: rejected (' || case when sqlerrm like '%grid belum dibangun untuk 27/01, 28/01%' then '27/01, 28/01' else sqlerrm || '(!)' end || '); '; end;
  execute 'reset role';
  insert into public.input_completeness_daily (date, kind, owner_role, status) select d::date, 'gl_daily', 'inventory_accounting', 'passed' from generate_series('2024-01-27'::date, '2024-01-28'::date, interval '1 day') d;
  insert into public.input_completeness_daily (date, kind, owner_role, status) values ('2024-01-26', 'release_week', 'finance', 'late');
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w4, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P4 full grid (release task red): released; ';
  exception when others then out := out || 'P4 full grid: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  -- a grid with one Monday cell and Finance's override K35: released, and the note says what the override lifted
  insert into public.input_completeness_daily (date, kind, owner_role, status) values ('2024-01-29', 'gl_daily', 'inventory_accounting', 'passed');
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2024-01-29', 'K35', 'grid minggu ini dibangun manual', 'WP-86'); out := out || 'finance K35 override: OK; ';
  exception when others then out := out || 'finance K35 override: DENIED(!) ' || sqlerrm || '; '; end;
  begin perform public.release_week(w4b, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'P4 one Monday cell with the K35 override: released; ';
  exception when others then out := out || 'P4 with the K35 override: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  begin select note into t from public.release where week_id = w4b; out := out || 'release.note=' || coalesce(t, 'null') || case when t like 'K35 dilepas override: grid belum dibangun 30/01, 31/01, 01/02, 02/02, 03/02, 04/02%' then '' else '(!)' end || '; ';
  exception when others then out := out || 'release.note: ERROR(!) ' || sqlerrm || '; '; end;
  -- no grid at all stays refused (K45), also with the override
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-02-26', '2024-02-29', '2024-02-24') returning id into wcur;
  insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('week', '2024-02-26', 'K35', 'grid minggu ini dibangun manual', 'WP-87');
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(wcur, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'no grid at all, with the override: RELEASED(!); ';
  exception when others then out := out || 'no grid at all, with the override: rejected (' || case when sqlerrm like '%grid kelengkapan belum dibangun%' then 'grid belum dibangun' else sqlerrm || '(!)' end || '); '; end;
  execute 'reset role';
  -- the running week: only the days up to yesterday count (today and the days to come have no cell yet)
  begin
    delete from public.week where week_start = cur;
    insert into public.week (week_start, update_date, tb_opening_date) values (cur, cur + 3, cur - 2) returning id into wcur;
    delete from public.rebuild_queue where date between cur and cur + 6;
    insert into public.input_completeness_daily (date, kind, owner_role, status) select d::date, 'gl_daily', 'inventory_accounting', 'passed' from generate_series(cur::timestamp, greatest(cur, today - 1)::timestamp, interval '1 day') d;
    perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin perform public.release_week(wcur, s_plain, encode(sha256(convert_to(s_plain, 'UTF8')), 'hex'), null, '[]'::jsonb); out := out || 'running week, cells up to yesterday: released; ';
    exception when others then out := out || 'running week, cells up to yesterday: REJECTED(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  exception when others then out := out || 'running week: ERROR(!) ' || sqlerrm || '; '; end;

  -- P5: release_month V1 with C55 PERIKSA
  update public.app_setting set value = '{"enabled": false}' where key = 'v5_input';
  perform set_config('request.jwt.claims', '{"email":"b84-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  declare
    m_per text := '{"rule_version":"v5-test","controls":[{"code":"C33","status":"LULUS"},{"code":"C34","status":"LULUS"},{"code":"C49","status":"LULUS"},{"code":"C55","status":"PERIKSA"}]}';
    m_ok text := '{"rule_version":"v5-test","controls":[{"code":"C33","status":"LULUS"},{"code":"C34","status":"LULUS"},{"code":"C49","status":"LULUS"},{"code":"C55","status":"LULUS"}]}';
    m_none text := '{"rule_version":"v5-test","controls":[{"code":"C33","status":"LULUS"},{"code":"C34","status":"LULUS"},{"code":"C49","status":"LULUS"}]}';
  begin
    begin perform public.release_month('2024-03-01', 'V1', m_per, encode(sha256(convert_to(m_per, 'UTF8')), 'hex'), '2024-03-20', '{"revenue":"1"}'::jsonb, 'v5-test', null, null); out := out || 'P5 V1 with C55 PERIKSA: LOCKED(!); ';
    exception when others then out := out || 'P5 V1 with C55 PERIKSA: rejected (' || case when sqlerrm like '%C55 PERIKSA%' then 'C55' else sqlerrm || '(!)' end || '); '; end;
    begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2024-03-01:V1', 'C55', 'beban tetap Maret memakai estimasi, disetujui', 'email 20 Mar'); out := out || 'finance C55 override: OK; ';
    exception when others then out := out || 'finance C55 override: DENIED(!) ' || sqlerrm || '; '; end;
    begin perform public.release_month('2024-03-01', 'V1', m_per, encode(sha256(convert_to(m_per, 'UTF8')), 'hex'), '2024-03-20', '{"revenue":"1"}'::jsonb, 'v5-test', null, null); out := out || 'P5 V1 with the C55 override: locked; ';
    exception when others then out := out || 'P5 V1 with the C55 override: REJECTED(!) ' || sqlerrm || '; '; end;
    begin perform public.release_month('2024-04-01', 'V1', m_ok, encode(sha256(convert_to(m_ok, 'UTF8')), 'hex'), '2024-04-20', '{"revenue":"1"}'::jsonb, 'v5-test', null, null); out := out || 'V1 with C55 LULUS: locked; ';
    exception when others then out := out || 'V1 with C55 LULUS: REJECTED(!) ' || sqlerrm || '; '; end;
    begin perform public.release_month('2024-05-01', 'V1', m_none, encode(sha256(convert_to(m_none, 'UTF8')), 'hex'), '2024-05-20', '{"revenue":"1"}'::jsonb, 'v5-test', null, null); out := out || 'V1 without C55 in the snapshot (v5_pl off): locked; ';
    exception when others then out := out || 'V1 without C55: REJECTED(!) ' || sqlerrm || '; '; end;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b84-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2024-06-01:V1', 'C55', 'admin tidak boleh override C55', 'x'); out := out || 'admin C55 override: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'admin C55 override: denied; '; when others then out := out || 'admin C55 override: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.month_outlook_version v join public.month_outlook o on o.id = v.month_outlook_id where o.month in ('2024-03-01', '2024-04-01', '2024-05-01') and v.version = 'V1';
  out := out || 'V1 rows locked=' || n || case when n = 3 then '' else '(!)' end || '; ';

  update public.app_setting set value = '{"enabled": false}' where key in ('v4_release', 'v5_costing', 'v5_input');
  raise exception 'RLS-RESULTS v5.2 B2 B-R84 P2 P3 P4 P5 (rolled back): %', out;
end $$;

-- B-R84 positive: a complete week is released with every gate on and no override (Finance, then Admin), the snapshot is
-- stored as it was sent, and release.note stays empty when the database and the snapshot agree
do $$
declare out text := ''; n int; t text; w1 uuid; w2 uuid; sha text;
  s_ok text := '{"engineVersion":"t","controls":{"overall":"LULUS","controls":[{"no":8,"status":"LULUS"},{"no":11,"status":"LULUS"}]},"controls_v3":[{"code":"C53","status":"LULUS"},{"code":"C54","status":"LULUS"},{"code":"C57","status":"LULUS"}]}';
begin
  insert into public.app_user(email, role) values ('b84p-fin@x.test','finance'),('b84p-adm@x.test','admin'),('b84p-sales@x.test','sales');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-02-05', '2024-02-08', '2024-02-03') returning id into w1;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2024-02-12', '2024-02-15', '2024-02-10') returning id into w2;
  insert into public.batch (week_id, date, status, batch_ref, lb_kg, wp_received_at) values
    (w1, '2024-02-06', 'Aktual', 'B84P-1', 1000, '2024-02-07T09:00:00+07'), (w1, '2024-02-07', 'Aktual', 'B84P-2', 1000, '2024-02-08T08:00:00+07'),
    (w2, '2024-02-13', 'Aktual', 'B84P-3', 1000, '2024-02-14T10:00:00+07');
  -- the whole grid of both weeks (two kinds a day) and the red release task itself, which is not a cell (K44)
  insert into public.input_completeness_daily (date, kind, owner_role, status) select d::date, k, 'inventory_accounting', 'passed'
    from generate_series('2024-02-05'::date, '2024-02-18'::date, interval '1 day') d cross join (values ('gl_daily'), ('stock_daily')) v(k);
  insert into public.input_completeness_daily (date, kind, owner_role, status) values ('2024-02-08', 'release_week', 'finance', 'late'), ('2024-02-15', 'release_week', 'finance', 'late');
  delete from public.rebuild_queue where date between '2024-02-05' and '2024-02-18';
  update public.app_setting set value = '{"enabled": true}' where key in ('v4_release', 'v5_costing', 'v5_input');
  sha := encode(sha256(convert_to(s_ok, 'UTF8')), 'hex');

  perform set_config('request.jwt.claims', '{"email":"b84p-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w1, s_ok, sha, null, '[]'::jsonb); out := out || 'sales releases: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales releases: denied; '; when others then out := out || 'sales release: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b84p-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w1, s_ok, sha, null, '[]'::jsonb); out := out || 'COMPLETE WEEK by Finance, v4_release + v5_costing + v5_input on, no override: released; ';
  exception when others then out := out || 'COMPLETE WEEK by Finance: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b84p-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.release_week(w2, s_ok, sha, null, '[]'::jsonb); out := out || 'COMPLETE WEEK by Admin: released; ';
  exception when others then out := out || 'COMPLETE WEEK by Admin: REJECTED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.release where week_id in (w1, w2) and snapshot_sha256 = sha and note is null and control_status = 'LULUS';
    out := out || 'release rows with the sent snapshot, no note=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'release rows: ERROR(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.week where id in (w1, w2) and status = 'released'; out := out || 'weeks released=' || n || case when n = 2 then '' else '(!)' end || '; ';
  select count(*) into n from public.release where week_id in (w1, w2) and released_by in ('b84p-fin@x.test', 'b84p-adm@x.test'); out := out || 'released_by stamped=' || n || case when n = 2 then '' else '(!)' end || '; ';
  update public.app_setting set value = '{"enabled": false}' where key in ('v4_release', 'v5_costing', 'v5_input');
  raise exception 'RLS-RESULTS v5.2 B2 B-R84 positive complete week (rolled back): %', out;
end $$;

-- v5.2 B2 hygiene: SECURITY DEFINER with a fixed search_path, nothing of v5.2 for anon, helpers not callable by clients,
-- no drop or rename of what v5.1 shipped (functions keep their signatures), schema versions in order
do $$
declare out text := ''; bad text; n int; f text; sig text[] := array[
  'public.schema_version()', 'public.assignment_covers(text,text)', 'public.norm_code(text)', 'public.sales_key(text,text)', 'public.advance_update_date(uuid,date)',
  'public.lock_commitments(date,jsonb)', 'public.release_week(uuid,text,text,text,jsonb)', 'public.release_month(date,text,text,text,date,jsonb,text,jsonb,numeric)',
  'public.sales_line_in_scope(text,text,boolean)', 'public.c53_late_batches(uuid,timestamptz)', 'public.k35_grid_gaps(date)', 'public.floor_of(text,date)'];
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  out := out || 'SECURITY DEFINER functions without a fixed search_path=' || coalesce(bad, 'none') || case when bad is null then '' else '(!)' end || '; ';
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  out := out || 'SECURITY DEFINER functions executable by anon=' || coalesce(bad, 'none') || case when bad is null then '' else '(!)' end || '; ';
  -- the functions this release touches: signatures as v5.1 (create or replace keeps one function per name), none for anon
  foreach f in array sig loop
    begin
      if has_function_privilege('anon', f, 'execute') then out := out || f || ' executable by anon(!); '; end if;
    exception when others then out := out || f || ': MISSING(!); '; end;
  end loop;
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('release_week', 'release_month', 'lock_commitments', 'advance_update_date', 'sales_key', 'schema_version', 'assignment_covers', 'norm_code');
  out := out || 'one function per name (no overload)=' || n || case when n = 8 then '' else '(!)' end || '; ';
  -- helpers that only the definer functions call are not callable through the API
  foreach f in array array['public.sales_line_in_scope(text,text,boolean)', 'public.c53_late_batches(uuid,timestamptz)', 'public.k35_grid_gaps(date)', 'public.floor_of(text,date)'] loop
    begin
      if has_function_privilege('authenticated', f, 'execute') then out := out || f || ' executable by clients(!); '; end if;
    exception when others then out := out || f || ': MISSING(!); '; end;
  end loop;
  out := out || 'helpers checked for clients; ';
  -- tables and views: nothing of v5.2 for anon
  begin
    select string_agg(x, ', ') into bad from unnest(array['public.schema_registry', 'public.surplus_for_sales_v52', 'public.commercial_daily_sales', 'public.commercial_daily_sales_v5']) x
     where has_table_privilege('anon', x, 'select') or has_table_privilege('anon', x, 'insert') or has_table_privilege('anon', x, 'update') or has_table_privilege('anon', x, 'delete');
    out := out || 'tables and views of v5.2 with anon privileges=' || coalesce(bad, 'none') || case when bad is null then '' else '(!)' end || '; ';
  exception when others then out := out || 'anon table privileges: ERROR(!) ' || sqlerrm || '; '; end;
  -- the versions in the registry follow each other: v5.2 B2 registers 5.2.0, 5.2.1, 5.2.2
  begin
    select string_agg(version, ',' order by version) into bad from public.schema_registry where version in ('5.2.0', '5.2.1', '5.2.2');
    out := out || 'registry has ' || coalesce(bad, 'none') || case when bad = '5.2.0,5.2.1,5.2.2' then '' else '(!)' end || '; ';
  exception when others then out := out || 'registry: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B2 hygiene (rolled back): %', out;
end $$;

-- ================================================================================================================
-- v5.2 B5 (docs/PRD-v5.2-B-db.md B-R85, B-R86, B-R94; Q-v5.2-13, Q-v5.2-18; requests of A2 and A3). Same convention as
-- above: results in the final error, (!) = unexpected; every block is self-contained and rolls back; each assertion is
-- guarded so that a missing object shows as ERROR(!) instead of stopping the block. Run against the migrations of
-- origin/main only (without 20261025000400 and 20261025000500) the blocks show (!): that is the proof of what the
-- migrations add (docs/v5.2/b5.md).
-- ================================================================================================================

-- B-R85 R51: batch.lb_price_source accepts the three sources and null, refuses anything else; whoever writes batch
-- (admin, ppic, cost_accounting, on a writable week) can fill it, nobody else gets a new right
do $$
declare out text := ''; n int; w uuid; wc uuid; b uuid; bc uuid; v text; r text; vals text[] := array['keputusan_kelas', 'keputusan_semua_kelas', 'manual'];
begin
  insert into public.app_user(email, role) values ('b5a-ppic@x.test','ppic'),('b5a-ca@x.test','cost_accounting'),('b5a-adm@x.test','admin'),
    ('b5a-sales@x.test','sales'),('b5a-fin@x.test','finance'),('b5a-purch@x.test','purchasing'),('b5a-mgmt@x.test','management'),('b5a-ia@x.test','inventory_accounting');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2034-01-02', '2034-01-05', '2033-12-30') returning id into w;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2034-01-09', '2034-01-12', '2034-01-06', 'closed') returning id into wc;
  insert into public.batch (week_id, date, status, lb_kg) values (w, '2034-01-03', 'Rencana', 100) returning id into b;
  insert into public.batch (week_id, date, status, lb_kg) values (wc, '2034-01-10', 'Rencana', 100) returning id into bc;

  begin
    select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'batch' and column_name = 'lb_price_source' and data_type = 'text' and is_nullable = 'YES';
    out := out || 'column batch.lb_price_source text null=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select count(*) into n from public.batch where lb_price_source is not null;
    out := out || 'batches with a source before anyone sets one=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'column: ERROR(!) ' || sqlerrm || '; '; end;

  -- the three values and null are accepted, for every role that writes batch
  foreach r in array array['ppic', 'ca', 'adm'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5a-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    foreach v in array vals loop
      begin update public.batch set lb_price_source = v where id = b; get diagnostics n = row_count;
        out := out || r || ' sets ' || v || ' rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
      exception when others then out := out || r || ' sets ' || v || ': ERROR(!) ' || sqlerrm || '; '; end;
    end loop;
    begin update public.batch set lb_price_source = null where id = b; get diagnostics n = row_count;
      out := out || r || ' clears the source rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' clears the source: ERROR(!) ' || sqlerrm || '; '; end;
    -- anything else is refused by the check (admin and ppic alike)
    begin update public.batch set lb_price_source = 'harga_pasar' where id = b; get diagnostics n = row_count;
      out := out || r || ' sets a free text: ALLOWED rows=' || n || '(!); ';
    exception when check_violation then out := out || r || ' sets a free text: refused (23514); ';
              when others then out := out || r || ' sets a free text: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  begin insert into public.batch (week_id, date, status, lb_kg, lb_price_source) values (w, '2034-01-04', 'Rencana', 100, 'MANUAL');
    out := out || 'insert with an upper-case source: ALLOWED(!); ';
  exception when check_violation then out := out || 'insert with an upper-case source: refused; ';
            when others then out := out || 'insert with an upper-case source: ERROR(!) ' || sqlerrm || '; '; end;

  -- no new right: Sales, Finance, Purchasing, Management and Inventory Accounting still write no batch row
  foreach r in array array['sales', 'fin', 'purch', 'mgmt', 'ia'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5a-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin update public.batch set lb_price_source = 'manual' where id = b; get diagnostics n = row_count;
      out := out || r || ' sets the source: rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' sets the source: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  -- a closed week stays closed to ppic and cost accounting (the admin still writes)
  foreach r in array array['ppic', 'ca', 'adm'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5a-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin update public.batch set lb_price_source = 'manual' where id = bc; get diagnostics n = row_count;
      out := out || r || ' on a closed week rows=' || n || case when (r = 'adm' and n = 1) or (r <> 'adm' and n = 0) then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' on a closed week: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);
  begin select lb_price_source into v from public.batch where id = b; out := out || 'value left by the non-writers=' || coalesce(v, 'null') || case when v is null then '' else '(!)' end || '; ';
  exception when others then out := out || 'value: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B5 B-R85 lb_price_source (rolled back): %', out;
end $$;

-- B-R85 A2 (R51, R52 stage 1): plan_check_reason.plan_week_id binds a C58 reason to one plan version; plan_week_class.detail
-- keeps the split per cut date; both tables keep their write rights (admin, ppic)
do $$
declare out text := ''; n int; p1 uuid; p2 uuid; po uuid; pc uuid; id1 uuid; r text; idx text;
begin
  insert into public.app_user(email, role) values ('b5b-ppic@x.test','ppic'),('b5b-adm@x.test','admin'),('b5b-fin@x.test','finance'),('b5b-sales@x.test','sales'),('b5b-mgmt@x.test','management');
  insert into public.plan_week (week_start, version, head_count) values ('2034-01-16', 1, 1000) returning id into p1;
  insert into public.plan_week (week_start, version, head_count) values ('2034-01-16', 2, 1100) returning id into p2;
  insert into public.plan_week (week_start, version, head_count) values ('2034-01-23', 1, 900) returning id into po;
  insert into public.plan_week_class (plan_week_id, weight_class, kg_lb, heads) values (p1, 'K', 5000, 1000) returning id into pc;

  begin
    select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'plan_check_reason' and column_name = 'plan_week_id' and data_type = 'uuid' and is_nullable = 'YES';
    out := out || 'column plan_check_reason.plan_week_id uuid null=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'plan_week_class' and column_name = 'detail' and data_type = 'jsonb' and is_nullable = 'YES';
    out := out || 'column plan_week_class.detail jsonb null=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select indexdef into idx from pg_indexes where schemaname = 'public' and indexname = 'plan_check_reason_plan_code';
    out := out || 'unique index per plan version and code=' || (coalesce(idx, '') like 'CREATE UNIQUE INDEX%(plan_week_id, code)%deleted_at IS NULL%')::text
      || case when coalesce(idx, '') like 'CREATE UNIQUE INDEX%(plan_week_id, code)%deleted_at IS NULL%' then '' else '(!)' end || '; ';
    -- a class row saved without a split (every row saved before v5.2) reads as null
    select count(*) into n from public.plan_week_class where id = pc and detail is null;
    out := out || 'a class row saved without detail has detail null=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'columns: ERROR(!) ' || sqlerrm || '; '; end;

  -- PPIC writes a reason bound to version 1; a second live reason of the same version and control is refused
  perform set_config('request.jwt.claims', '{"email":"b5b-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C58', 'supply menyusul dari CV X', p1) returning id into id1;
    out := out || 'ppic writes a reason bound to version 1: OK; ';
  exception when others then out := out || 'ppic writes a bound reason: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C58', 'alasan kedua versi yang sama', p1);
    out := out || 'second live reason of the same version and code: ALLOWED(!); ';
  exception when unique_violation then out := out || 'second live reason of the same version and code: refused (23505); ';
            when others then out := out || 'second live reason: ERROR(!) ' || sqlerrm || '; '; end;
  -- the reason of the older version is retired, then version 2 gets its own (what the app does); the old one stays as history
  begin update public.plan_check_reason set deleted_at = now() where id = id1; get diagnostics n = row_count;
    out := out || 'ppic retires the reason of version 1 rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'retire: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C58', 'supply versi 2 menyusul', p2);
    out := out || 'a reason bound to version 2: OK; ';
  exception when others then out := out || 'reason of version 2: ERROR(!) ' || sqlerrm || '; '; end;
  begin select count(*) into n from public.plan_check_reason where week_start = '2034-01-16' and code = 'C58' and deleted_at is null and plan_week_id = p2;
    out := out || 'live reasons of version 2=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_check_reason where week_start = '2034-01-16' and code = 'C58' and plan_week_id = p1;
    out := out || 'reason rows kept for version 1=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'count: ERROR(!) ' || sqlerrm || '; '; end;
  -- a version of another week, and a version that does not exist, are refused
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C41', 'versi minggu lain tidak boleh', po);
    out := out || 'reason bound to a version of another week: ALLOWED(!); ';
  exception when check_violation then out := out || 'reason bound to a version of another week: refused (23514); ';
            when others then out := out || 'other week: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C41', 'versi yang tidak ada', gen_random_uuid());
    out := out || 'reason bound to a missing version: ALLOWED(!); ';
  exception when check_violation or foreign_key_violation then out := out || 'reason bound to a missing version: refused (' || sqlstate || '); ';
            when others then out := out || 'missing version: ERROR(!) ' || sqlerrm || '; '; end;
  -- a reason without a version stays possible (rows written before v5.2 and the v4 screens)
  begin insert into public.plan_check_reason (week_start, code, reason) values ('2034-01-23', 'C44', 'alasan tanpa versi seperti v4'); get diagnostics n = row_count;
    out := out || 'reason without a version: OK; ';
  exception when others then out := out || 'reason without a version: ERROR(!) ' || sqlerrm || '; '; end;
  -- plan_week_class.detail: PPIC writes an object or an array, not a bare value; null stays valid
  begin update public.plan_week_class set detail = '{"2034-01-16": {"kg_lb": 2500}, "2034-01-17": {"kg_lb": 2500}}'::jsonb where id = pc; get diagnostics n = row_count;
    out := out || 'ppic writes detail (object) rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'ppic detail: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.plan_week_class set detail = '[{"date": "2034-01-16"}]'::jsonb where id = pc; get diagnostics n = row_count;
    out := out || 'ppic writes detail (array) rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'ppic detail array: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.plan_week_class set detail = '5'::jsonb where id = pc; get diagnostics n = row_count;
    out := out || 'detail = a bare number: ALLOWED rows=' || n || '(!); ';
  exception when check_violation then out := out || 'detail = a bare number: refused (23514); ';
            when others then out := out || 'detail number: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.plan_week_class set detail = null where id = pc; get diagnostics n = row_count;
    out := out || 'detail back to null rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'detail null: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- nobody else gains a write right: Finance and Sales write neither table, Management only reads
  foreach r in array array['fin', 'sales', 'mgmt'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5b-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C42', 'alasan dari role lain', p2);
      out := out || r || ' writes a reason: ALLOWED(!); ';
    exception when insufficient_privilege then out := out || r || ' writes a reason: denied; ';
              when others then out := out || r || ' writes a reason: ERROR(!) ' || sqlerrm || '; '; end;
    begin update public.plan_week_class set detail = '{}'::jsonb where id = pc; get diagnostics n = row_count;
      out := out || r || ' writes detail rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when insufficient_privilege then out := out || r || ' writes detail: denied; ';
              when others then out := out || r || ' writes detail: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  -- Admin writes both
  perform set_config('request.jwt.claims', '{"email":"b5b-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values ('2034-01-16', 'C45', 'alasan dari admin', p2);
    out := out || 'admin writes a bound reason: OK; ';
  exception when others then out := out || 'admin reason: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.plan_week_class set detail = '{"a": 1}'::jsonb where id = pc; get diagnostics n = row_count;
    out := out || 'admin writes detail rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin detail: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5.2 B5 A2 plan_check_reason.plan_week_id plan_week_class.detail (rolled back): %', out;
end $$;

-- B-R85 A3 (R61): Finance posts an allocation that has an SKU without a reference price only through
-- post_allocation_override; no write right on allocation_run or batch is opened to Finance
do $$
declare out text := ''; n int; i int; w uuid; wc uuid; b uuid; rs uuid[] := '{}'; bs uuid[] := '{}'; r text; v text; st text; cs text; iss jsonb; pb text; pa timestamptz; ub text;
begin
  insert into public.app_user(email, role) values ('b5r-fin@x.test','finance'),('b5r-adm@x.test','admin'),('b5r-ca@x.test','cost_accounting'),
    ('b5r-sales@x.test','sales'),('b5r-ppic@x.test','ppic'),('b5r-mgmt@x.test','management'),('b5r-ia@x.test','inventory_accounting');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2034-01-30', '2034-02-02', '2034-01-27') returning id into w;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2034-02-06', '2034-02-09', '2034-02-03', 'closed') returning id into wc;
  -- 1 unpriced (key K-A), 2 priced (and a zero-kg line without a price), 3 unpriced but not balanced, 4 already posted,
  -- 5 unpriced (no key: the item code is named), 6 unpriced with price 0, 7 unpriced on a closed week, 8 unpriced but its batch is deleted
  for i in 1..8 loop
    insert into public.batch (week_id, date, status, lb_kg, batch_ref) values (case when i = 7 then wc else w end, case when i = 7 then date '2034-02-07' else date '2034-01-31' end, 'Aktual', 100, 'B5R-' || i) returning id into b;
    bs := bs || b;
    insert into public.batch_output_sku (batch_id, key, item_code, kg) values (b, null, 'ITEM' || i, 100);
    insert into public.allocation_run (batch_id, total_cost, total_allocated, status) values (b, 1000, case when i = 3 then 500 else 1000 end, case when i = 4 then 'posted' else 'draft' end) returning id into b;
    rs := rs || b;
    insert into public.allocation_line (allocation_run_id, key, item_code, kg, price_ref, sales_value, share, allocated_cost, cost_per_kg)
    values (b, case when i = 1 then 'K-A' end, 'ITEM' || i, 100, case when i = 2 then 5000 when i = 6 then 0 end, 0, 1, 1000, 10);
  end loop;
  insert into public.allocation_line (allocation_run_id, key, item_code, kg, price_ref, sales_value, share, allocated_cost, cost_per_kg) values (rs[2], 'K-ZERO', 'ZERO', 0, null, 0, 0, 0, 0);
  update public.batch set deleted_at = now() where id = bs[8];

  -- no write right opened: Finance updates neither allocation_run nor batch directly (0 rows, nothing changes)
  perform set_config('request.jwt.claims', '{"email":"b5r-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.allocation_run set status = 'posted', posted_by = 'b5r-fin@x.test' where id = rs[1]; get diagnostics n = row_count;
    out := out || 'finance posts a run directly rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance direct post: denied(' || sqlstate || '); '; end;
  begin update public.allocation_run set issues = '["x"]'::jsonb where id = rs[1]; get diagnostics n = row_count;
    out := out || 'finance edits issues directly rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance edits issues: denied(' || sqlstate || '); '; end;
  begin update public.batch set costing_status = 'posted' where id = bs[1]; get diagnostics n = row_count;
    out := out || 'finance sets batch.costing_status directly rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance batch: denied(' || sqlstate || '); '; end;
  execute 'reset role';
  select status into st from public.allocation_run where id = rs[1]; select costing_status into cs from public.batch where id = bs[1];
  out := out || 'run 1 after the direct attempts=' || st || '/' || cs || case when st = 'draft' and cs = 'none' then '' else '(!)' end || '; ';

  -- who may call it: Finance and Admin only
  foreach r in array array['sales', 'ppic', 'mgmt', 'ca', 'ia'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5r-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin perform public.post_allocation_override(array[rs[1]], 'alasan yang cukup panjang'); out := out || r || ' calls the override: ALLOWED(!); ';
    exception when insufficient_privilege then out := out || r || ' calls the override: denied; ';
              when others then out := out || r || ' calls the override: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;

  -- finance: what the function refuses
  perform set_config('request.jwt.claims', '{"email":"b5r-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.post_allocation_override(array[rs[1]], '   pendek  '); out := out || 'reason under 10 characters: ALLOWED(!); ';
  exception when check_violation then out := out || 'reason under 10 characters: refused (23514); ';
            when others then out := out || 'short reason: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(null, 'alasan yang cukup panjang'); out := out || 'no run ids: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'no run ids: refused (22023); ';
            when others then out := out || 'no run ids: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override('{}'::uuid[], 'alasan yang cukup panjang'); out := out || 'empty run ids: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'empty run ids: refused (22023); ';
            when others then out := out || 'empty run ids: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(array[gen_random_uuid()], 'alasan yang cukup panjang'); out := out || 'unknown run: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'unknown run: refused (22023); ';
            when others then out := out || 'unknown run: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(array[rs[2]], 'alasan yang cukup panjang'); out := out || 'a fully priced run (a normal posting, not an override): ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'a fully priced run (zero-kg line without price ignored): refused (22023); ';
            when others then out := out || 'priced run: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(array[rs[3]], 'alasan yang cukup panjang'); out := out || 'an unbalanced run (C21): ALLOWED(!); ';
  exception when check_violation then out := out || 'an unbalanced run (C21): refused (23514); ';
            when others then out := out || 'unbalanced run: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(array[rs[4]], 'alasan yang cukup panjang'); out := out || 'a posted run: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'a posted run: refused (22023); ';
            when others then out := out || 'posted run: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(array[rs[7]], 'alasan yang cukup panjang'); out := out || 'a run of a closed week by finance: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'a run of a closed week by finance: denied; ';
            when others then out := out || 'closed week: ERROR(!) ' || sqlerrm || '; '; end;
  begin perform public.post_allocation_override(array[rs[8]], 'alasan yang cukup panjang'); out := out || 'a run of a deleted batch: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'a run of a deleted batch: refused (22023); ';
            when others then out := out || 'deleted batch: ERROR(!) ' || sqlerrm || '; '; end;
  -- all or none: one fully priced run in the list undoes the whole call
  begin perform public.post_allocation_override(array[rs[1], rs[2]], 'alasan yang cukup panjang'); out := out || 'a list with a priced run: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'a list with a priced run: refused (22023); ';
            when others then out := out || 'list with a priced run: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  select status into st from public.allocation_run where id = rs[1]; select costing_status into cs from public.batch where id = bs[1];
  out := out || 'run 1 after the refused calls=' || st || '/' || cs || case when st = 'draft' and cs = 'none' then '' else '(!)' end || '; ';

  -- finance posts two unpriced runs (a key, and a zero price named by item code)
  perform set_config('request.jwt.claims', '{"email":"b5r-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.post_allocation_override(array[rs[6], rs[1], rs[1]], '  harga acuan menyusul dari Sales, WP-0131  ');
    out := out || 'finance override of runs 1 and 6 (run 1 listed twice) posted=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance override: ERROR(!) ' || sqlerrm || '; '; end;
  begin n := public.post_allocation_override(array[rs[1]], 'alasan yang cukup panjang'); out := out || 'the same run again: ALLOWED(!); ';
  exception when invalid_parameter_value then out := out || 'the same run again: refused (22023); ';
            when others then out := out || 'same run again: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    select status, posted_by, posted_at, issues, updated_by into st, pb, pa, iss, ub from public.allocation_run where id = rs[1];
    out := out || 'run 1: status=' || st || ' posted_by=' || coalesce(pb, 'null') || ' posted_at set=' || (pa is not null)::text || ' updated_by=' || coalesce(ub, 'null')
      || case when st = 'posted' and pb = 'b5r-fin@x.test' and pa is not null and ub = 'b5r-fin@x.test' then '' else '(!)' end || '; ';
    out := out || 'run 1 issues=' || jsonb_array_length(iss) || ' [' || coalesce(iss ->> 0, 'null') || ']'
      || case when jsonb_array_length(iss) = 1 and (iss ->> 0) like 'override Finance: diposting tanpa harga acuan K-A — harga acuan menyusul dari Sales, WP-0131 (b5r-fin@x.test, 20__-__-__)' then '' else '(!)' end || '; ';
    select costing_status into cs from public.batch where id = bs[1]; out := out || 'batch 1 costing_status=' || cs || case when cs = 'posted' then '' else '(!)' end || '; ';
    select status, issues into st, iss from public.allocation_run where id = rs[6];
    out := out || 'run 6 (price 0): status=' || st || ' [' || coalesce(iss ->> 0, 'null') || ']'
      || case when st = 'posted' and (iss ->> 0) like 'override Finance: diposting tanpa harga acuan ITEM6 — %' then '' else '(!)' end || '; ';
    select status into st from public.allocation_run where id = rs[2]; select costing_status into cs from public.batch where id = bs[2];
    out := out || 'run 2 (priced, not in the call)=' || st || '/' || cs || case when st = 'draft' and cs = 'none' then '' else '(!)' end || '; ';
    select count(*) into n from public.audit_log where table_name = 'allocation_run' and row_id in (rs[1]::text, rs[6]::text) and op = 'UPDATE' and actor = 'b5r-fin@x.test';
    out := out || 'audit rows of the two postings by finance=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'result: ERROR(!) ' || sqlerrm || '; '; end;

  -- admin: an unpriced run without a key (item code named), and the run of a closed week (the admin writes closed weeks)
  perform set_config('request.jwt.claims', '{"email":"b5r-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin n := public.post_allocation_override(array[rs[5], rs[7]], 'selisih harga acuan disetujui rapat');
    out := out || 'admin override of runs 5 and 7 posted=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin override: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin select issues into iss from public.allocation_run where id = rs[5];
    out := out || 'run 5 names the item code=' || coalesce((iss ->> 0) like 'override Finance: diposting tanpa harga acuan ITEM5 — selisih harga acuan disetujui rapat (b5r-adm@x.test, %', false)::text
      || case when (iss ->> 0) like 'override Finance: diposting tanpa harga acuan ITEM5 — selisih harga acuan disetujui rapat (b5r-adm@x.test, %' then '' else '(!)' end || '; ';
  exception when others then out := out || 'run 5: ERROR(!) ' || sqlerrm || '; '; end;

  -- the posting of cost accounting is as before: a direct update of a draft run
  perform set_config('request.jwt.claims', '{"email":"b5r-ca@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.allocation_run set status = 'posted', posted_by = 'b5r-ca@x.test', posted_at = now() where id = rs[2]; get diagnostics n = row_count;
    out := out || 'cost accounting posts the priced run directly rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'cost accounting post: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- privileges: not for anon, for signed-in users (the checks are inside), a fixed search_path
  begin
    out := out || 'execute anon=' || has_function_privilege('anon', 'public.post_allocation_override(uuid[],text)', 'execute')::text
      || ' authenticated=' || has_function_privilege('authenticated', 'public.post_allocation_override(uuid[],text)', 'execute')::text
      || case when not has_function_privilege('anon', 'public.post_allocation_override(uuid[],text)', 'execute') and has_function_privilege('authenticated', 'public.post_allocation_override(uuid[],text)', 'execute') then '' else '(!)' end || '; ';
    select count(*) into n from pg_proc p where p.oid = 'public.post_allocation_override(uuid[],text)'::regprocedure and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""');
    out := out || 'definer with search_path=""=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'privileges: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B5 A3 R61 post_allocation_override (rolled back): %', out;
end $$;

-- Q-v5.2-13: inventory_accounting and finance change week.opening_stock_flag while the week is open (the stock upload
-- writes it); released and closed weeks, every other column and every other role stay refused
do $$
declare out text := ''; n int; i int; wo uuid; wo2 uuid; wr uuid; wc uuid; r text; v text; d date;
begin
  insert into public.app_user(email, role) values ('b5w-ia@x.test','inventory_accounting'),('b5w-fin@x.test','finance'),('b5w-adm@x.test','admin'),('b5w-sales@x.test','sales'),
    ('b5w-ppic@x.test','ppic'),('b5w-purch@x.test','purchasing'),('b5w-lead@x.test','commercial_lead'),('b5w-ca@x.test','cost_accounting'),('b5w-mgmt@x.test','management');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2034-02-13', '2034-02-16', '2034-02-10') returning id into wo;
  insert into public.week (week_start, update_date, tb_opening_date) values ('2034-02-20', '2034-02-23', '2034-02-17') returning id into wo2;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2034-02-27', '2034-03-02', '2034-02-24', 'released') returning id into wr;
  insert into public.week (week_start, update_date, tb_opening_date, status) values ('2034-03-06', '2034-03-09', '2034-03-03', 'closed') returning id into wc;
  delete from public.rebuild_queue where date between '2034-02-13' and '2034-03-12';

  -- inventory accounting and finance: the flag of an open week, a changed value each time
  i := 0;
  foreach r in array array['ia', 'fin'] loop
    i := i + 1;
    perform set_config('request.jwt.claims', format('{"email":"b5w-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin update public.week set opening_stock_flag = 'carried-' || r where id = wo; get diagnostics n = row_count;
      out := out || r || ' changes opening_stock_flag of an open week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' changes opening_stock_flag of an open week: DENIED(!) ' || sqlerrm || '; '; end;
    begin update public.week set opening_stock_flag = null where id = wo; get diagnostics n = row_count;
      out := out || r || ' clears it again rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' clears it: DENIED(!) ' || sqlerrm || '; '; end;
    -- released and closed weeks: refused by the guard
    begin update public.week set opening_stock_flag = 'x-' || r where id = wr; get diagnostics n = row_count;
      out := out || r || ' changes the flag of a released week: ALLOWED rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || r || ' changes the flag of a released week: denied; ';
              when others then out := out || r || ' released week: ERROR(!) ' || sqlerrm || '; '; end;
    begin update public.week set opening_stock_flag = 'x-' || r where id = wc; get diagnostics n = row_count;
      out := out || r || ' changes the flag of a closed week: ALLOWED rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || r || ' changes the flag of a closed week: denied; ';
              when others then out := out || r || ' closed week: ERROR(!) ' || sqlerrm || '; '; end;
    -- no other column: the note, the status of a closed row, the lw_* figures, and the flag together with the note
    begin update public.week set note = 'catatan ' || r where id = wo; get diagnostics n = row_count;
      out := out || r || ' changes note: ALLOWED rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || r || ' changes note: denied; ';
              when others then out := out || r || ' note: ERROR(!) ' || sqlerrm || '; '; end;
    begin update public.week set opening_stock_flag = 'both-' || r, note = 'catatan ' || r where id = wo; get diagnostics n = row_count;
      out := out || r || ' changes the flag and the note together: ALLOWED rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || r || ' changes the flag and the note together: denied; ';
              when others then out := out || r || ' flag and note: ERROR(!) ' || sqlerrm || '; '; end;
    -- the K69 rule of update_date is untouched: a direct update of the date is refused to inventory accounting
    if r = 'ia' then
      begin update public.week set update_date = '2034-02-17' where id = wo; get diagnostics n = row_count;
        out := out || 'ia changes update_date directly: ALLOWED rows=' || n || '(!); ';
      exception when insufficient_privilege then out := out || 'ia changes update_date directly: denied; ';
                when others then out := out || 'ia update_date: ERROR(!) ' || sqlerrm || '; '; end;
    end if;
    execute 'reset role';
  end loop;

  -- every other role that can reach week by policy is still refused by the guard; management has no policy at all
  foreach r in array array['sales', 'ppic', 'purch', 'lead', 'ca'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5w-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin update public.week set opening_stock_flag = 'z-' || r where id = wo2; get diagnostics n = row_count;
      out := out || r || ' changes the flag of an open week: ALLOWED rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || r || ' changes the flag: denied; ';
              when others then out := out || r || ' flag: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '{"email":"b5w-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.week set opening_stock_flag = 'z-mgmt' where id = wo2; get diagnostics n = row_count;
    out := out || 'mgmt changes the flag rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'mgmt flag: denied(' || sqlstate || '); '; end;
  execute 'reset role';

  -- finance keeps what it had: the status between open and released, together with the flag of an open week
  perform set_config('request.jwt.claims', '{"email":"b5w-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.week set status = 'released' where id = wo2; get diagnostics n = row_count;
    out := out || 'finance opens→released rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance status: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.week set status = 'open' where id = wo2; get diagnostics n = row_count;
    out := out || 'finance released→open rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance status back: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.week set opening_stock_flag = 'with-status', status = 'released' where id = wo2; get diagnostics n = row_count;
    out := out || 'finance flag with status on an open week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance flag with status: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- admin: as before (a closed week too)
  perform set_config('request.jwt.claims', '{"email":"b5w-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.week set opening_stock_flag = 'adm' where id = wc; get diagnostics n = row_count;
    out := out || 'admin changes the flag of a closed week rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin flag: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select opening_stock_flag into v from public.week where id = wo; out := out || 'open week flag after the refused attempts=' || coalesce(v, 'null') || case when v is null then '' else '(!)' end || '; ';
  select count(*) into n from public.week where id in (wr, wc) and coalesce(opening_stock_flag, '') like 'x-%'; out := out || 'released/closed weeks changed=' || n || case when n = 0 then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B5 Q-v5.2-13 opening_stock_flag (rolled back): %', out;
end $$;

-- Q-v5.2-18: the two Sales views also hide holding_loss_per_day and downgrade_risk_rp unless the viewer sees cost
-- (sales_sees_cost, no parameter row = hidden); list price and the rest stay; column lists as B2
do $$
declare out text := ''; n int; r record; cols text; v text;
  cols_v4 text := 'date:date, key:text, group_code:text, form:text, free_fresh_kg:numeric(12,2), free_frozen_kg:numeric(12,2), oldest_age_days:integer(32,0), hours_to_cutoff:integer(32,0), cost_per_kg_ma:numeric(18,4), price_floor:numeric(18,4), price_list:numeric(18,4), margin_per_kg_list:numeric(18,4), realized_price_7d:numeric(18,4), margin_per_kg_realized:numeric(18,4), holding_loss_per_day:numeric(18,2), downgrade_risk_rp:numeric(18,2), urgency:text, priority_score:numeric(18,2), rank:integer(32,0), ordered_today_kg:numeric(12,2)';
  cols_v5 text;
begin
  cols_v5 := cols_v4 || ', cost_per_kg:numeric(18,4), cost_status:text, cost_check:boolean';
  insert into public.app_user(email, role) values ('b5v-sales@x.test','sales'),('b5v-mgmt@x.test','management'),('b5v-adm@x.test','admin'),('b5v-fin@x.test','finance'),('b5v-lead@x.test','commercial_lead');
  insert into public.sales_assignment (sales_rep, email, key) values ('B5V', 'b5v-sales@x.test', 'B5V-A');
  insert into public.week (week_start, update_date, tb_opening_date) values ('2034-03-13', '2034-03-16', '2034-03-10'), ('2034-03-20', '2034-03-23', '2034-03-17'), ('2034-04-03', '2034-04-06', '2034-03-31');
  insert into public.parameter (week_id, sales_sees_cost) select id, false from public.week where week_start = '2034-03-13' on conflict (week_id) do update set sales_sees_cost = false;
  insert into public.parameter (week_id, sales_sees_cost) select id, true from public.week where week_start = '2034-03-20' on conflict (week_id) do update set sales_sees_cost = true;
  delete from public.parameter p using public.week w where p.week_id = w.id and w.week_start = '2034-04-03';
  -- 2034-03-14: sales_sees_cost = false; 03-21: true; 03-29: no week row; 04-04: week without a parameter row
  insert into public.commercial_daily (date, key, group_code, free_fresh_kg, cost_per_kg_ma, cost_per_kg_si, price_floor, price_list, margin_per_kg_list, realized_price_7d, margin_per_kg_realized,
                                       holding_loss_per_day, downgrade_risk_rp, cost_per_kg, cost_status, cost_check)
  values ('2034-03-14', 'B5V-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 111, 222, 20900, 'final', true),
         ('2034-03-21', 'B5V-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 111, 222, 20900, 'final', true),
         ('2034-03-29', 'B5V-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 111, 222, 20900, 'final', true),
         ('2034-04-04', 'B5V-A', 'G', 10, 21000, 21100, 23000, 26000, 5000, 25500, 4500, 111, 222, 20900, 'final', true);

  perform set_config('request.jwt.claims', '{"email":"b5v-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    select count(*) as n, count(holding_loss_per_day) + count(downgrade_risk_rp) as shown, count(cost_per_kg_ma) + count(price_floor) as old_shown, max(price_list) as pl, max(urgency) as ur
      into r from public.commercial_daily_sales where date = '2034-03-14';
    out := out || 'v4 view sales_sees_cost=false rows=' || r.n || ' holding_loss / downgrade_risk shown=' || r.shown || case when r.n = 1 and r.shown = 0 and r.old_shown = 0 then '' else '(!)' end
      || '; list price stays=' || coalesce(r.pl::text, 'null') || case when r.pl = 26000 then '' else '(!)' end || '; ';
  exception when others then out := out || 'v4 view: ERROR(!) ' || sqlerrm || '; '; end;
  begin
    select count(*) as n, count(holding_loss_per_day) + count(downgrade_risk_rp) as shown, count(cost_per_kg) + count(cost_status) + count(cost_check) as v5_shown, max(realized_price_7d) as rp
      into r from public.commercial_daily_sales_v5 where date = '2034-03-14';
    out := out || 'v5 view sales_sees_cost=false rows=' || r.n || ' holding_loss / downgrade_risk shown=' || r.shown || case when r.n = 1 and r.shown = 0 and r.v5_shown = 0 then '' else '(!)' end
      || '; realized price stays=' || coalesce(r.rp::text, 'null') || case when r.rp = 25500 then '' else '(!)' end || '; ';
  exception when others then out := out || 'v5 view: ERROR(!) ' || sqlerrm || '; '; end;
  -- sales_sees_cost = true: the values are there, both views
  begin
    select count(holding_loss_per_day) + count(downgrade_risk_rp) as shown, max(holding_loss_per_day) as h, max(downgrade_risk_rp) as d into r from public.commercial_daily_sales where date = '2034-03-21';
    out := out || 'v4 view sales_sees_cost=true shown=' || r.shown || ' (' || coalesce(r.h::text, 'null') || ' / ' || coalesce(r.d::text, 'null') || ')' || case when r.shown = 2 and r.h = 111 and r.d = 222 then '' else '(!)' end || '; ';
    select count(holding_loss_per_day) + count(downgrade_risk_rp) as shown into r from public.commercial_daily_sales_v5 where date = '2034-03-21';
    out := out || 'v5 view sales_sees_cost=true shown=' || r.shown || case when r.shown = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sees_cost=true: ERROR(!) ' || sqlerrm || '; '; end;
  -- no parameter row for the week, or no week: hidden
  begin
    select count(*) as n, count(holding_loss_per_day) + count(downgrade_risk_rp) as shown into r from public.commercial_daily_sales_v5 where date = '2034-04-04';
    out := out || 'v5 view week without parameter row rows=' || r.n || ' shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
    select count(*) as n, count(holding_loss_per_day) + count(downgrade_risk_rp) as shown into r from public.commercial_daily_sales where date = '2034-04-04';
    out := out || 'v4 view week without parameter row rows=' || r.n || ' shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
    select count(*) as n, count(holding_loss_per_day) + count(downgrade_risk_rp) as shown into r from public.commercial_daily_sales_v5 where date = '2034-03-29';
    out := out || 'v5 view date without a week rows=' || r.n || ' shown=' || r.shown || case when r.n = 1 and r.shown = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'no parameter: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- everyone who is not Sales sees both columns, in both views, whatever sales_sees_cost says
  foreach v in array array['b5v-mgmt', 'b5v-adm', 'b5v-fin', 'b5v-lead'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', v), true);
    execute 'set local role authenticated';
    begin
      select count(holding_loss_per_day) + count(downgrade_risk_rp) as shown, count(*) as n into r from public.commercial_daily_sales_v5 where date in ('2034-03-14', '2034-04-04') and key = 'B5V-A';
      out := out || v || ' v5 view shown=' || r.shown || case when r.n = 2 and r.shown = 4 then '' else '(!)' end || '; ';
      select count(holding_loss_per_day) + count(downgrade_risk_rp) as shown, count(*) as n into r from public.commercial_daily_sales where date in ('2034-03-14', '2034-04-04') and key = 'B5V-A';
      out := out || v || ' v4 view shown=' || r.shown || case when r.n = 2 and r.shown = 4 then '' else '(!)' end || '; ';
    exception when others then out := out || v || ': ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- the column lists (names, order, types) are those of B2
  select string_agg(column_name || ':' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales';
  out := out || 'v4 view columns unchanged=' || (cols = cols_v4)::text || case when cols = cols_v4 then '' else '(!)' end || '; ';
  select string_agg(column_name || ':' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'commercial_daily_sales_v5';
  out := out || 'v5 view columns unchanged=' || (cols = cols_v5)::text || case when cols = cols_v5 then '' else '(!)' end || '; ';
  out := out || 'anon on views: v4=' || has_table_privilege('anon', 'public.commercial_daily_sales', 'select')::text || ' v5=' || has_table_privilege('anon', 'public.commercial_daily_sales_v5', 'select')::text
    || case when has_table_privilege('anon', 'public.commercial_daily_sales', 'select') or has_table_privilege('anon', 'public.commercial_daily_sales_v5', 'select') then '(!)' else '' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B5 Q-v5.2-18 views holding_loss downgrade_risk (rolled back): %', out;
end $$;

-- Q-v5.2-18: price_floor_rule (the markup per key, the recipe of the floor) is not read by Sales; every other role that
-- read it reads it as before, and nobody gains a write right
do $$
declare out text := ''; n int; v text; i int;
begin
  insert into public.app_user(email, role) values ('b5p-sales@x.test','sales'),('b5p-lead@x.test','commercial_lead'),('b5p-fin@x.test','finance'),('b5p-adm@x.test','admin'),
    ('b5p-mgmt@x.test','management'),('b5p-ppic@x.test','ppic'),('b5p-ca@x.test','cost_accounting'),('b5p-od@x.test','operations_director');
  insert into public.price_floor_rule (key, group_code, markup_rp_per_kg, note) values ('B5P-K', null, 500, 'b5-test');
  select count(*) into n from public.price_floor_rule; i := n;

  perform set_config('request.jwt.claims', '{"email":"b5p-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*) into n from public.price_floor_rule; out := out || 'sales reads price_floor_rule rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when insufficient_privilege then out := out || 'sales reads price_floor_rule: denied; ';
            when others then out := out || 'sales read: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.price_floor_rule (key, markup_rp_per_kg, note) values ('B5P-S', 1, 'b5-sales'); out := out || 'sales writes a floor rule: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales writes a floor rule: denied; ';
            when others then out := out || 'sales write: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  foreach v in array array['lead', 'fin', 'adm', 'mgmt', 'ppic', 'ca', 'od'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5p-%s@x.test","role":"authenticated"}', v), true);
    execute 'set local role authenticated';
    begin select count(*) into n from public.price_floor_rule where note = 'b5-test'; out := out || v || ' reads price_floor_rule rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    exception when others then out := out || v || ' read: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  -- the writers are as before: commercial lead, finance and admin write; management does not
  perform set_config('request.jwt.claims', '{"email":"b5p-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.price_floor_rule (key, markup_rp_per_kg, note) values ('B5P-L', 2, 'b5-lead'); out := out || 'commercial lead writes a floor rule: OK; ';
  exception when others then out := out || 'commercial lead write: DENIED(!) ' || sqlerrm || '; '; end;
  begin select count(*) into n from public.price_floor_rule where note = 'b5-lead'; out := out || 'and reads it back=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'read back: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.price_floor_rule set markup_rp_per_kg = 650 where note = 'b5-test'; get diagnostics n = row_count;
    out := out || 'commercial lead changes a markup rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'commercial lead changes a markup: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  -- the audit trail keeps the old and new markup; Sales read audit_log, but not the rows of this table
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.audit_log where table_name = 'price_floor_rule' and op = 'UPDATE' and actor = 'b5p-lead@x.test' and changes ? 'markup_rp_per_kg';
  out := out || 'audit rows of the markup change (owner reads)=' || n || case when n = 1 then '' else '(!)' end || '; ';
  foreach v in array array['sales', 'lead', 'fin', 'mgmt', 'ppic'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5p-%s@x.test","role":"authenticated"}', v), true);
    execute 'set local role authenticated';
    begin select count(*) into n from public.audit_log where table_name = 'price_floor_rule';
      out := out || v || ' reads the audit rows of price_floor_rule=' || n || case when (v = 'sales' and n = 0) or (v <> 'sales' and n >= 1) then '' else '(!)' end || '; ';
    exception when others then out := out || v || ' audit read: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  begin
    perform set_config('request.jwt.claims', '{"email":"b5p-sales@x.test","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into n from public.audit_log where table_name in ('app_user', 'week', 'sales_line', 'parameter');
    out := out || 'sales still read the audit rows of other tables (not redacted)=' || (n > 0)::text || case when n > 0 then '' else '(!)' end || '; ';
    execute 'reset role';
  exception when others then execute 'reset role'; out := out || 'audit other tables: ERROR(!) ' || sqlerrm || '; '; end;
  perform set_config('request.jwt.claims', '{"email":"b5p-mgmt@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.price_floor_rule (key, markup_rp_per_kg, note) values ('B5P-M', 3, 'b5-mgmt'); out := out || 'management writes a floor rule: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'management writes a floor rule: denied; ';
            when others then out := out || 'management write: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  -- a signed-in user who is not an app user reads nothing; the floor rules still shape the floor for the C38 triggers (owner)
  perform set_config('request.jwt.claims', '{"email":"b5p-stranger@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*) into n from public.price_floor_rule; out := out || 'stranger reads price_floor_rule rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'stranger read: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.price_floor_rule; out := out || 'the owner still reads all rows=' || n || case when n >= i then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B5 Q-v5.2-18 price_floor_rule (rolled back): %', out;
end $$;

-- B-R86 (K70, O25–O27): fs_statement_line and fs_line_map — read by admin, finance, management, operations_director;
-- written by finance and admin; Sales, PPIC and the other roles read nothing and write nothing; anon has no privilege; a row
-- with locked_at changes and disappears for nobody (Admin and the owner included); the seed of fs_line_map is the 15
-- draft rows of the minimum mapping
do $$
declare out text := ''; n int; i int; r text; v text; sha text := repeat('ab', 32); fid uuid; fid2 uuid; lk timestamptz; st text; ub text; amt numeric; cnt int; roles text[];
begin
  insert into public.app_user(email, role) values ('b5f-fin@x.test','finance'),('b5f-adm@x.test','admin'),('b5f-mgmt@x.test','management'),('b5f-od@x.test','operations_director'),
    ('b5f-sales@x.test','sales'),('b5f-ppic@x.test','ppic'),('b5f-purch@x.test','purchasing'),('b5f-lead@x.test','commercial_lead'),('b5f-ca@x.test','cost_accounting'),('b5f-ia@x.test','inventory_accounting');
  begin
    insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 12, 'Revenue', 8361760903, 'fs-uji.xlsx', sha) returning id into fid;
    insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'BS', 'BS - Management Report', 14, 'Cash and cash equivalents', 495363150.28, 'fs-uji.xlsx', sha) returning id into fid2;
    out := out || 'setup: two rows inserted by the owner; ';
  exception when others then out := out || 'setup fs_statement_line: ERROR(!) ' || sqlerrm || '; '; end;

  -- reading: the four readers see rows; every other role (and a stranger) sees none of either table
  roles := array['fin', 'adm', 'mgmt', 'od'];
  foreach r in array roles loop
    perform set_config('request.jwt.claims', format('{"email":"b5f-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin select count(*) into n from public.fs_statement_line where month = '2034-04-01'; select count(*) into cnt from public.fs_line_map;
      out := out || r || ' reads fs_statement_line=' || n || ' fs_line_map=' || cnt || case when n = 2 and cnt = 15 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' reads: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  foreach r in array array['sales', 'ppic', 'purch', 'lead', 'ca', 'ia', 'stranger'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5f-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin select count(*) into n from public.fs_statement_line; select count(*) into cnt from public.fs_line_map;
      out := out || r || ' reads fs_statement_line=' || n || ' fs_line_map=' || cnt || case when n = 0 and cnt = 0 then '' else '(!)' end || '; ';
    exception when insufficient_privilege then out := out || r || ' reads: denied; ';
              when others then out := out || r || ' reads: ERROR(!) ' || sqlerrm || '; '; end;
    if r <> 'stranger' then
      begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 99, 'x', 1, 'x.xlsx', sha);
        out := out || r || ' inserts a FS row: ALLOWED(!); ';
      exception when insufficient_privilege then out := out || r || ' inserts a FS row: denied; ';
                when others then out := out || r || ' insert: ERROR(!) ' || sqlerrm || '; '; end;
      begin insert into public.fs_line_map (statement, row_no, app_line, sign) values ('PL', 99, 'x', 1);
        out := out || r || ' inserts a mapping row: ALLOWED(!); ';
      exception when insufficient_privilege then out := out || r || ' inserts a mapping row: denied; ';
                when others then out := out || r || ' insert map: ERROR(!) ' || sqlerrm || '; '; end;
    end if;
    execute 'reset role';
  end loop;

  -- management and operations director read only: no insert, an update or a delete touches no row
  foreach r in array array['mgmt', 'od'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5f-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 98, 'x', 1, 'x.xlsx', sha);
      out := out || r || ' inserts a FS row: ALLOWED(!); ';
    exception when insufficient_privilege then out := out || r || ' inserts a FS row: denied; ';
              when others then out := out || r || ' insert: ERROR(!) ' || sqlerrm || '; '; end;
    begin update public.fs_statement_line set amount = 1 where id = fid; get diagnostics n = row_count; out := out || r || ' updates a FS row rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' update: ERROR(!) ' || sqlerrm || '; '; end;
    begin delete from public.fs_statement_line where id = fid; get diagnostics n = row_count; out := out || r || ' deletes a FS row rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' delete: ERROR(!) ' || sqlerrm || '; '; end;
    begin update public.fs_line_map set status = 'agreed' where statement = 'PL' and row_no = 12; get diagnostics n = row_count; out := out || r || ' agrees a mapping rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' agree: ERROR(!) ' || sqlerrm || '; '; end;
    begin delete from public.fs_line_map where statement = 'PL' and row_no = 12; get diagnostics n = row_count; out := out || r || ' deletes a mapping rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' delete map: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;

  -- finance writes: a row, a second version (the correction), checks of the columns, an update and a delete before the lock
  perform set_config('request.jwt.claims', '{"email":"b5f-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 13, 'Cost of Sales', -8055051145.97, 'fs-uji.xlsx', sha) returning id into fid;
    out := out || 'finance inserts a FS row: OK; ';
  exception when others then out := out || 'finance inserts a FS row: DENIED(!) ' || sqlerrm || '; '; end;
  begin select created_by into v from public.fs_statement_line where id = fid; out := out || 'created_by=' || coalesce(v, 'null') || case when v = 'b5f-fin@x.test' then '' else '(!)' end || '; ';
  exception when others then out := out || 'created_by: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256, version) values ('2034-04-01', 'PL', 'PL - Management Report', 13, 'Cost of Sales', -8055051146.00, 'fs-uji-2.xlsx', sha, 2);
    out := out || 'finance inserts version 2 of the same row: OK; ';
  exception when others then out := out || 'version 2: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 13, 'Cost of Sales', 1, 'fs-uji.xlsx', sha);
    out := out || 'same month, statement, row and version twice: ALLOWED(!); ';
  exception when unique_violation then out := out || 'same month, statement, row and version twice: refused (23505); ';
            when others then out := out || 'duplicate: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-15', 'PL', 'PL - Management Report', 1, 'x', 1, 'x.xlsx', sha);
    out := out || 'month not the first day: ALLOWED(!); ';
  exception when check_violation then out := out || 'month not the first day: refused (23514); ';
            when others then out := out || 'month: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'CF', 'CF', 1, 'x', 1, 'x.xlsx', sha);
    out := out || 'statement CF: ALLOWED(!); ';
  exception when check_violation then out := out || 'statement CF: refused (23514); ';
            when others then out := out || 'statement: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 2, 'x', 1, 'x.xlsx', 'abc');
    out := out || 'sha256 that is not 64 hex characters: ALLOWED(!); ';
  exception when check_violation then out := out || 'sha256 that is not 64 hex characters: refused (23514); ';
            when others then out := out || 'sha256: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'PL', 'PL - Management Report', 3, 'Row without a number', null, 'fs-uji.xlsx', sha);
    out := out || 'a row without a number (amount null): OK; ';
  exception when others then out := out || 'amount null: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256, version) values ('2034-04-01', 'PL', 'PL - Management Report', 4, 'x', 1, 'x.xlsx', sha, 0);
    out := out || 'version 0: ALLOWED(!); ';
  exception when check_violation then out := out || 'version 0: refused (23514); ';
            when others then out := out || 'version: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.fs_statement_line set amount = -8055051145.98 where id = fid; get diagnostics n = row_count; out := out || 'finance updates an unlocked row rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance updates an unlocked row: DENIED(!) ' || sqlerrm || '; '; end;
  begin delete from public.fs_statement_line where month = '2034-04-01' and row_no = 3; get diagnostics n = row_count; out := out || 'finance deletes an unlocked row rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance deletes an unlocked row: DENIED(!) ' || sqlerrm || '; '; end;
  -- the lock: set locked_at; from then on nobody changes or deletes the row, and the lock itself is not undone
  begin update public.fs_statement_line set locked_at = now() where id = fid; get diagnostics n = row_count; out := out || 'finance locks the row rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance locks: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.fs_statement_line set amount = 1 where id = fid; get diagnostics n = row_count; out := out || 'finance updates the locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'finance updates the locked row: refused (42501); ';
            when others then out := out || 'finance update locked: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.fs_statement_line set locked_at = null where id = fid; get diagnostics n = row_count; out := out || 'finance unlocks the row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'finance unlocks the row: refused (42501); ';
            when others then out := out || 'finance unlock: ERROR(!) ' || sqlerrm || '; '; end;
  begin delete from public.fs_statement_line where id = fid; get diagnostics n = row_count; out := out || 'finance deletes the locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'finance deletes the locked row: refused (42501); ';
            when others then out := out || 'finance delete locked: ERROR(!) ' || sqlerrm || '; '; end;
  -- the other rows stay free: a correction of a locked month is a new version
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256, version) values ('2034-04-01', 'PL', 'PL - Management Report', 13, 'Cost of Sales', -8055051146.50, 'fs-uji-3.xlsx', sha, 3);
    out := out || 'a new version next to the locked one: OK; ';
  exception when others then out := out || 'new version: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';

  -- Admin writes too, and is stopped by the lock as well; so is the owner (no role set)
  perform set_config('request.jwt.claims', '{"email":"b5f-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.fs_statement_line (month, statement, sheet, row_no, line, amount, source_file, source_sha256) values ('2034-04-01', 'BS', 'BS - Management Report', 17, 'Trade Receivables - Third Parties', 511953961, 'fs-uji.xlsx', sha);
    out := out || 'admin inserts a FS row: OK; ';
  exception when others then out := out || 'admin inserts a FS row: DENIED(!) ' || sqlerrm || '; '; end;
  begin update public.fs_statement_line set amount = 2 where id = fid; get diagnostics n = row_count; out := out || 'admin updates the locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin updates the locked row: refused (42501); ';
            when others then out := out || 'admin update locked: ERROR(!) ' || sqlerrm || '; '; end;
  begin delete from public.fs_statement_line where id = fid; get diagnostics n = row_count; out := out || 'admin deletes the locked row: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin deletes the locked row: refused (42501); ';
            when others then out := out || 'admin delete locked: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.fs_statement_line set amount = 3 where id = fid2; get diagnostics n = row_count; out := out || 'admin updates an unlocked row rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin updates an unlocked row: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin update public.fs_statement_line set amount = 4 where id = fid; out := out || 'the owner updates the locked row: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'the owner updates the locked row: refused (42501); ';
            when others then out := out || 'owner update locked: ERROR(!) ' || sqlerrm || '; '; end;
  begin delete from public.fs_statement_line where id = fid; out := out || 'the owner deletes the locked row: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'the owner deletes the locked row: refused (42501); ';
            when others then out := out || 'owner delete locked: ERROR(!) ' || sqlerrm || '; '; end;
  begin select amount into amt from public.fs_statement_line where id = fid; out := out || 'locked row amount after all attempts=' || coalesce(amt::text, 'null') || case when amt = -8055051145.98 then '' else '(!)' end || '; ';
  exception when others then out := out || 'locked row: ERROR(!) ' || sqlerrm || '; '; end;
  -- the audit trail records who wrote and who locked
  begin select count(*) into n from public.audit_log where table_name = 'fs_statement_line' and row_id = fid::text and op = 'UPDATE' and changes ? 'locked_at' and actor = 'b5f-fin@x.test';
    out := out || 'audit rows of the lock by finance=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'audit: ERROR(!) ' || sqlerrm || '; '; end;

  -- the audit trail copies old and new amounts of an update or a delete: only the readers of the tables read it
  begin select count(*) into n from public.audit_log where table_name = 'fs_statement_line' and op in ('UPDATE', 'DELETE') and changes is not null;
    out := out || 'audit rows of fs_statement_line (owner reads)=' || (n >= 2)::text || case when n >= 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'audit owner: ERROR(!) ' || sqlerrm || '; '; end;
  foreach r in array array['fin', 'adm', 'mgmt', 'od', 'sales', 'ppic', 'purch', 'lead', 'ca', 'ia', 'stranger'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5f-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin select count(*) into n from public.audit_log where table_name in ('fs_statement_line', 'fs_line_map');
      out := out || r || ' reads the audit rows of the FS tables=' || case when n > 0 then 'some' else '0' end
        || case when (r in ('fin', 'adm', 'mgmt', 'od') and n > 0) or (r not in ('fin', 'adm', 'mgmt', 'od') and n = 0) then '' else '(!)' end || '; ';
    exception when others then out := out || r || ' audit read: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- anon: nothing; authenticated cannot truncate (a truncate would skip the lock)
  begin
    out := out || 'anon privileges on fs_statement_line / fs_line_map=' || (has_table_privilege('anon', 'public.fs_statement_line', 'select') or has_table_privilege('anon', 'public.fs_statement_line', 'insert')
        or has_table_privilege('anon', 'public.fs_statement_line', 'update') or has_table_privilege('anon', 'public.fs_statement_line', 'delete')
        or has_table_privilege('anon', 'public.fs_line_map', 'select') or has_table_privilege('anon', 'public.fs_line_map', 'insert')
        or has_table_privilege('anon', 'public.fs_line_map', 'update') or has_table_privilege('anon', 'public.fs_line_map', 'delete'))::text
      || case when has_table_privilege('anon', 'public.fs_statement_line', 'select') or has_table_privilege('anon', 'public.fs_line_map', 'select') or has_table_privilege('anon', 'public.fs_statement_line', 'delete')
                    or has_table_privilege('anon', 'public.fs_statement_line', 'insert') or has_table_privilege('anon', 'public.fs_statement_line', 'update')
                    or has_table_privilege('anon', 'public.fs_line_map', 'insert') or has_table_privilege('anon', 'public.fs_line_map', 'update') or has_table_privilege('anon', 'public.fs_line_map', 'delete') then '(!)' else '' end || '; ';
    out := out || 'authenticated truncate / references / trigger on the two tables=' || (has_table_privilege('authenticated', 'public.fs_statement_line', 'truncate') or has_table_privilege('authenticated', 'public.fs_line_map', 'truncate')
        or has_table_privilege('authenticated', 'public.fs_statement_line', 'references') or has_table_privilege('authenticated', 'public.fs_statement_line', 'trigger'))::text
      || case when has_table_privilege('authenticated', 'public.fs_statement_line', 'truncate') or has_table_privilege('authenticated', 'public.fs_line_map', 'truncate')
                    or has_table_privilege('authenticated', 'public.fs_statement_line', 'references') or has_table_privilege('authenticated', 'public.fs_statement_line', 'trigger') then '(!)' else '' end || '; ';
    out := out || 'row level security on=' || (select string_agg(c.relname || ':' || c.relrowsecurity::text, ',' order by c.relname) from pg_class c where c.oid in ('public.fs_statement_line'::regclass, 'public.fs_line_map'::regclass))
      || case when (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.fs_statement_line'::regclass, 'public.fs_line_map'::regclass)) then '' else '(!)' end || '; ';
  exception when others then out := out || 'privileges: ERROR(!) ' || sqlerrm || '; '; end;
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
    begin select count(*) into n from public.fs_statement_line; out := out || 'anon reads fs_statement_line rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || 'anon reads fs_statement_line: denied; '; end;
    begin select count(*) into n from public.fs_line_map; out := out || 'anon reads fs_line_map rows=' || n || '(!); ';
    exception when insufficient_privilege then out := out || 'anon reads fs_line_map: denied; '; end;
    execute 'reset role';
  exception when others then execute 'reset role'; out := out || 'anon: ERROR(!) ' || sqlerrm || '; '; end;
  perform set_config('request.jwt.claims', '', true);

  -- fs_line_map: the seed, then Finance's edits
  begin
    select count(*), count(*) filter (where status = 'draft'), count(*) filter (where sign = 1) into n, cnt, i from public.fs_line_map;
    out := out || 'seed rows=' || n || ' draft=' || cnt || ' sign 1=' || i || case when n = 15 and cnt = 15 and i = 15 then '' else '(!)' end || '; ';
    select count(*) into n from public.fs_line_map where (statement, row_no, app_line) in (('PL', 12, 'revenue'), ('PL', 13, 'cogs'), ('PL', 15, 'gp'), ('PL', 37, 'opex'), ('PL', 49, 'other'), ('PL', 51, 'nibt'),
      ('BS', 14, 'kas'), ('BS', 17, 'piutang_pihak_ketiga'), ('BS', 18, 'piutang_pihak_berelasi'), ('BS', 23, 'persediaan_produk'), ('BS', 24, 'persediaan_trading'),
      ('BS', 47, 'utang_dagang_pihak_ketiga'), ('BS', 48, 'utang_dagang_afiliasi'), ('BS', 51, 'utang_lain_afiliasi'), ('BS', 77, 'ekuitas'));
    out := out || 'seed pairs of the minimum mapping=' || n || case when n = 15 then '' else '(!)' end || '; ';
  exception when others then out := out || 'seed: ERROR(!) ' || sqlerrm || '; '; end;
  perform set_config('request.jwt.claims', '{"email":"b5f-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.fs_line_map set status = 'agreed', note = 'disetujui Finance' where statement = 'PL' and row_no = 12; get diagnostics n = row_count;
    out := out || 'finance agrees PL b.12 rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select status, updated_by into st, ub from public.fs_line_map where statement = 'PL' and row_no = 12;
    out := out || 'status=' || st || ' updated_by=' || coalesce(ub, 'null') || case when st = 'agreed' and ub = 'b5f-fin@x.test' then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance agrees: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign, note) values ('PL', 18, 'delivery', -1, 'baris tambahan oleh Finance'); out := out || 'finance adds a mapping row (status defaults to draft): OK; ';
    select status into st from public.fs_line_map where statement = 'PL' and row_no = 18; out := out || 'new row status=' || st || case when st = 'draft' then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance adds a mapping: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign) values ('PL', 12, 'revenue', 1); out := out || 'a second pair for PL b.12: ALLOWED(!); ';
  exception when unique_violation then out := out || 'a second pair for PL b.12: refused (23505); ';
            when others then out := out || 'second pair: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign) values ('PL', 19, 'x', 2); out := out || 'sign 2: ALLOWED(!); ';
  exception when check_violation then out := out || 'sign 2: refused (23514); ';
            when others then out := out || 'sign: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign) values ('PL', 19, 'x', 0); out := out || 'sign 0: ALLOWED(!); ';
  exception when check_violation then out := out || 'sign 0: refused (23514); ';
            when others then out := out || 'sign 0: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign, status) values ('PL', 19, 'x', 1, 'approved'); out := out || 'status approved: ALLOWED(!); ';
  exception when check_violation then out := out || 'status approved: refused (23514); ';
            when others then out := out || 'status: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign) values ('CF', 19, 'x', 1); out := out || 'statement CF: ALLOWED(!); ';
  exception when check_violation then out := out || 'statement CF in the map: refused (23514); ';
            when others then out := out || 'map statement: ERROR(!) ' || sqlerrm || '; '; end;
  begin insert into public.fs_line_map (statement, row_no, app_line, sign) values ('PL', 19, '  ', 1); out := out || 'blank app_line: ALLOWED(!); ';
  exception when check_violation then out := out || 'blank app_line: refused (23514); ';
            when others then out := out || 'app_line: ERROR(!) ' || sqlerrm || '; '; end;
  begin delete from public.fs_line_map where statement = 'PL' and row_no = 18; get diagnostics n = row_count; out := out || 'finance deletes the row it added rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance deletes a mapping: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b5f-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.fs_line_map set app_line = 'gp_ubah' where statement = 'PL' and row_no = 15; get diagnostics n = row_count; out := out || 'admin edits a mapping rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'admin edits a mapping: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise exception 'RLS-RESULTS v5.2 B5 B-R86 fs_statement_line fs_line_map (rolled back): %', out;
end $$;

-- B-R86 C59: the override policy row exists and is Finance's alone; Finance records the override, nobody else can
do $$
declare out text := ''; n int; r text; roles text[]; ar text[];
begin
  insert into public.app_user(email, role) values ('b5c-fin@x.test','finance'),('b5c-adm@x.test','admin'),('b5c-ca@x.test','cost_accounting'),('b5c-sales@x.test','sales'),
    ('b5c-ppic@x.test','ppic'),('b5c-mgmt@x.test','management');
  begin select allowed_roles into ar from public.release_override_policy where code = 'C59';
    out := out || 'policy C59 allowed_roles=' || coalesce(ar::text, 'none') || case when ar = array['finance'] then '' else '(!)' end || '; ';
    select count(*) into n from public.release_override_policy where code = 'C59' and coalesce(note, '') like '%O25%';
    out := out || 'policy C59 cites O25–O27=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'policy: ERROR(!) ' || sqlerrm || '; '; end;
  perform set_config('request.jwt.claims', '{"email":"b5c-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2034-04-01:FINAL', 'C59', 'selisih ekuitas awal FS Rp 2,71 (b.71)', 'FS v2 BS b.71');
    out := out || 'finance records override C59: OK; ';
  exception when others then out := out || 'finance override C59: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2034-05-01:FINAL', 'C59', 'pendek', 'x');
    out := out || 'finance override C59 with a short reason: ALLOWED(!); ';
  exception when check_violation then out := out || 'finance override C59 with a short reason: refused (23514); ';
            when others then out := out || 'short reason: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  foreach r in array array['adm', 'ca', 'sales', 'ppic', 'mgmt'] loop
    perform set_config('request.jwt.claims', format('{"email":"b5c-%s@x.test","role":"authenticated"}', r), true);
    execute 'set local role authenticated';
    begin insert into public.release_override (scope_kind, scope, code, reason, evidence) values ('month', '2034-06-01:FINAL', 'C59', 'alasan yang cukup panjang untuk uji', 'bukti');
      out := out || r || ' records override C59: ALLOWED(!); ';
    exception when insufficient_privilege then out := out || r || ' records override C59: denied; ';
              when others then out := out || r || ' override C59: ERROR(!) ' || sqlerrm || '; '; end;
    execute 'reset role';
  end loop;
  -- the policy is changed by migrations only (B2): Admin cannot widen it
  perform set_config('request.jwt.claims', '{"email":"b5c-adm@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.release_override_policy set allowed_roles = array['finance', 'admin'] where code = 'C59'; get diagnostics n = row_count;
    out := out || 'admin widens policy C59: ALLOWED rows=' || n || '(!); ';
  exception when insufficient_privilege then out := out || 'admin widens policy C59: denied; ';
            when others then out := out || 'widen: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select allowed_roles into ar from public.release_override_policy where code = 'C59'; out := out || 'policy C59 after the attempt=' || coalesce(ar::text, 'none') || case when ar = array['finance'] then '' else '(!)' end || '; ';
  raise exception 'RLS-RESULTS v5.2 B5 B-R86 C59 (rolled back): %', out;
end $$;

-- v5.2 B5 hygiene: the new definer function and trigger functions, nothing of B5 for anon, one function per name, the
-- registry in order (the B2 hygiene block above keeps running over every function of the schema)
do $$
declare out text := ''; bad text; n int; f text; v text;
begin
  begin
    select string_agg(version, ',' order by version) into bad from public.schema_registry where version in ('5.2.3', '5.2.4');
    out := out || 'registry has ' || coalesce(bad, 'none') || case when bad = '5.2.3,5.2.4' then '' else '(!)' end || '; ';
    v := public.schema_version();
    out := out || 'schema_version()=' || coalesce(v, 'null') || case when string_to_array(v, '.')::int[] >= array[5,2,4] then '' else '(!)' end || '; ';
  exception when others then out := out || 'registry: ERROR(!) ' || sqlerrm || '; '; end;
  -- the helpers of the triggers are not callable by clients; the override function is for signed-in users, never anon
  foreach f in array array['public.tg_fs_statement_line_lock()', 'public.tg_plan_check_reason_scope()'] loop
    begin
      if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then out := out || f || ' executable by clients(!); '; end if;
    exception when others then out := out || f || ': MISSING(!); '; end;
  end loop;
  out := out || 'trigger functions checked for clients; ';
  begin
    select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
    out := out || 'SECURITY DEFINER functions without a fixed search_path=' || coalesce(bad, 'none') || case when bad is null then '' else '(!)' end || '; ';
    select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
    out := out || 'SECURITY DEFINER functions executable by anon=' || coalesce(bad, 'none') || case when bad is null then '' else '(!)' end || '; ';
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('post_allocation_override', 'tg_week_guard', 'tg_fs_statement_line_lock', 'tg_plan_check_reason_scope');
    out := out || 'one function per name (no overload)=' || n || case when n = 4 then '' else '(!)' end || '; ';
  exception when others then out := out || 'functions: ERROR(!) ' || sqlerrm || '; '; end;
  -- the two new tables and the two re-created views: nothing for anon (older tables keep the default privileges of the
  -- platform and are closed by RLS alone: no policy of theirs names anon)
  begin
    select string_agg(x, ', ') into bad from unnest(array['public.fs_statement_line', 'public.fs_line_map', 'public.commercial_daily_sales', 'public.commercial_daily_sales_v5']) x
     where has_table_privilege('anon', x, 'select') or has_table_privilege('anon', x, 'insert') or has_table_privilege('anon', x, 'update') or has_table_privilege('anon', x, 'delete');
    out := out || 'tables and views of B5 with anon privileges=' || coalesce(bad, 'none') || case when bad is null then '' else '(!)' end || '; ';
  exception when others then out := out || 'anon table privileges: ERROR(!) ' || sqlerrm || '; '; end;
  -- the two audit_log policies of B5: the FS tables' trail for their readers (restrictive), price_floor_rule added to the Sales redaction
  begin
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'audit_log'
       and ((policyname = 'audit_log_fs_redact' and permissive = 'RESTRICTIVE' and qual like '%fs_statement_line%' and qual like '%operations_director%')
         or (policyname = 'audit_log_sales_redact' and permissive = 'RESTRICTIVE' and qual like '%price_floor_rule%' and qual like '%allocation_run%'));
    out := out || 'audit_log policies of B5=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'audit_log policies: ERROR(!) ' || sqlerrm || '; '; end;
  -- the columns and constraints B5 adds
  begin
    select count(*) into n from information_schema.columns where table_schema = 'public' and ((table_name = 'batch' and column_name = 'lb_price_source') or (table_name = 'plan_check_reason' and column_name = 'plan_week_id') or (table_name = 'plan_week_class' and column_name = 'detail'));
    out := out || 'columns of B5=' || n || case when n = 3 then '' else '(!)' end || '; ';
    select count(*) into n from pg_constraint where conname in ('batch_lb_price_source_check', 'plan_week_class_detail_check') and contype = 'c';
    out := out || 'checks of B5=' || n || case when n = 2 then '' else '(!)' end || '; ';
  exception when others then out := out || 'columns: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B5 hygiene (rolled back): %', out;
end $$;

-- ================================================================================================================
-- v5.2 B6 (docs/v5.2/b6.md; docs/v5/QUESTIONS.md Q-v5.2-15, Q-v5.2-71). Same convention as above: results in the final error,
-- (!) = unexpected, the block is self-contained and rolls back, each assertion is guarded so that a missing object shows as
-- ERROR(!) instead of stopping the block. Run against the migrations of origin/main only (without 20261025000600) the block
-- shows (!): that is the proof of what the migration changes. The blocks of B2 (T30, B13: a Sales answer to the surplus) keep
-- running over the same schema: they are the proof that the foreign key to plan_week still lets a Sales answer in.
-- ================================================================================================================

-- Q-v5.2-15: plan_week and demand_weekly are not read by Sales, and are read as before by every other role; the view
-- surplus_for_sales_v52 still gives Sales their rows (a unit-keyed surplus named by the base key of its RPA SKU, joined with its
-- answer); a Sales answer to the surplus still goes in; the write rights are untouched
do $$
declare out text := ''; n int; n2 int; n3 int; pw uuid; r record; e text; cols text; ws date := '2033-08-01'; ok boolean;
begin
  insert into public.app_user(email, role) values ('b6-sales@x.test','sales'),('b6-sales2@x.test','sales'),('b6-lead@x.test','commercial_lead'),('b6-ppic@x.test','ppic'),
    ('b6-mgmt@x.test','management'),('b6-ops@x.test','operations_director'),('b6-fin@x.test','finance'),('b6-adm@x.test','admin'),
    ('b6-ia@x.test','inventory_accounting'),('b6-pur@x.test','purchasing'),('b6-cost@x.test','cost_accounting');
  insert into public.sales_assignment (sales_rep, email, key) values ('B6a', 'b6-sales@x.test', 'RPA|Karkas'), ('B6b', 'b6-sales2@x.test', 'RPA|Kepala|Fresh');
  -- the plan lists its surplus per production unit ("Karkas") and for one SKU key, as the app saves it
  insert into public.plan_week (week_start, version, head_count, surplus_kg_by_key) values (ws, 1, 1000, '{"Karkas": 6332.00, "RPA|Kepala|Fresh": 55}'::jsonb) returning id into pw;
  insert into public.plan_day (plan_week_id, date, head_count) values (pw, ws, 100);
  insert into public.demand_weekly (week_start, key, net_kg) values (ws, 'RPA|Karkas|Fresh', 1000);
  insert into public.plan_week_class (plan_week_id, weight_class, kg_lb, heads, fresh_kg_by_key, frozen_kg_by_key) values (pw, 'K', 5000, 1000, '{}'::jsonb, '{}'::jsonb);
  insert into public.demand_class_weekly (week_start, ship_date, size_code, size_kg, weight_class, net_kg, kg_lb, heads) values (ws, ws + 2, '1.2', 1.2, 'K', 1000, 1500, 600);
  -- the audit trigger has written the trail of the four tables (old and new values of the rows: kg, heads, surplus)
  select count(*) into n from public.audit_log where table_name in ('plan_week', 'plan_week_class', 'demand_weekly', 'demand_class_weekly');
  out := out || 'setup: audit rows of the four tables=' || n || case when n >= 4 then '' else '(!)' end || '; ';
  -- the lead answers the unit-keyed surplus the way the app stores an answer: with the SKU key of the assignment
  perform set_config('request.jwt.claims', '{"email":"b6-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  insert into public.surplus_response (plan_week_id, key, surplus_kg, response, absorb_kg, price) values (pw, 'RPA|Karkas', 6332, 'absorb', 6332, 30000);
  execute 'reset role';

  -- Sales: no row of plan_week or demand_weekly, whichever way they ask
  foreach e in array array['b6-sales', 'b6-sales2'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    select count(*) into n from public.plan_week; out := out || e || ' reads plan_week rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_week where week_start = ws; out := out || e || ' plan_week of the week rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_week where id = pw; out := out || e || ' plan_week by id rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.demand_weekly; out := out || e || ' reads demand_weekly rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.demand_weekly where week_start = ws; out := out || e || ' demand_weekly of the week rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    -- and not through the trail of the tables either
    select count(*) into n from public.audit_log where table_name in ('plan_week', 'plan_week_class', 'demand_weekly', 'demand_class_weekly');
    out := out || e || ' audit_log rows of the four tables=' || n || case when n = 0 then '' else '(!)' end || '; ';
    execute 'reset role';
  end loop;

  -- every other role reads both as before; a signed-in user who is not an app user reads nothing (as before)
  foreach e in array array['b6-lead','b6-ppic','b6-mgmt','b6-ops','b6-fin','b6-adm','b6-ia','b6-pur','b6-cost'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    select count(*) into n from public.plan_week where week_start = ws; select count(*) into n2 from public.demand_weekly where week_start = ws;
    select count(*) into n3 from public.audit_log where table_name in ('plan_week', 'plan_week_class', 'demand_weekly', 'demand_class_weekly');
    out := out || e || ' plan_week=' || n || ' demand_weekly=' || n2 || ' audit rows=' || n3 || case when n = 1 and n2 = 1 and n3 >= 4 then '' else '(!)' end || '; ';
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '{"email":"b6-stranger@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.plan_week where week_start = ws; select count(*) into n2 from public.demand_weekly where week_start = ws;
  out := out || 'not an app user: plan_week=' || n || ' demand_weekly=' || n2 || case when n = 0 and n2 = 0 then '' else '(!)' end || '; ';
  execute 'reset role';

  -- the view: Sales A (assignment RPA|Karkas) one row for the unit-keyed surplus with its answer; Sales B (RPA|Kepala|Fresh) one row
  -- without an answer; the lead both; the stranger none; no plan detail in the columns
  perform set_config('request.jwt.claims', '{"email":"b6-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    select count(*) as n, min(key) as k, max(plan_surplus_kg) as kg, max(response) as resp, max(plan_version) as v into r from public.surplus_for_sales_v52 where week_start = ws;
    out := out || 'sales A surplus_for_sales_v52 rows=' || r.n || ' key=' || coalesce(r.k, 'null') || ' surplus=' || coalesce(r.kg::text, 'null') || ' answer=' || coalesce(r.resp, 'null') || ' version=' || coalesce(r.v::text, 'null')
      || case when r.n = 1 and r.k = 'RPA|Karkas' and r.kg = 6332.00 and r.resp = 'absorb' and r.v = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales A view: ERROR(!) ' || sqlerrm || '; '; end;
  -- a Sales answer still goes in: the foreign key to plan_week is checked as the owner, not as a user who cannot read the plan
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response, absorb_kg, price) values (pw, 'RPA|Karkas', 6332, 'partial', 3000, 28500); out := out || 'sales A answers the surplus of the assigned key: OK; ';
  exception when others then out := out || 'sales A answers the surplus: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.surplus_response (plan_week_id, key, surplus_kg, response) values (pw, 'RPA|Kepala|Fresh', 55, 'absorb'); out := out || 'sales A answers an unassigned key: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales A answers an unassigned key: denied; ';
            when others then out := out || 'sales A unassigned key: ERROR(!) ' || sqlerrm || '; '; end;
  -- two answers of the key (the lead's and this one, stamped in one transaction: same responded_at): still one row of the view
  begin
    select count(*) as n, max(plan_surplus_kg) as kg into r from public.surplus_for_sales_v52 where week_start = ws and key = 'RPA|Karkas';
    out := out || 'after two answers the key is still one row=' || r.n || ' surplus=' || coalesce(r.kg::text, 'null') || case when r.n = 1 and r.kg = 6332.00 then '' else '(!)' end || '; ';
  exception when others then out := out || 'two answers: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b6-sales2@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    select count(*) as n, min(key) as k, max(plan_surplus_kg) as kg, max(response) as resp into r from public.surplus_for_sales_v52 where week_start = ws;
    out := out || 'sales B surplus_for_sales_v52 rows=' || r.n || ' key=' || coalesce(r.k, 'null') || ' surplus=' || coalesce(r.kg::text, 'null') || ' answer=' || coalesce(r.resp, 'null')
      || case when r.n = 1 and r.k = 'RPA|Kepala|Fresh' and r.kg = 55.00 and r.resp is null then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales B view: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b6-lead@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    select count(*) into n from public.surplus_for_sales_v52 where week_start = ws;
    out := out || 'lead surplus_for_sales_v52 rows=' || n || case when n = 2 then '' else '(!)' end || ' (one per key: the unit and its answer are one row); ';
  exception when others then out := out || 'lead view: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b6-stranger@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*) into n from public.surplus_for_sales_v52 where week_start = ws; out := out || 'not an app user: view rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'stranger view: ERROR(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- Sales write nothing of the plan or the demand (as before) and the closed class tables stay closed
  perform set_config('request.jwt.claims', '{"email":"b6-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_week(week_start, version, head_count) values ('2033-08-08', 1, 1); out := out || 'sales insert plan_week: ALLOWED(!); '; exception when others then out := out || 'sales insert plan_week: denied; '; end;
  begin insert into public.demand_weekly(week_start, key) values ('2033-08-08', 'x'); out := out || 'sales insert demand_weekly: ALLOWED(!); '; exception when others then out := out || 'sales insert demand_weekly: denied; '; end;
  begin update public.plan_week set head_count = 1 where id = pw; get diagnostics n = row_count; out := out || 'sales update plan_week rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales update plan_week: denied; '; end;
  -- a reason bound to a plan version is not Sales' to write: the policy refuses it (the trigger that checks the version runs as its owner,
  -- so it does not answer with its own message to a user who cannot read the plan)
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values (ws, 'C58', 'alasan dari sales', pw); out := out || 'sales writes a bound reason: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales writes a bound reason: denied by the policy; ';
            when others then out := out || 'sales writes a bound reason: ERROR(!) ' || sqlerrm || '; '; end;
  select count(*) into n from public.plan_week_class; select count(*) into n2 from public.demand_class_weekly;
  out := out || 'sales plan_week_class=' || n || ' demand_class_weekly=' || n2 || case when n = 0 and n2 = 0 then '' else '(!)' end || '; ';
  -- observation, not a finding of this block: plan_day (the plan's days) is not part of Q-v5.2-15 and is still read by every app user
  select count(*) into n from public.plan_day where plan_week_id = pw; select count(*) into n2 from public.audit_log where table_name = 'plan_day';
  out := out || 'observation: sales plan_day rows=' || n || ' and its audit rows=' || n2 || ' (not closed here, b6.md Q-v5.2-72); ';
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- the write side stays as it was: ppic writes the plan, the demand mart has no client write, Finance still approves
  perform set_config('request.jwt.claims', '{"email":"b6-ppic@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_week(week_start, version, head_count) values ('2033-08-15', 1, 10); out := out || 'ppic insert plan_week: OK; ';
  exception when others then out := out || 'ppic insert plan_week: DENIED(!) ' || sqlerrm || '; '; end;
  begin insert into public.demand_weekly(week_start, key) values ('2033-08-15', 'x'); out := out || 'ppic insert demand_weekly: ALLOWED(!); '; exception when others then out := out || 'ppic insert demand_weekly: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"b6-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin update public.plan_week set approved_by = 'b6-fin@x.test', approved_at = now() where id = pw; get diagnostics n = row_count; out := out || 'finance approves the plan rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'finance approves the plan: DENIED(!) ' || sqlerrm || '; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- the policies and the view, as the catalog says
  begin
    select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('plan_week', 'demand_weekly') and policyname in ('plan_week_read', 'demand_weekly_read')
       and cmd = 'SELECT' and permissive = 'PERMISSIVE' and qual like '%is_app_user%' and qual like '%has_role%' and qual like '%sales%' and qual like '%NOT%';
    out := out || 'read policies of plan_week and demand_weekly without Sales=' || n || case when n = 2 then '' else '(!)' end || '; ';
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact' and permissive = 'RESTRICTIVE'
       and qual like '%plan_week%' and qual like '%plan_week_class%' and qual like '%demand_weekly%' and qual like '%demand_class_weekly%' and qual like '%price_floor_rule%' and qual like '%allocation_run%' and qual like '%closing_adjustment%';
    out := out || 'audit_log Sales redaction names the four tables and keeps the older list=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select count(*) into n from pg_policies where schemaname = 'public' and policyname in ('plan_week_ins', 'plan_week_upd', 'plan_week_approve', 'demand_weekly_ins', 'demand_weekly_upd', 'demand_weekly_no_client_ins', 'demand_weekly_no_client_upd');
    out := out || 'write policies kept=' || n || case when n = 7 then '' else '(!)' end || '; ';
    select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'surplus_for_sales_v52';
    out := out || 'surplus_for_sales_v52 columns=' || coalesce(cols, 'null')
      || case when cols = 'week_start,plan_version,plan_week_id,key,plan_surplus_kg,answered_surplus_kg,response,absorb_kg,price,responded_by,responded_at' then '' else '(!)' end || '; ';
    out := out || 'anon: view=' || has_table_privilege('anon', 'public.surplus_for_sales_v52', 'select')::text || ' plan_week=' || has_table_privilege('anon', 'public.plan_week', 'select')::text || ' demand_weekly=' || has_table_privilege('anon', 'public.demand_weekly', 'select')::text
      || case when has_table_privilege('anon', 'public.surplus_for_sales_v52', 'select') then '(!)' else '' end || ' (the two tables keep the platform default privilege and are closed by RLS: no policy names anon); ';
    select p.prosecdef and exists (select 1 from unnest(p.proconfig) x where x = 'search_path=""') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
      into ok from pg_proc p where p.oid = 'public.tg_plan_check_reason_scope()'::regprocedure;
    out := out || 'tg_plan_check_reason_scope is definer with a fixed search_path and not for clients=' || coalesce(ok::text, 'null') || case when ok then '' else '(!)' end || '; ';
    select count(*) into n from pg_trigger where tgname = 'plan_check_reason_scope' and tgrelid = 'public.plan_check_reason'::regclass and tgfoid = 'public.tg_plan_check_reason_scope()'::regprocedure;
    out := out || 'its trigger is still on plan_check_reason=' || n || case when n = 1 then '' else '(!)' end || '; ';
    select reloptions::text like '%security_barrier=true%' into ok from pg_class where oid = 'public.surplus_for_sales_v52'::regclass;
    out := out || 'view security_barrier=' || coalesce(ok::text, 'null') || case when ok then '' else '(!)' end || '; ';
    out := out || 'version 5.2.5 registered=' || exists (select 1 from public.schema_registry where version = '5.2.5')::text || case when exists (select 1 from public.schema_registry where version = '5.2.5') then '' else '(!)' end
      || ' schema_version()=' || coalesce(public.schema_version(), 'null') || case when string_to_array(public.schema_version(), '.')::int[] >= array[5,2,5] then '' else '(!)' end || '; ';
  exception when others then out := out || 'catalog: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B6 Q-v5.2-15 (rolled back): %', out;
end $$;

-- ================================================================================================================
-- v5.2 B7 (docs/v5.2/b7.md; docs/v5/QUESTIONS.md Q-v5.2-72, Q-v5.2-74, Q-v5.2-84). Same convention as above: results in the final error,
-- (!) = unexpected, the block is self-contained and rolls back, each assertion is guarded so that a missing object shows as
-- ERROR(!) instead of stopping the block. Run against the migrations of B6 only (without 20261025000700) the block shows (!):
-- that is the proof of what the migration changes. The B6 block above keeps running over the same schema: its line
-- "observation: sales plan_day rows=" has no (!) of its own and now reads 0 (it read 1 before B7), so it is left as it is.
-- ================================================================================================================

-- Q-v5.2-72 and Q-v5.2-84: plan_day, and the three tables that carry its content or the plan's (plan_variance_daily, demand_shortfall,
-- plan_check_reason), are not read by Sales and are read as before by every other role; their audit trail follows (Q-v5.2-74) and the
-- redaction of audit_log keeps every table it named before; the write side is untouched
do $$
declare out text := ''; n int; n2 int; n3 int; n4 int; n5 int; pw uuid; pd uuid; e text; t text; miss text := ''; ws date := '2033-09-05';
  trail text[] := array['plan_day', 'plan_variance_daily', 'demand_shortfall', 'plan_check_reason'];
begin
  insert into public.app_user(email, role) values ('b7-sales@x.test','sales'),('b7-sales2@x.test','sales'),('b7-lead@x.test','commercial_lead'),('b7-ppic@x.test','ppic'),
    ('b7-mgmt@x.test','management'),('b7-ops@x.test','operations_director'),('b7-fin@x.test','finance'),('b7-adm@x.test','admin'),
    ('b7-ia@x.test','inventory_accounting'),('b7-pur@x.test','purchasing'),('b7-cost@x.test','cost_accounting');
  -- the plan's days as the app saves them: heads, weight class, cut pattern, supplier and the plan's kg per SKU per day
  insert into public.plan_week (week_start, version, head_count) values (ws, 1, 1000) returning id into pw;
  insert into public.plan_day (plan_week_id, date, head_count, weight_class, cut_pattern, supplier, target_kg_by_key)
    values (pw, ws, 100, 'STD', 'karkas', 'CV B7', '{"RPA|Karkas|Fresh": 500}'::jsonb) returning id into pd;
  insert into public.plan_day (plan_week_id, date, head_count, supplier) values (pw, ws + 1, 80, 'CV B7');
  update public.plan_day set head_count = 120 where id = pd;
  -- what carries the plan or the demand in another form: the variance mart (planned heads and kg per unit per day), the shortfall mart
  -- (demand per SKU key, output at the plan) and the reason written against the plan version
  insert into public.plan_variance_daily (date, key, planned_kg, planned_heads) values (ws, 'Karkas', 500, 100);
  insert into public.demand_shortfall (week_start, key, net_kg, output_kg_at_plan, shortfall_kg, suggested_action) values (ws, 'RPA|Usus|Fresh', 300, 120, 180, 'buy_trading');
  insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values (ws, 'C58', 'supply kelas menyusul dari CV B7', pw);
  -- the audit trigger has written the trail of the four tables: two inserts and an update of plan_day, and one row of each of the others
  select count(*) into n from public.audit_log where table_name = 'plan_day';
  select count(*) into n2 from public.audit_log where table_name in ('plan_variance_daily', 'demand_shortfall', 'plan_check_reason');
  out := out || 'setup: audit rows of plan_day=' || n || ' and of the three others=' || n2 || case when n >= 3 and n2 >= 3 then '' else '(!)' end || '; ';

  -- Sales: no row of the four tables, whichever way they ask, and none of their trail
  foreach e in array array['b7-sales', 'b7-sales2'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    select count(*) into n from public.plan_day; out := out || e || ' reads plan_day rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_day where plan_week_id = pw; out := out || e || ' plan_day of the plan rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_day where id = pd; out := out || e || ' plan_day by id rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_variance_daily; select count(*) into n2 from public.plan_variance_daily where date = ws;
    out := out || e || ' reads plan_variance_daily rows=' || n || ' of the week=' || n2 || case when n = 0 and n2 = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.demand_shortfall; select count(*) into n2 from public.demand_shortfall where week_start = ws;
    out := out || e || ' reads demand_shortfall rows=' || n || ' of the week=' || n2 || case when n = 0 and n2 = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.plan_check_reason; select count(*) into n2 from public.plan_check_reason where week_start = ws and code = 'C58';
    out := out || e || ' reads plan_check_reason rows=' || n || ' of the week=' || n2 || case when n = 0 and n2 = 0 then '' else '(!)' end || '; ';
    select count(*) into n from public.audit_log where table_name = 'plan_day';
    select count(*) into n2 from public.audit_log where table_name in ('plan_variance_daily', 'demand_shortfall', 'plan_check_reason');
    out := out || e || ' audit_log rows of plan_day=' || n || ' and of the three others=' || n2 || case when n = 0 and n2 = 0 then '' else '(!)' end || '; ';
    -- the redaction is by table, not a blanket close: the trail of a table that was never on the list is still read
    select count(*) into n from public.audit_log where table_name = 'app_user';
    out := out || e || ' audit_log rows of app_user (not redacted)=' || n || case when n >= 1 then '' else '(!)' end || '; ';
    execute 'reset role';
  end loop;

  -- every other role reads the four tables and their trail as before; a signed-in user who is not an app user reads nothing (as before)
  foreach e in array array['b7-lead','b7-ppic','b7-mgmt','b7-ops','b7-fin','b7-adm','b7-ia','b7-pur','b7-cost'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    select count(*) into n from public.plan_day where plan_week_id = pw; select count(*) into n2 from public.plan_variance_daily where date = ws;
    select count(*) into n3 from public.demand_shortfall where week_start = ws; select count(*) into n4 from public.plan_check_reason where week_start = ws and code = 'C58';
    select count(*) into n5 from public.audit_log where table_name = any (trail);
    out := out || e || ' plan_day=' || n || ' plan_variance_daily=' || n2 || ' demand_shortfall=' || n3 || ' plan_check_reason=' || n4 || ' audit rows=' || n5
      || case when n = 2 and n2 = 1 and n3 = 1 and n4 = 1 and n5 >= 6 then '' else '(!)' end || '; ';
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '{"email":"b7-stranger@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.plan_day where plan_week_id = pw; select count(*) into n2 from public.plan_variance_daily where date = ws;
  select count(*) into n3 from public.demand_shortfall where week_start = ws; select count(*) into n4 from public.plan_check_reason where week_start = ws;
  select count(*) into n5 from public.audit_log where table_name = any (trail);
  out := out || 'not an app user: plan_day=' || n || ' plan_variance_daily=' || n2 || ' demand_shortfall=' || n3 || ' plan_check_reason=' || n4 || ' audit rows=' || n5
    || case when n = 0 and n2 = 0 and n3 = 0 and n4 = 0 and n5 = 0 then '' else '(!)' end || '; ';
  execute 'reset role';
  -- anon: the platform default privilege is still on the tables, RLS (no policy names anon) leaves nothing
  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'set local role anon';
    select count(*) into n from public.plan_day; select count(*) into n2 from public.plan_variance_daily;
    select count(*) into n3 from public.demand_shortfall; select count(*) into n4 from public.plan_check_reason;
    out := out || 'anon plan_day=' || n || ' plan_variance_daily=' || n2 || ' demand_shortfall=' || n3 || ' plan_check_reason=' || n4 || case when n + n2 + n3 + n4 = 0 then '' else '(!)' end || '; ';
    execute 'reset role';
  exception when others then execute 'reset role'; out := out || 'anon: denied; '; end;

  -- Sales write nothing of these tables (as before): the policy refuses the insert, an update touches no row
  perform set_config('request.jwt.claims', '{"email":"b7-sales@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_day (plan_week_id, date, head_count) values (pw, ws + 3, 1); out := out || 'sales insert plan_day: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales insert plan_day: denied; ';
            when others then out := out || 'sales insert plan_day: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.plan_day set head_count = 1 where id = pd; get diagnostics n = row_count; out := out || 'sales update plan_day rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales update plan_day: denied; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values (ws, 'C58', 'alasan dari sales', pw); out := out || 'sales insert plan_check_reason: ALLOWED(!); ';
  exception when insufficient_privilege then out := out || 'sales insert plan_check_reason: denied; ';
            when others then out := out || 'sales insert plan_check_reason: ERROR(!) ' || sqlerrm || '; '; end;
  begin update public.plan_check_reason set reason = 'diubah sales' where week_start = ws; get diagnostics n = row_count; out := out || 'sales update plan_check_reason rows=' || n || case when n = 0 then '' else '(!)' end || '; ';
  exception when others then out := out || 'sales update plan_check_reason: denied; '; end;
  begin insert into public.plan_variance_daily (date, key) values (ws, 'x'); out := out || 'sales insert plan_variance_daily: ALLOWED(!); '; exception when others then out := out || 'sales insert plan_variance_daily: denied; '; end;
  begin insert into public.demand_shortfall (week_start, key) values (ws, 'x'); out := out || 'sales insert demand_shortfall: ALLOWED(!); '; exception when others then out := out || 'sales insert demand_shortfall: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- the write side stays as it was: Admin and PPIC write the days and the reasons; no client writes the two marts; Finance writes none
  foreach e in array array['b7-ppic', 'b7-adm'] loop
    perform set_config('request.jwt.claims', format('{"email":"%s@x.test","role":"authenticated"}', e), true);
    execute 'set local role authenticated';
    begin insert into public.plan_day (plan_week_id, date, head_count) values (pw, ws + case when e = 'b7-ppic' then 2 else 4 end, 50); out := out || e || ' insert plan_day: OK; ';
    exception when others then out := out || e || ' insert plan_day: DENIED(!) ' || sqlerrm || '; '; end;
    begin update public.plan_day set head_count = 130 where id = pd; get diagnostics n = row_count; out := out || e || ' update plan_day rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    exception when others then out := out || e || ' update plan_day: DENIED(!) ' || sqlerrm || '; '; end;
    begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values (ws, 'C41', 'kekurangan dibeli trading, dari ' || e, pw); out := out || e || ' insert plan_check_reason: OK; ';
    exception when others then out := out || e || ' insert plan_check_reason: DENIED(!) ' || sqlerrm || '; '; end;
    select count(*) into n from public.plan_check_reason where week_start = ws and code = 'C41' and reason like '%' || e;
    out := out || e || ' reads the reason it wrote rows=' || n || case when n = 1 then '' else '(!)' end || '; ';
    begin insert into public.plan_variance_daily (date, key) values (ws + 1, 'x'); out := out || e || ' insert plan_variance_daily: ALLOWED(!); '; exception when others then out := out || e || ' insert plan_variance_daily: denied; '; end;
    begin insert into public.demand_shortfall (week_start, key) values (ws, 'y'); out := out || e || ' insert demand_shortfall: ALLOWED(!); '; exception when others then out := out || e || ' insert demand_shortfall: denied; '; end;
    execute 'reset role';
    -- the reason of this role is soft-deleted so that the next one may write its own C41 (one active reason per code and plan version)
    update public.plan_check_reason set deleted_at = now() where week_start = ws and code = 'C41' and deleted_at is null;
  end loop;
  perform set_config('request.jwt.claims', '{"email":"b7-fin@x.test","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin insert into public.plan_day (plan_week_id, date, head_count) values (pw, ws + 5, 1); out := out || 'finance insert plan_day: ALLOWED(!); ';
  exception when others then out := out || 'finance insert plan_day: denied; '; end;
  begin insert into public.plan_check_reason (week_start, code, reason, plan_week_id) values (ws, 'C42', 'alasan dari finance', pw); out := out || 'finance insert plan_check_reason: ALLOWED(!); ';
  exception when others then out := out || 'finance insert plan_check_reason: denied; '; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- the policies, as the catalog says
  begin
    foreach t in array array['plan_day', 'plan_variance_daily', 'demand_shortfall', 'plan_check_reason'] loop
      select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read'
         and cmd = 'SELECT' and permissive = 'PERMISSIVE' and qual like '%is_app_user%' and qual like '%has_role%' and qual like '%sales%' and qual like '%NOT%';
      select count(*) into n2 from pg_policies where schemaname = 'public' and tablename = t and cmd in ('SELECT', 'ALL');
      select count(*) into n3 from pg_policies where schemaname = 'public' and tablename = t and roles <> '{authenticated}';
      out := out || t || '_read without Sales=' || n || case when n = 1 then '' else '(!)' end || ', policies that open it to SELECT=' || n2 || case when n2 = 1 then '' else '(!)' end
        || ' (no second door), policies for a role other than authenticated=' || n3 || case when n3 = 0 then '' else '(!)' end || '; ';
    end loop;
    -- the write policies, by name and shape: the days and the reasons by Admin and PPIC, nothing for the two marts
    select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('plan_day', 'plan_check_reason') and policyname in ('plan_day_ins', 'plan_day_upd', 'plan_check_reason_ins', 'plan_check_reason_upd')
       and coalesce(with_check, qual) like '%admin%' and coalesce(with_check, qual) like '%ppic%';
    select count(*) into n2 from pg_policies where schemaname = 'public' and tablename in ('plan_variance_daily', 'demand_shortfall') and cmd <> 'SELECT';
    out := out || 'write policies kept (admin, ppic)=' || n || case when n = 4 then '' else '(!)' end || ', write policies of the two marts=' || n2 || case when n2 = 0 then '' else '(!)' end || '; ';
    -- audit_log_sales_redact: restrictive, the four tables and every table of before (B2, B5 and B6), each named as a quoted table name
    select qual into e from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_sales_redact' and permissive = 'RESTRICTIVE';
    foreach t in array array['cost_pool','cost_pool_line','overhead_rate','allocation_run','allocation_line','batch_output_sku',
        'lot','lot_movement','lot_balance_daily','sku_balance_daily','commercial_daily',
        'fixed_cost_schedule','cost_event','budget','bank_account','cash_daily','cash_daily_plan','cash_position_daily',
        'ccc_daily','solvency_monthly','closing_adjustment','price_floor_rule',
        'plan_week','plan_week_class','demand_weekly','demand_class_weekly',
        'plan_day','plan_variance_daily','demand_shortfall','plan_check_reason'] loop
      if e is null or position('''' || t || '''::text' in e) = 0 then miss := miss || t || ' '; end if;
    end loop;
    out := out || 'audit_log_sales_redact is restrictive and names the four tables and the 26 older tables, missing=[' || trim(miss) || ']' || case when e is not null and miss = '' then '' else '(!)' end || '; ';
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname in ('audit_log_read', 'audit_log_fs_redact', 'audit_log_sales_redact');
    out := out || 'audit_log keeps its three policies=' || n || case when n = 3 then '' else '(!)' end || '; ';
    out := out || 'anon: plan_day select privilege=' || has_table_privilege('anon', 'public.plan_day', 'select')::text
      || ' (platform default, closed by RLS: no policy names anon); ';
    out := out || 'version 5.2.6 registered=' || exists (select 1 from public.schema_registry where version = '5.2.6')::text || case when exists (select 1 from public.schema_registry where version = '5.2.6') then '' else '(!)' end
      || ' schema_version()=' || coalesce(public.schema_version(), 'null') || case when string_to_array(public.schema_version(), '.')::int[] >= array[5,2,6] then '' else '(!)' end || '; ';
  exception when others then out := out || 'catalog: ERROR(!) ' || sqlerrm || '; '; end;
  raise exception 'RLS-RESULTS v5.2 B7 Q-v5.2-72 (rolled back): %', out;
end $$;

-- PRD v6 B-R119 / B-R120: week_snapshot is read by every app user and written only by the service role; release.snapshot_id exists
do $$
declare out text := ''; n int; w uuid;
begin
  select id into w from public.week order by week_start limit 1;
  begin
    out := out || 'rls on=' || (select relrowsecurity::text from pg_class where oid = 'public.week_snapshot'::regclass) || '; ';
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'week_snapshot' and cmd <> 'SELECT';
    out := out || 'write policies=' || n || case when n = 0 then '' else '(!)' end || '; ';
    out := out || 'anon select=' || has_table_privilege('anon', 'public.week_snapshot', 'select')::text
      || case when has_table_privilege('anon', 'public.week_snapshot', 'select') then '(!)' else '' end || '; ';
    select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'release' and column_name = 'snapshot_id';
    out := out || 'release.snapshot_id=' || n || case when n = 1 then '' else '(!)' end || '; ';
  exception when others then out := out || 'catalog: ERROR(!) ' || sqlerrm || '; '; end;
  if w is not null then
    insert into public.app_user(email, role) values ('t6-fin@x.test', 'finance') on conflict (email) do nothing;
    insert into public.week_snapshot (week_id, version, engine_version, inputs_hash, result, built_by) values (w, 1, 't', 'h', '{}'::jsonb, 'test');
    -- a finance user reads it, cannot write it
    perform set_config('request.jwt.claims', '{"email":"t6-fin@x.test","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
      select count(*) into n from public.week_snapshot where week_id = w;
      out := out || 'finance reads=' || n || case when n >= 1 then '' else '(!)' end || '; ';
    exception when others then out := out || 'finance read: ERROR(!) ' || sqlerrm || '; '; end;
    begin
      insert into public.week_snapshot (week_id, version, engine_version, inputs_hash, result, built_by) values (w, 2, 't', 'h', '{}'::jsonb, 'x');
      out := out || 'finance insert: allowed(!); ';
    exception when others then out := out || 'finance insert: denied; '; end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
  end if;
  raise exception 'RLS-RESULTS v6 B-R119 week_snapshot (rolled back): %', out;
end $$;
