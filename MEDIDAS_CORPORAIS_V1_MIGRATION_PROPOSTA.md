# Medidas corporais V1 — proposta de migration

## Escopo

- Cria registros independentes de circunferências, sem copiar `weight_kg`.
- Permite um ou mais registros por data; a ordem é preservada por `created_at`.
- Não calcula IMC, diagnóstico, meta ou recomendação clínica.

## SQL proposto

```sql
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
  check (num_nonnulls(abdominal_cm, waist_cm, upper_arm_left_cm, upper_arm_right_cm, thigh_left_cm, thigh_right_cm, calf_left_cm, calf_right_cm) >= 1)
);
```

## Segurança

- RLS com SELECT, INSERT, UPDATE e DELETE para `authenticated`, usando exclusivamente `user_id = auth.uid()`.
- O cliente usa o ID da sessão atual; nenhum ID vindo do formulário é confiado.
- A exclusão de conta remove os registros por cascade de `auth.users`.

## Pré-validação e rollback

1. Confirmar `public.set_updated_at()` e ausência da tabela em produção.
2. Validar RLS próprio/cruzado após a migration, incluindo INSERT sem qualquer medida (BLOCK).
3. Antes de registros reais, rollback: `drop table public.body_measurements;`. Depois de uso real, decidir exportação/retenção antes de excluir.
