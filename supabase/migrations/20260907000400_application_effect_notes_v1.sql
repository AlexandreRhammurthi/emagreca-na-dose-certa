-- Relatório PDF V1: anotações livres de efeitos, privadas por usuário.

begin;

create table public.application_effect_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid null,
  record_date date not null,
  note text not null check (char_length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_effect_notes_application_owner_fkey foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade
);

create index application_effect_notes_user_date_created_idx
  on public.application_effect_notes(user_id, record_date desc, created_at desc);

create trigger application_effect_notes_set_updated_at
before update on public.application_effect_notes
for each row execute function public.set_updated_at();

alter table public.application_effect_notes enable row level security;

create policy "application_effect_notes_own_select" on public.application_effect_notes for select to authenticated using (user_id = auth.uid());
create policy "application_effect_notes_own_insert" on public.application_effect_notes for insert to authenticated with check (user_id = auth.uid());
create policy "application_effect_notes_own_update" on public.application_effect_notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "application_effect_notes_own_delete" on public.application_effect_notes for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.application_effect_notes to authenticated;

commit;
