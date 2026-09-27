-- Duração do frasco V1: inventário pessoal e retiradas vinculadas a aplicações.

begin;

create table public.medication_vials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medicine text not null check (char_length(btrim(medicine)) between 1 and 100),
  initial_mg numeric(12,6) not null check (initial_mg > 0),
  initial_ml numeric(12,6) not null check (initial_ml > 0),
  opened_on date null,
  status text not null default 'active' check (status in ('active', 'finished', 'archived')),
  notes text null check (char_length(coalesce(notes, '')) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_vials_id_user_id_key unique (id, user_id)
);

create table public.vial_usages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vial_id uuid not null,
  application_id uuid not null,
  used_mg numeric(12,6) not null check (used_mg > 0),
  used_ml numeric(12,6) not null check (used_ml > 0),
  created_at timestamptz not null default now(),
  constraint vial_usages_application_id_key unique (application_id),
  constraint vial_usages_vial_owner_fkey foreign key (vial_id, user_id)
    references public.medication_vials(id, user_id) on delete restrict,
  constraint vial_usages_application_owner_fkey foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade
);

create index medication_vials_user_status_created_idx
  on public.medication_vials(user_id, status, created_at desc);

create index vial_usages_vial_created_idx
  on public.vial_usages(vial_id, created_at desc);

create trigger medication_vials_set_updated_at
before update on public.medication_vials
for each row execute function public.set_updated_at();

alter table public.medication_vials enable row level security;
alter table public.vial_usages enable row level security;

create policy "medication_vials_own_select" on public.medication_vials for select to authenticated using (user_id = auth.uid());
create policy "medication_vials_own_insert" on public.medication_vials for insert to authenticated with check (user_id = auth.uid());
create policy "medication_vials_own_update" on public.medication_vials for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "medication_vials_own_delete" on public.medication_vials for delete to authenticated using (user_id = auth.uid());

create policy "vial_usages_own_select" on public.vial_usages for select to authenticated using (user_id = auth.uid());
create policy "vial_usages_own_insert" on public.vial_usages for insert to authenticated with check (user_id = auth.uid());
create policy "vial_usages_own_update" on public.vial_usages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "vial_usages_own_delete" on public.vial_usages for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.medication_vials to authenticated;
grant select, insert, update, delete on public.vial_usages to authenticated;

commit;
