-- v3 F6b — M7 discount approval + scorecard (PRD v3 §4.8, Q19, PLAN Fase 6 PR 6b). Additive and re-runnable.
-- Who decides a request below the price floor: commercial_lead up to parameter.discount_limit_rp_per_kg (Rp 500/kg,
-- Q19), finance above it, admin always. Requests are created pending by the order entry (sales).

create or replace function public.discount_limit() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.discount_limit_rp_per_kg from public.parameter p join public.week w on w.id = p.week_id
                   where w.status <> 'closed' order by w.week_start desc limit 1), 500)
$$;
revoke execute on function public.discount_limit() from public, anon;
grant execute on function public.discount_limit() to authenticated;

create or replace function public.tg_discount_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r text := public.app_role();
begin
  if r is null or r = 'admin' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'Permintaan diskon dibuat dengan status pending' using errcode = '42501'; end if;
    new.requested_by := coalesce(new.requested_by, (select auth.jwt() ->> 'email'));
    return new;
  end if;
  if new.status is distinct from old.status or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    if old.status <> 'pending' then raise exception 'Keputusan diskon sudah final' using errcode = '42501'; end if;
    if r = 'finance' then return new; end if;
    if r = 'commercial_lead' then
      if new.rp_per_kg_below > public.discount_limit() then
        raise exception 'Diskon % Rp/kg di atas batas commercial lead (% Rp/kg): keputusan Finance', new.rp_per_kg_below, public.discount_limit() using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Peran % tidak memutuskan diskon', r using errcode = '42501';
  end if;
  -- the request itself (price, floor, kg) is fixed once made
  if (to_jsonb(new) - array['sales_line_id','reason','updated_at','updated_by']) is distinct from (to_jsonb(old) - array['sales_line_id','reason','updated_at','updated_by']) then
    raise exception 'Isi permintaan diskon tidak bisa diubah' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'discount_guard' and tgrelid = 'public.discount_approval'::regclass) then
    create trigger discount_guard before insert or update on public.discount_approval for each row execute function public.tg_discount_guard();
  end if;
end $$;

-- the scorecard of a week is rebuilt when its targets change (Monday = scope)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'needs_rebuild' and tgrelid = 'public.sales_target'::regclass) then
    create trigger needs_rebuild after insert or update or delete on public.sales_target for each row execute function public.tg_needs_rebuild();
  end if;
end $$;
