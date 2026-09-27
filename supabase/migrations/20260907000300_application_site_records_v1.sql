-- Lembretes e rodízio V1: local corporal associado a uma aplicação ou ocorrência.
-- Preflight de produção concluído em 2026-09-07.

begin;

create table public.application_site_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid null,
  scheduled_application_id uuid null,
  site_code text not null check (
    site_code in (
      'abdomen_left', 'abdomen_right', 'thigh_left', 'thigh_right',
      'arm_left', 'arm_right', 'other'
    )
  ),
  site_other text null check (
    (site_code = 'other' and char_length(btrim(coalesce(site_other, ''))) between 1 and 80)
    or (site_code <> 'other' and site_other is null)
  ),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_site_records_one_origin_check check (
    num_nonnulls(application_id, scheduled_application_id) = 1
  ),
  constraint application_site_records_application_owner_fkey
    foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade,
  constraint application_site_records_scheduled_application_owner_fkey
    foreign key (scheduled_application_id, user_id)
    references public.scheduled_applications(id, user_id) on delete cascade
);

create unique index application_site_records_application_uidx
  on public.application_site_records(application_id)
  where application_id is not null;

create unique index application_site_records_scheduled_application_uidx
  on public.application_site_records(scheduled_application_id)
  where scheduled_application_id is not null;

create index application_site_records_user_recorded_idx
  on public.application_site_records(user_id, recorded_at desc);

create trigger application_site_records_set_updated_at
before update on public.application_site_records
for each row execute function public.set_updated_at();

alter table public.application_site_records enable row level security;

create policy "application_site_records_own_select"
  on public.application_site_records for select to authenticated
  using (user_id = auth.uid());

create policy "application_site_records_own_insert"
  on public.application_site_records for insert to authenticated
  with check (user_id = auth.uid());

create policy "application_site_records_own_update"
  on public.application_site_records for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "application_site_records_own_delete"
  on public.application_site_records for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.application_site_records to authenticated;

commit;
