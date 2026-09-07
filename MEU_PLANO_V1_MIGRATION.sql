-- Emagreça na Dose Certa
-- Meu Plano V1 — Etapa 2
-- Migration executável. Aplicar somente após executar a pré-validação descrita
-- em MEU_PLANO_V1_MIGRATION_LOG.md.

begin;

-- Reutiliza public.set_updated_at() quando a assinatura já existe e retorna
-- trigger. Se estiver ausente, cria uma função genérica sem substituir objetos.
do $migration$
declare
  existing_return_type regtype;
begin
  select p.prorettype::regtype
    into existing_return_type
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'set_updated_at'
    and p.pronargs = 0;

  if not found then
    execute $create_function$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      security invoker
      set search_path = pg_catalog, public
      as $function_body$
      begin
        new.updated_at = now();
        return new;
      end;
      $function_body$
    $create_function$;
  elsif existing_return_type <> 'trigger'::regtype then
    raise exception
      'public.set_updated_at() já existe, mas não retorna trigger; migration abortada';
  end if;
end
$migration$;

create table public.application_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  medicine text not null,
  dose_mg numeric not null,
  start_date date not null,
  frequency_type text not null,
  frequency_interval integer null,
  time_of_day time without time zone not null,
  timezone text not null,
  default_reminder_minutes integer[] not null
    default array[1440, 120, 0]::integer[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint application_plans_id_user_id_key
    unique (id, user_id),
  constraint application_plans_medicine_not_blank_check
    check (length(btrim(medicine)) > 0),
  constraint application_plans_dose_positive_check
    check (dose_mg > 0),
  constraint application_plans_timezone_format_check
    check (
      length(timezone) between 1 and 100
      and timezone ~ '^[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z0-9._+-]+)*$'
    ),
  constraint application_plans_frequency_type_check
    check (frequency_type in ('once', 'days')),
  constraint application_plans_frequency_consistency_check
    check (
      (frequency_type = 'once' and frequency_interval is null)
      or
      (frequency_type = 'days' and frequency_interval between 1 and 365)
    ),
  constraint application_plans_reminders_check
    check (
      cardinality(default_reminder_minutes) between 0 and 5
      and array_position(default_reminder_minutes, null) is null
      and 0 <= all(default_reminder_minutes)
    )
);

create table public.scheduled_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  plan_id uuid not null,
  scheduled_date date not null,
  scheduled_time time without time zone not null,
  timezone text not null,
  status text not null default 'scheduled',
  reminder_minutes integer[] not null,
  notes text null,
  google_calendar_id text null,
  google_event_id text null,
  google_sync_status text not null default 'not_connected',
  completed_application_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint scheduled_applications_id_user_id_key
    unique (id, user_id),
  constraint scheduled_applications_plan_owner_fkey
    foreign key (plan_id, user_id)
    references public.application_plans(id, user_id)
    on delete restrict,
  constraint scheduled_applications_completed_application_owner_fkey
    foreign key (completed_application_id, user_id)
    references public.applications(id, user_id)
    on delete restrict,
  constraint scheduled_applications_plan_date_time_key
    unique (plan_id, scheduled_date, scheduled_time),
  constraint scheduled_applications_timezone_format_check
    check (
      length(timezone) between 1 and 100
      and timezone ~ '^[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z0-9._+-]+)*$'
    ),
  constraint scheduled_applications_status_check
    check (status in ('scheduled', 'completed', 'cancelled', 'missed')),
  constraint scheduled_applications_google_sync_status_check
    check (google_sync_status in ('not_connected', 'pending', 'synced', 'error')),
  constraint scheduled_applications_completion_consistency_check
    check (
      (status = 'completed' and completed_application_id is not null)
      or
      (status <> 'completed' and completed_application_id is null)
    ),
  constraint scheduled_applications_reminders_check
    check (
      cardinality(reminder_minutes) between 0 and 5
      and array_position(reminder_minutes, null) is null
      and 0 <= all(reminder_minutes)
    )
);

create unique index scheduled_applications_completed_application_uidx
  on public.scheduled_applications(completed_application_id)
  where completed_application_id is not null;

create index application_plans_user_active_idx
  on public.application_plans(user_id, active, created_at desc);

create index scheduled_applications_user_date_idx
  on public.scheduled_applications(
    user_id,
    scheduled_date,
    scheduled_time,
    created_at
  );

create index scheduled_applications_status_idx
  on public.scheduled_applications(user_id, status, scheduled_date);

create trigger application_plans_set_updated_at
before update on public.application_plans
for each row
execute function public.set_updated_at();

create trigger scheduled_applications_set_updated_at
before update on public.scheduled_applications
for each row
execute function public.set_updated_at();

alter table public.application_plans enable row level security;
alter table public.scheduled_applications enable row level security;

create policy application_plans_select_own
on public.application_plans
for select
to authenticated
using (auth.uid() = user_id);

create policy application_plans_insert_own
on public.application_plans
for insert
to authenticated
with check (auth.uid() = user_id);

create policy application_plans_update_own
on public.application_plans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy application_plans_delete_own
on public.application_plans
for delete
to authenticated
using (auth.uid() = user_id);

create policy scheduled_applications_select_own
on public.scheduled_applications
for select
to authenticated
using (auth.uid() = user_id);

create policy scheduled_applications_insert_own
on public.scheduled_applications
for insert
to authenticated
with check (auth.uid() = user_id);

create policy scheduled_applications_update_own
on public.scheduled_applications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy scheduled_applications_delete_own
on public.scheduled_applications
for delete
to authenticated
using (auth.uid() = user_id and status <> 'completed');

grant select, insert, update, delete
on public.application_plans
to authenticated;

grant select, insert, update, delete
on public.scheduled_applications
to authenticated;

commit;
