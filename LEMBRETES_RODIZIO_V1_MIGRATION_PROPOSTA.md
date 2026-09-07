# Lembretes e rodízio V1 — proposta de migration

> Proposta somente para revisão. O preflight de catálogo em produção foi concluído em 07/09/2026; a migration continua sem execução e requer autorização específica.

## O que não muda

- `reminder_minutes` já aceita o valor `15`; não há alteração de schema para o pré-lembrete.
- Não alterar fórmula, dose, peso, autenticação, Google OAuth ou calendário já aprovado.
- Não criar push notification nesta migration.

## SQL proposto

```sql
create table public.application_site_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid null,
  scheduled_application_id uuid null,
  site_code text not null check (
    site_code in ('abdomen_left', 'abdomen_right', 'thigh_left', 'thigh_right', 'arm_left', 'arm_right', 'other')
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
  constraint application_site_records_application_owner_fkey foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade,
  constraint application_site_records_scheduled_application_owner_fkey foreign key (scheduled_application_id, user_id)
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
```

## Decisão de cascade

- Ao excluir uma `application` ou `scheduled_application`, o registro de local vinculado é excluído em cascade. Isso evita histórico órfão e é consistente com a exclusão integral de conta.
- Não usar `SET NULL`: a constraint exige exatamente uma origem, e um registro sem aplicação/ocorrência não teria contexto verificável.
- A exclusão de conta também remove os registros pelo FK direto de `user_id`.

## Pré-validação em produção — concluída

1. Confirmadas as chaves únicas `(id, user_id)` em `public.applications` e `public.scheduled_applications`; as FKs compostas propostas são tecnicamente suportadas.
2. Confirmados `id` e `user_id` como `uuid NOT NULL` nas duas tabelas.
3. Confirmado RLS habilitado e matriz de policies próprias (SELECT, INSERT, UPDATE e DELETE) nas tabelas de origem.
4. Confirmado que `public.application_site_records` ainda não existe e, portanto, não há dados, policies ou objetos residuais a preservar.
5. O preflight foi exclusivamente leitura; não houve criação, alteração ou exclusão de dados.

## Matriz RLS posterior

| Operação | Próprio usuário | Outro usuário |
|---|---:|---:|
| SELECT | PASS | BLOCK |
| INSERT | PASS | BLOCK |
| UPDATE | PASS | BLOCK |
| DELETE | PASS | BLOCK |

Também testar INSERT com `application_id`/`scheduled_application_id` de outro usuário: deve ser bloqueado pela FK composta, além de RLS.

## Rollback

Antes de executar, registrar o nome final das policies e índices. O rollback será:

```sql
drop table if exists public.application_site_records;
```

Essa reversão é segura somente antes de existirem registros de produção; após uso real, requer exportação/decisão de retenção prévia.
