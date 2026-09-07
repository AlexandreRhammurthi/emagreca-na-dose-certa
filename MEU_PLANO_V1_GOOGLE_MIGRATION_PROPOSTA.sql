-- Emagreça na Dose Certa
-- Meu Plano V1 — Etapa 5.1
-- MIGRATION CANDIDATA À REVISÃO. NÃO EXECUTAR NESTA ETAPA.

begin;

create schema if not exists private;

-- O schema privado não integra a API acessível pelo browser.
revoke all on schema private from public, anon, authenticated;

create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  google_subject_hash text null,
  google_account_hint text null,
  calendar_id text not null default 'primary',
  granted_scopes text[] not null default array[]::text[],
  connection_status text not null default 'connected',
  last_sync_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_calendar_connections_user_id_key unique (user_id),
  constraint google_calendar_connections_id_user_id_key unique (id, user_id),
  constraint google_calendar_connections_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint google_calendar_connections_status_check
    check (connection_status in ('connected', 'expired', 'revoked', 'disconnected', 'error')),
  constraint google_calendar_connections_calendar_not_blank_check
    check (length(btrim(calendar_id)) > 0),
  constraint google_calendar_connections_subject_hash_length_check
    check (google_subject_hash is null or length(google_subject_hash) <= 128),
  constraint google_calendar_connections_hint_length_check
    check (google_account_hint is null or length(google_account_hint) <= 254),
  constraint google_calendar_connections_error_length_check
    check (last_error_code is null or length(last_error_code) <= 100)
);

create table private.google_calendar_credentials (
  connection_id uuid primary key,
  user_id uuid not null unique,
  refresh_token_ciphertext bytea not null,
  refresh_token_nonce bytea not null,
  encryption_key_version integer not null,
  token_type text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_calendar_credentials_connection_owner_fkey
    foreign key (connection_id, user_id)
    references public.google_calendar_connections(id, user_id)
    on delete cascade,
  constraint google_calendar_credentials_key_version_check
    check (encryption_key_version > 0),
  constraint google_calendar_credentials_nonce_length_check
    check (octet_length(refresh_token_nonce) = 12),
  constraint google_calendar_credentials_token_type_length_check
    check (token_type is null or length(token_type) <= 32)
);

-- Decisão de integridade: não há FK direta credentials.user_id -> auth.users.
-- A FK composta já garante que o user_id pertence à conexão, e a conexão possui
-- a FK canônica para auth.users com ON DELETE CASCADE. Uma FK direta adicional
-- repetiria a mesma regra sem acrescentar proteção.

-- Somente o refresh token é persistido, sempre cifrado. Access token permanece
-- apenas em memória durante a Edge Function; por isso access_token e expires_at
-- não existem nesta tabela. Scopes ficam na metadata segura granted_scopes.
-- Authorization code e Google Client Secret nunca são persistidos.
-- Na implementação server-side, ausência de novo refresh token não poderá
-- sobrescrever refresh_token_ciphertext/nonce existentes com NULL.

create table private.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  state_hash bytea not null unique,
  pkce_verifier_ciphertext bytea not null,
  pkce_verifier_nonce bytea not null,
  encryption_key_version integer not null,
  redirect_target text not null default 'plan',
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint google_oauth_states_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint google_oauth_states_hash_length_check
    check (octet_length(state_hash) = 32),
  constraint google_oauth_states_nonce_length_check
    check (octet_length(pkce_verifier_nonce) = 12),
  constraint google_oauth_states_key_version_check
    check (encryption_key_version > 0),
  constraint google_oauth_states_redirect_check
    check (redirect_target in ('plan')),
  constraint google_oauth_states_expiry_check
    check (expires_at > created_at),
  constraint google_oauth_states_used_at_check
    check (used_at is null or used_at >= created_at)
);

-- UNIQUE(user_id) já fornece o índice do proprietário da conexão.
-- A PK de credentials já fornece o índice de connection_id.
create index google_calendar_connections_status_idx
  on public.google_calendar_connections(connection_status);

create index google_oauth_states_user_created_idx
  on private.google_oauth_states(user_id, created_at desc);

create index google_oauth_states_pending_expiry_idx
  on private.google_oauth_states(expires_at)
  where used_at is null;

-- Reutiliza a função existente; não cria função duplicada.
create trigger google_calendar_connections_set_updated_at
before update on public.google_calendar_connections
for each row execute function public.set_updated_at();

create trigger google_calendar_credentials_set_updated_at
before update on private.google_calendar_credentials
for each row execute function public.set_updated_at();

alter table public.google_calendar_connections enable row level security;

create policy google_calendar_connections_select_own
on public.google_calendar_connections
for select
to authenticated
using (auth.uid() = user_id);

-- O browser recebe somente SELECT da própria metadata. Não existem policies
-- nem grants de INSERT, UPDATE ou DELETE direto para anon/authenticated.
revoke all on public.google_calendar_connections from public, anon, authenticated;
grant select on public.google_calendar_connections to authenticated;

-- Nenhuma tabela privada possui policy ou grant de acesso ao cliente.
revoke all on private.google_calendar_credentials from public, anon, authenticated;
revoke all on private.google_oauth_states from public, anon, authenticated;

-- A futura implementação server-side decidirá o mecanismo controlado de acesso
-- ao schema private (cliente administrativo, RPC protegida ou conexão PostgreSQL).
-- Esta migration não concede acesso ao browser nem presume esse mecanismo.

-- scheduled_applications já contém google_calendar_id, google_event_id e
-- google_sync_status. Nenhuma coluna, constraint ou índice é alterado aqui.

commit;

-- ROLLBACK PROPOSTO — executar separadamente, nunca junto da migration:
-- begin;
-- drop policy if exists google_calendar_connections_select_own
--   on public.google_calendar_connections;
-- drop trigger if exists google_calendar_credentials_set_updated_at
--   on private.google_calendar_credentials;
-- drop trigger if exists google_calendar_connections_set_updated_at
--   on public.google_calendar_connections;
-- revoke all on public.google_calendar_connections from public, anon, authenticated;
-- drop table if exists private.google_oauth_states;
-- drop table if exists private.google_calendar_credentials;
-- drop table if exists public.google_calendar_connections;
-- -- Remover o schema somente se tiver sido criado exclusivamente por esta
-- -- feature e estiver vazio: drop schema private;
-- commit;
