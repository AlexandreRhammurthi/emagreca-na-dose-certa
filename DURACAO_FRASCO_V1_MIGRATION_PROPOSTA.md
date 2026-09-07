# Duração do frasco V1 — proposta de migration

> Proposta técnica. Não executada enquanto o preflight do catálogo de produção e a revisão de UX não forem concluídos.

## Escopo

- Registrar frascos explicitamente; não inferir frasco a partir do histórico.
- Vincular no máximo uma retirada a cada aplicação existente.
- Não alterar fórmula do simulador, `applications` ou registros históricos.
- O saldo permanece uma leitura derivada: quantidade inicial menos retiradas vinculadas.

## Estrutura proposta

`medication_vials` armazena a apresentação declarada do frasco. `vial_usages` registra uma retirada vinculada a uma `application` por meio de FKs compostas com `user_id`, impedindo vínculo entre usuários.

```sql
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
  unique (id, user_id)
);

create table public.vial_usages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vial_id uuid not null,
  application_id uuid not null,
  used_mg numeric(12,6) not null check (used_mg > 0),
  used_ml numeric(12,6) not null check (used_ml > 0),
  created_at timestamptz not null default now(),
  unique (application_id),
  foreign key (vial_id, user_id) references public.medication_vials(id, user_id) on delete restrict,
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade
);
```

## Saldo e estimativa

```text
concentração = initial_mg / initial_ml
saldo_mg = initial_mg - soma(used_mg)
saldo_ml = saldo_mg / concentração
aplicações_restantes = floor(saldo_mg / dose_planejada_mg)
```

Uma futura RPC deve bloquear retirada que exceda o saldo e inserir aplicação/retirada na mesma transação. A UI nunca deve converter automaticamente aplicações antigas em retiradas.

## RLS e índices

- RLS própria (SELECT, INSERT, UPDATE, DELETE) em `medication_vials` e `vial_usages`, sempre com `user_id = auth.uid()`.
- Índice `medication_vials(user_id, status, created_at desc)` e `vial_usages(vial_id, created_at desc)`.
- `application_id` único evita consumo duplicado da mesma aplicação.

## Pré-validação, rollback e testes

1. Confirmar em produção a chave `applications(id, user_id)`, RLS e `public.set_updated_at()` antes de aplicar a migration.
2. Executar matriz RLS completa nas duas tabelas e tentativa de vínculo cruzado por FK composta.
3. Testar concorrência de consumo em RPC antes de expor a gravação na interface.
4. Antes de uso real, rollback é `drop table public.vial_usages; drop table public.medication_vials;`. Após registros reais, rollback exige exportação/decisão de retenção.
