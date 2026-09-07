# Peso V1 — Etapa 2: proposta de migration

Status: **PROPOSTA — NÃO EXECUTAR NESTA ETAPA**

Data: 2026-08-08

## 1. Objetivo

Adicionar a `public.weight_records`:

- `application_id UUID NULL`, para vínculo explícito com a aplicação que originou o peso;
- `source TEXT`, restrito a `manual` ou `application`.

A migration preserva todos os registros existentes. Pesos legados só recebem `application_id` quando a correspondência é inequivocamente 1:1 para o mesmo usuário e a mesma data.

## 2. Decisões recomendadas

### FK

A FK recomendada é composta:

```text
weight_records(application_id, user_id)
    → applications(id, user_id)
```

Ela continua vinculando `application_id` a `applications.id`, mas também garante no banco que peso e aplicação pertencem ao mesmo usuário. Uma FK simples somente por `application_id` permitiria associação cruzada se alguém obtivesse um UUID de aplicação de outro usuário.

Para suportar a FK composta, `applications(id, user_id)` recebe uma constraint UNIQUE. Isso é redundante em relação à unicidade de `id`, mas é necessário como chave referenciada composta.

### Comportamento em DELETE

Recomendação: `ON DELETE SET NULL (application_id)`.

Ao excluir uma aplicação:

- o histórico de peso é preservado;
- somente `application_id` vira NULL;
- `user_id`, data, peso, origem e observação permanecem;
- `source` continua `application`, registrando a origem histórica.

`CASCADE` não é recomendado porque excluir uma aplicação apagaria silenciosamente um dado de evolução de peso. `RESTRICT` também não é ideal porque impediria o usuário de excluir uma aplicação enquanto existisse o peso.

### Cardinalidade

Um índice UNIQUE parcial em `application_id` estabelece no máximo um peso associado a cada aplicação:

```sql
CREATE UNIQUE INDEX weight_records_application_id_unique
ON public.weight_records (application_id)
WHERE application_id IS NOT NULL;
```

## 3. Pré-validação obrigatória

Executar primeiro, sem modificar dados:

```sql
-- Confirmar versão e contexto.
select version();

-- Confirmar as colunas reais antes da migration.
select
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('applications', 'weight_records')
order by table_name, ordinal_position;

-- Confirmar constraints atuais.
select
  conrelid::regclass as table_name,
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.applications'::regclass, 'public.weight_records'::regclass)
order by conrelid::regclass::text, conname;

-- Confirmar que os nomes novos ainda não existem.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'weight_records'
  and column_name in ('application_id', 'source');
```

Se qualquer definição divergir do que foi documentado, interromper e adaptar a proposta antes de executar SQL de escrita.

## 4. Diagnóstico dos registros legados

O marcador legado é:

```text
Peso registrado junto à aplicação
```

Antes da migration, classificar os casos:

```sql
with legacy_weights as (
  select
    wr.id as weight_record_id,
    wr.user_id,
    wr.record_date,
    count(*) over (
      partition by wr.user_id, wr.record_date
    ) as legacy_weight_count
  from public.weight_records wr
  where wr.notes = 'Peso registrado junto à aplicação'
), matches as (
  select
    lw.weight_record_id,
    lw.user_id,
    lw.record_date,
    lw.legacy_weight_count,
    a.id as application_id,
    count(a.id) over (
      partition by lw.weight_record_id
    ) as application_count
  from legacy_weights lw
  left join public.applications a
    on a.user_id = lw.user_id
   and a.application_date = lw.record_date
)
select
  weight_record_id,
  user_id,
  record_date,
  legacy_weight_count,
  application_count,
  case
    when legacy_weight_count = 1 and application_count = 1
      then 'UNAMBIGUOUS'
    when application_count = 0
      then 'NO_APPLICATION'
    when legacy_weight_count > 1
      then 'MULTIPLE_WEIGHTS'
    when application_count > 1
      then 'MULTIPLE_APPLICATIONS'
    else 'REVIEW'
  end as migration_status
from matches
order by record_date, user_id, weight_record_id;
```

Revisar e exportar esse resultado antes da escrita. Nenhum caso diferente de `UNAMBIGUOUS` pode ser vinculado automaticamente.

## 5. SQL exato proposto

O SQL abaixo pressupõe que a pré-validação confirmou o schema esperado e que as constraints propostas ainda não existem.

