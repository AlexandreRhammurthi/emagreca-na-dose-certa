-- Dados e métricas V1. Proposta local; não executar sem revisão de privacidade e autorização.
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in ('account_created', 'onboarding_completed', 'first_product_action', 'product_returned')),
  source text not null check (source in ('onboarding', 'diary', 'weight', 'plan', 'google_calendar')),
  action_kind text not null default 'none' check (action_kind in ('none', 'application', 'weight', 'plan', 'google_calendar')),
  simulated_in_session boolean not null default false,
  occurred_at timestamptz not null default now(),
  event_day date not null default current_date,
  unique (user_id, event_name, action_kind, event_day)
);

alter table public.product_events enable row level security;

create policy "product_events_own_insert"
  on public.product_events for insert to authenticated
  with check (user_id = auth.uid());

grant insert on public.product_events to authenticated;
