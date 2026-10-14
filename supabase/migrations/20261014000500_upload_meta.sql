-- Upload wizard metadata: the column mapping used, options, and the validated plan shown before commit.
alter table public.upload add column if not exists mapping jsonb;
alter table public.upload add column if not exists options jsonb not null default '{}'::jsonb;
alter table public.upload add column if not exists plan jsonb;
alter table public.upload add column if not exists target_week_start date;