```sql
begin;

-- 1. Adicionar colunas inicialmente permissivas para backfill seguro.
alter table public.weight_records
  add column application_id uuid null,
  add column source text null;

comment on column public.weight_records.application_id is
  'Aplicação que originou este peso; NULL para registro manual ou legado não resolvido.';

comment on column public.weight_records.source is
  'Origem do registro: manual ou application.';

-- 2. Classificar todos os registros existentes como manuais por padrão.
update public.weight_records
set source = 'manual'
where source is null;

-- 3. Identificar pesos que vieram do fluxo legado do Diário.
-- Mesmo registros ambíguos preservam source=application e application_id=NULL.
update public.weight_records
set source = 'application'
where notes = 'Peso registrado junto à aplicação';

-- 4. Vincular SOMENTE correspondências inequivocamente 1:1.
with legacy_weights as (
  select
    wr.id as weight_record_id,
    wr.user_id,
    wr.record_date,
    count(*) over (
      partition by wr.user_id, wr.record_date
    ) as legacy_weight_count
  from public.weight_records wr
  where wr.notes = 'Peso registrado junto à aplicação'
), matches as (
  select
    lw.weight_record_id,
    lw.legacy_weight_count,
    a.id as application_id,
    count(a.id) over (
      partition by lw.weight_record_id
    ) as application_count
  from legacy_weights lw
  left join public.applications a
    on a.user_id = lw.user_id
   and a.application_date = lw.record_date
), unambiguous as (
  select weight_record_id, application_id
  from matches
  where legacy_weight_count = 1
    and application_count = 1
    and application_id is not null
)
update public.weight_records wr
set application_id = u.application_id
from unambiguous u
where wr.id = u.weight_record_id;

-- 5. Tornar a origem obrigatória para registros futuros.
alter table public.weight_records
  alter column source set default 'manual',
  alter column source set not null;

-- 6. Restringir os valores aceitos e manter consistência mínima.
alter table public.weight_records
  add constraint weight_records_source_check
    check (source in ('manual', 'application')),
  add constraint weight_records_source_application_check
    check (
      (source = 'manual' and application_id is null)
      or source = 'application'
    );

-- 7. Criar chave candidata composta para impedir vínculo entre usuários.
alter table public.applications
  add constraint applications_id_user_id_key
    unique (id, user_id);

-- 8. Criar FK composta.
-- O column list do SET NULL preserva user_id e limpa somente application_id.
alter table public.weight_records
  add constraint weight_records_application_user_fkey
    foreign key (application_id, user_id)
    references public.applications (id, user_id)
    on delete set null (application_id)
    not valid;

-- 9. Validar a FK após o backfill.
alter table public.weight_records
  validate constraint weight_records_application_user_fkey;

-- 10. Garantir no máximo um peso por aplicação.
create unique index weight_records_application_id_unique
  on public.weight_records (application_id)
  where application_id is not null;

-- 11. Índice para a listagem do usuário por data.
-- Verificar antes se já existe índice equivalente.
create index if not exists weight_records_user_record_date_idx
  on public.weight_records (user_id, record_date desc, created_at desc);

commit;
```

### Compatibilidade do `ON DELETE SET NULL (application_id)`

Supabase utiliza PostgreSQL moderno, mas a versão deve ser confirmada na pré-validação. Se a versão não aceitar column list em `SET NULL`, não usar `SET NULL` composto diretamente. Alternativas seguras:

1. FK simples `application_id → applications.id ON DELETE SET NULL` combinada com validação de ownership por trigger; ou
2. FK composta com `ON DELETE NO ACTION` e função controlada para excluir aplicação após limpar `application_id`.

Não reduzir silenciosamente a proteção de ownership.

## 6. Tratamento dos registros existentes

### Registros sem marcador

- `source = 'manual'`.
- `application_id = NULL`.
- Nenhum outro dado é alterado.

### Marcador com correspondência inequívoca

Condições simultâneas:

- exatamente um peso marcador para usuário + data;
- exatamente uma aplicação do mesmo usuário na mesma data.

Resultado:

- `source = 'application'`;
- `application_id = applications.id`.

### Casos ambíguos ou sem correspondência

- registro integralmente preservado;
- `source = 'application'`;
- `application_id = NULL`;
- inclusão obrigatória em relatório de revisão manual.

Não escolher “o mais recente” para backfill. Essa heurística atual é aceitável apenas para apresentação temporária e não constitui prova de vínculo histórico.

## 7. Consulta de auditoria após migration

```sql
select
  wr.id,
  wr.user_id,
  wr.record_date,
  wr.source,
  wr.application_id,
  case
    when wr.source = 'application' and wr.application_id is null
      then 'REVIEW_REQUIRED'
    else 'OK'
  end as migration_status
from public.weight_records wr
order by wr.record_date, wr.created_at, wr.id;
```

Resumo:

```sql
select
  source,
  (application_id is null) as application_id_is_null,
  count(*)
from public.weight_records
group by source, (application_id is null)
order by source, application_id_is_null;
```

