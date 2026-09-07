-- Onboarding V1. Proposta pronta para execução manual, não aplicada automaticamente.
create table if not exists public.onboarding_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  gender text not null check (gender in ('woman_cis_trans','man_cis_trans','non_binary','prefer_not_to_answer','other')),
  gender_other text check (gender <> 'other' or char_length(btrim(coalesce(gender_other,''))) between 1 and 80),
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'), state text check (char_length(state) <= 80), city text check (char_length(city) <= 100),
  height_cm numeric(5,2) not null check (height_cm between 80 and 250),
  journey_goal text not null check (journey_goal in ('weight_loss','maintenance','treatment_tracking','other')),
  medicine text not null check (char_length(btrim(medicine)) between 1 and 100),
  application_interval_days integer not null check (application_interval_days between 1 and 30), reminder_time time not null,
  google_calendar_opt_in boolean not null default false, initial_weight_record_id uuid, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.user_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_key text not null check (consent_key in ('terms','privacy','health_data')),
  consent_version text not null check (char_length(btrim(consent_version)) between 1 and 40),
  granted_at timestamptz not null default now(), revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, consent_key)
);
alter table public.onboarding_profiles enable row level security;
alter table public.user_consents enable row level security;
create policy "onboarding_profiles_own_select" on public.onboarding_profiles for select to authenticated using (user_id = auth.uid());
create policy "onboarding_profiles_own_insert" on public.onboarding_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "onboarding_profiles_own_update" on public.onboarding_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "onboarding_profiles_own_delete" on public.onboarding_profiles for delete to authenticated using (user_id = auth.uid());
create policy "user_consents_own_select" on public.user_consents for select to authenticated using (user_id = auth.uid());
create policy "user_consents_own_insert" on public.user_consents for insert to authenticated with check (user_id = auth.uid());
create policy "user_consents_own_update" on public.user_consents for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_consents_own_delete" on public.user_consents for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.onboarding_profiles, public.user_consents to authenticated;
