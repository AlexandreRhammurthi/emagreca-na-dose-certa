# Relatório PDF V1 — notas de efeitos e dados necessários

## Separação de responsabilidades

O PDF é gerado no navegador, mediante ação explícita do titular, e não requer armazenamento próprio. Para registrar efeitos relatados em texto livre sem misturá-los com observações de aplicação, a V1 propõe uma tabela dedicada e privada.

## Estrutura proposta

```sql
create table public.application_effect_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid null,
  record_date date not null,
  note text not null check (char_length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade
);
```

`application_id` é opcional para permitir anotação independente. Quando a anotação estiver vinculada a uma aplicação, ela é removida junto com essa aplicação para não preservar contexto órfão. O PDF só inclui notas se o usuário marcar explicitamente essa opção antes de gerar o arquivo.

## Segurança e pré-requisitos

- RLS completo por `user_id = auth.uid()`; sem Google, analytics, logs de conteúdo ou service role no cliente.
- Confirmar antes em produção se `ON DELETE SET NULL` permanece válido com a FK composta e se a chave `(id, user_id)` de `applications` continua presente.
- Testar acesso próprio/cruzado e exclusão de aplicação antes da interface.