## 8. Impacto nas policies RLS

As policies atuais de `weight_records` já validaram ownership pelo usuário para SELECT, INSERT, UPDATE e DELETE. Adicionar colunas não exige automaticamente mudar RLS.

Entretanto, depois da migration é obrigatório revisar as definições reais das policies para confirmar que:

- `WITH CHECK` continua exigindo `user_id = auth.uid()` em INSERT/UPDATE;
- nenhuma policy passa a confiar apenas em `application_id`;
- UPDATE de `application_id` não permite associação com aplicação de outro usuário.

A FK composta fornece defesa estrutural adicional mesmo que a policy valide somente `weight_records.user_id`.

Não propor nem utilizar `service_role` no front-end ou nos testes de usuário.

## 9. Testes RLS obrigatórios depois da migration

Executar novamente duas sessões independentes A e B com Publishable Key:

### Matriz existente de `weight_records`

- A cria/lê/atualiza/exclui A: PASS.
- A lê/atualiza/exclui B: BLOCK.
- B cria/lê/atualiza/exclui B: PASS.
- B lê/atualiza/exclui A: BLOCK.
- SELECT cruzado por UUID conhecido: BLOCK.

### Novas colunas

1. A cria peso manual com `source='manual'`, `application_id=NULL`: PASS.
2. A cria peso application vinculado à própria application A: PASS.
3. A tenta vincular peso A à application B: deve falhar pela FK composta/RLS.
4. B repete os mesmos testes.
5. `source='outro'`: deve falhar pela CHECK.
6. `source='manual'` com `application_id` preenchido: deve falhar pela CHECK.
7. Segundo peso para a mesma application: deve falhar pelo índice UNIQUE parcial.
8. Excluir uma application vinculada: peso permanece e somente `application_id` vira NULL.
9. Registro `source='application'`, `application_id=NULL`: permitido somente para legado/revisão; o front-end novo não deve criá-lo.
10. Confirmar cleanup somente pelos UUIDs criados no teste.

Também executar regressão de `applications`, pois a nova UNIQUE composta e a FK dependem dessa tabela.

## 10. Estratégia de rollback

Antes do rollback, exportar os valores de `application_id` e `source` para auditoria. O rollback remove somente a infraestrutura nova; não exclui linhas de peso ou aplicações.

```sql
begin;

drop index if exists public.weight_records_user_record_date_idx;
drop index if exists public.weight_records_application_id_unique;

alter table public.weight_records
  drop constraint if exists weight_records_application_user_fkey,
  drop constraint if exists weight_records_source_application_check,
  drop constraint if exists weight_records_source_check;

alter table public.applications
  drop constraint if exists applications_id_user_id_key;

alter table public.weight_records
  drop column if exists application_id,
  drop column if exists source;

commit;
```

O rollback perde os novos metadados de vínculo/origem, mas preserva `id`, `user_id`, `record_date`, `weight_kg`, `notes`, `created_at` e `updated_at`. O marcador legado em `notes` não é removido pela migration e continua disponível como fallback.

## 11. Ordem exata de execução

1. Fazer backup/export de `applications` e `weight_records`.
2. Registrar contagens totais por usuário sem expor dados sensíveis.
3. Executar as consultas de pré-validação de schema, constraints e versão.
4. Executar o diagnóstico de ambiguidade e exportar o resultado.
5. Revisar manualmente todos os casos não `UNAMBIGUOUS`.
6. Programar janela de migration e impedir temporariamente writes da aplicação, se necessário.
7. Executar o bloco transacional proposto.
8. Executar consultas de auditoria e comparar contagens pré/pós.
9. Confirmar que nenhum registro foi excluído.
10. Confirmar que ambiguidades ficaram com `application_id NULL`.
11. Executar a matriz RLS antiga e os novos testes de vínculo/source.
12. Atualizar o front-end para gravar `source` e `application_id` diretamente.
13. Remover do front-end a associação por data + texto somente após deploy e validação da migration.
14. Monitorar erros PostgREST e manter o rollback pronto.

## 12. Critério de aprovação

A migration só deve ser considerada segura se:

- nenhuma linha existente for excluída;
- nenhum caso ambíguo receber vínculo automático;
- todos os pesos manuais tiverem `source='manual'`;
- todos os pesos legados marcados tiverem `source='application'`;
- correspondências 1:1 tiverem `application_id` correto;
- ownership cruzado for recusado pela FK composta e pela RLS;
- exclusão de aplicação preservar o peso;
- rollback tiver sido revisado antes da execução;
- front-end só for atualizado depois da validação do banco.

**Esta proposta não foi executada.**
