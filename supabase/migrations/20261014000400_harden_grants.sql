-- apply_changes runs as the caller (RLS applies), but anonymous callers have no reason to reach it.
revoke execute on function public.apply_changes(text, jsonb, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.apply_changes(text, jsonb, jsonb, uuid[], uuid[]) to authenticated;
