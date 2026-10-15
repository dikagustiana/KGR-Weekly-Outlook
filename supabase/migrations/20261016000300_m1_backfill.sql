-- v3 F1 backfill (PLAN-v3 Fase 1). Idempotent, never touches the columns the v1 engine reads.
-- 1. Default reporting group and cut component per SKU key (only where still empty).
-- 2. batch_output_sku for Aktual batches that have v1 out_* columns but no SKU detail yet, one row per product
--    group with the default key; source = 'manual', note marks them as reconstructed ("assumed").

update public.sku_key set group_code = case
    when sku = 'Karkas' then 'KARKAS'
    when sku in ('BLD','BLDK') then 'BLD'
    when sku in ('BLP','BLPK') then 'BLP'
    when sku in ('Paha (parting)','Sayap','Kulit','KRK (Kerangka)','TLP') then 'PARTING'
    when sku in ('Kepala','Ceker','Usus','HJA (Hati/Jantung/Ampela)','Lemak') then 'BYPRODUCT'
    else upper(sku) end
  where group_code is null;

update public.sku_key set cut_component = case sku
    when 'Karkas' then 'karkas'
    when 'BLD' then 'dada' when 'BLDK' then 'dada'
    when 'BLP' then 'paha' when 'BLPK' then 'paha' when 'Paha (parting)' then 'paha'
    when 'Sayap' then 'sayap' when 'Kulit' then 'kulit' when 'KRK (Kerangka)' then 'kerangka' when 'TLP' then 'tulang'
    when 'Kepala' then 'kepala' when 'Ceker' then 'ceker' when 'Usus' then 'usus'
    when 'HJA (Hati/Jantung/Ampela)' then 'jeroan' when 'Lemak' then 'lemak'
    else null end
  where cut_component is null and segment = 'RPA';

insert into public.batch_output_sku (batch_id, key, kg, pct_of_processed, source, note)
select b.id, o.key, o.kg,
       case when coalesce(b.processed_kg, 0) > 0 then round(o.kg / b.processed_kg, 6) end,
       'manual', 'assumed: dibentuk dari kolom out_* v1 (backfill F1)'
from public.batch b
cross join lateral (values
  ('RPA|Karkas|Fresh', b.out_karkas_fresh), ('RPA|Karkas|Frozen', b.out_karkas_frozen), ('RPA|Kepala|Fresh', b.out_kepala),
  ('RPA|Ceker|Fresh', b.out_ceker), ('RPA|Usus|Fresh', b.out_usus), ('RPA|HJA (Hati/Jantung/Ampela)|Fresh', b.out_hja),
  ('RPA|Lemak|Fresh', b.out_lemak)) o(key, kg)
join public.sku_key k on k.key = o.key
where b.deleted_at is null and b.superseded_at is null and b.status = 'Aktual' and coalesce(o.kg, 0) > 0
  and not exists (select 1 from public.batch_output_sku x where x.batch_id = b.id)
on conflict do nothing;
