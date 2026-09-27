-- Medidas Corporais V1: registros de circunferências independentes do peso.

begin;

create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  abdominal_cm numeric(6,2) null check (abdominal_cm > 0 and abdominal_cm <= 999.99),
  waist_cm numeric(6,2) null check (waist_cm > 0 and waist_cm <= 999.99),
  upper_arm_left_cm numeric(6,2) null check (upper_arm_left_cm > 0 and upper_arm_left_cm <= 999.99),
  upper_arm_right_cm numeric(6,2) null check (upper_arm_right_cm > 0 and upper_arm_right_cm <= 999.99),
  thigh_left_cm numeric(6,2) null check (thigh_left_cm > 0 and thigh_left_cm <= 999.99),
  thigh_right_cm numeric(6,2) null check (thigh_right_cm > 0 and thigh_right_cm <= 999.99),
  calf_left_cm numeric(6,2) null check (calf_left_cm > 0 and calf_left_cm <= 999.99),
  calf_right_cm numeric(6,2) null check (calf_right_cm > 0 and calf_right_cm <= 999.99),
  notes text null check (char_length(coalesce(notes, '')) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint body_measurements_at_least_one_value_check check (
    num_nonnulls(abdominal_cm, waist_cm, upper_arm_left_cm, upper_arm_right_cm, thigh_left_cm, thigh_right_cm, calf_left_cm, calf_right_cm) >= 1
  )
);

create index body_measurements_user_date_created_idx
  on public.body_measurements(user_id, record_date desc, created_at desc);

create trigger body_measurements_set_updated_at
before update on public.body_measurements
for each row execute function public.set_updated_at();

alter table public.body_measurements enable row level security;

create policy "body_measurements_own_select" on public.body_measurements for select to authenticated using (user_id = auth.uid());
create policy "body_measurements_own_insert" on public.body_measurements for insert to authenticated with check (user_id = auth.uid());
create policy "body_measurements_own_update" on public.body_measurements for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "body_measurements_own_delete" on public.body_measurements for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.body_measurements to authenticated;

commit;
