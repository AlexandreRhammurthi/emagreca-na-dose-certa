# Meu Plano V1 — Etapa 2: migration executável

Status: **GERADA — NÃO EXECUTADA**

Data: 2026-08-09

Migration: `MEU_PLANO_V1_MIGRATION.sql`

## 1. Escopo

A migration cria somente:

- `public.application_plans`;
- `public.scheduled_applications`;
- constraints, índices, triggers, grants e policies RLS dessas tabelas;
- `public.set_updated_at()` apenas se a função de assinatura vazia ainda não existir.

Não cria recorrências, ocorrências iniciais, OAuth, Edge Functions, tokens, secrets ou integração Google. Não altera tabelas, policies ou triggers existentes.

## 2. Evidência sobre `updated_at`

O repositório não contém DDL nem referência a uma função/trigger reutilizável de `updated_at`. Isso não prova ausência no Supabase.

Por esse motivo, a migration:

1. consulta `pg_proc` dentro da mesma transação;
2. reutiliza `public.set_updated_at()` se existir sem argumentos e retornar `trigger`;
3. aborta se a assinatura existir com retorno incompatível;
4. cria a função genérica somente quando ausente;
5. não usa `CREATE OR REPLACE` e não sobrescreve implementação existente.

A pré-validação abaixo determina se a função pertence à migration para fins de rollback.

## 3. Validação prévia — executar somente leitura

### 3.1 Confirmar que as tabelas ainda não existem

Resultado esperado: duas linhas com `regclass = NULL`.

```sql
select
  object_name,
  to_regclass('public.' || object_name) as regclass
from (values
  ('application_plans'),
  ('scheduled_applications')
) as expected(object_name);
```

Se qualquer tabela existir, interromper. A migration é explícita e não tenta completar estado parcial.

### 3.2 Confirmar `gen_random_uuid()`

Resultado esperado: assinatura não nula e uma chamada retornando UUID.

```sql
select to_regprocedure('gen_random_uuid()') as function_signature;
select gen_random_uuid() as generated_uuid;
```

### 3.3 Confirmar UNIQUE de `applications(id, user_id)`

```sql
select
  c.conname,
  c.contype,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.applications'::regclass
  and c.contype in ('p', 'u')
order by c.contype, c.conname;
```

Deve existir uma UNIQUE cuja ordem seja `(id, user_id)`. A PK somente em `id` não substitui a chave composta exigida pela FK de ownership.

Verificação estrutural exata:

```sql
select
  i.relname as index_name,
  ix.indisunique,
  array_agg(a.attname order by key_column.ordinality) as key_columns
from pg_index ix
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
join pg_class i on i.oid = ix.indexrelid
cross join lateral unnest(ix.indkey) with ordinality as key_column(attnum, ordinality)
join pg_attribute a
  on a.attrelid = t.oid
 and a.attnum = key_column.attnum
where n.nspname = 'public'
  and t.relname = 'applications'
  and ix.indisunique
group by i.relname, ix.indisunique
order by i.relname;
```

Confirmar uma linha com `key_columns = {id,user_id}`.

### 3.4 Investigar função reutilizável de `updated_at`

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prorettype::regtype as return_type,
  pg_get_userbyid(p.proowner) as owner,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'set_updated_at';
```

Interpretação:

- nenhuma linha: a migration criará `public.set_updated_at()` e ela poderá ser removida no rollback, se não tiver passado a ser compartilhada;
- assinatura vazia retornando `trigger`: será reutilizada e não deve ser removida no rollback;
- assinatura vazia com outro retorno: não executar; a migration abortaria;
- função com outro nome: revisar manualmente se deve substituir a estratégia antes de executar. A migration não adivinha equivalência funcional.

### 3.5 Confirmar contexto e dependências

```sql
select current_database(), current_user, version();

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('applications', 'weight_records')
order by table_name, ordinal_position;
```

Comparar com o contexto validado do briefing antes de qualquer escrita.

## 4. Decisões da migration

### 4.1 Recorrência V1

- Tipos aceitos: `once` e `days`.
- `once` exige intervalo NULL.
- `days` exige intervalo entre 1 e 365.
- `start_date` é NOT NULL e funciona como âncora permanente da recorrência. Reagendar, cancelar ou remover uma ocorrência não altera a data em que a regra começou.
- Nenhuma função gera ocorrências nesta etapa.

### 4.2 Lembretes

- Arrays aceitam de zero a cinco itens.
- Elementos NULL e negativos são bloqueados.
- Valores são configuráveis; não há allowlist fixa.
- O plano recebe default `{1440,120,0}`.
- A ocorrência exige valor explícito para preservar um snapshot do plano.

### 4.3 Ownership estrutural

As FKs são compostas:

```text
scheduled_applications(plan_id, user_id)
  → application_plans(id, user_id)

scheduled_applications(completed_application_id, user_id)
  → applications(id, user_id)
```

Assim, conhecer um UUID de outro usuário não permite criar vínculo cruzado.

### 4.4 Exclusão

As duas FKs compostas usam `ON DELETE RESTRICT`.

- Um plano com ocorrências não pode ser apagado fisicamente; o fluxo de produto deve preferir `active=false`.
- Uma aplicação vinculada a ocorrência completed não pode ser apagada sem tratamento explícito.
- A policy DELETE de `scheduled_applications` permite exclusão própria somente quando `status <> 'completed'`.
- Ocorrências completed são protegidas contra DELETE físico pela própria RLS, preservando a rastreabilidade Plano → Ocorrência → Aplicação.
- Ocorrências próprias scheduled, cancelled e missed continuam elegíveis para DELETE, respeitadas as demais constraints.

### 4.5 Conclusão

O CHECK garante:

- `completed` somente com `completed_application_id`;
- qualquer outro status somente sem esse vínculo.

Um índice UNIQUE parcial impede a mesma application de concluir duas ocorrências.

### 4.6 Timezone

- `application_plans.timezone` é a timezone padrão da regra e permite gerar novas janelas sem depender do browser, perfil atual ou ocorrência anterior.
- `scheduled_applications.timezone` continua sendo o snapshot usado naquela ocorrência, permanecendo estável mesmo se o plano mudar futuramente.
- Os dois CHECKs validam apenas forma textual básica, inclusive `UTC` e nomes como `America/Sao_Paulo`. Eles não afirmam que o identificador existe na base IANA; essa validação pertence à aplicação/serviço futuro.

### 4.7 RLS e grants

Cada tabela recebe policies SELECT, INSERT, UPDATE e DELETE para `authenticated`, sempre comparando `auth.uid()` com `user_id`. Grants explícitos são necessários porque RLS não substitui privilégios SQL.

## 5. Validação estática antes da execução

Revisar no arquivo SQL:

- transação única `begin`/`commit`;
- nenhuma referência a `service_role` ou secret;
- nenhuma alteração em tabela existente;
- nenhuma FK simples de `plan_id` ou `completed_application_id`;
- `application_plans.start_date` NOT NULL;
- timezone NOT NULL no plano e na ocorrência;
- oito policies no total;
- policy DELETE de ocorrências com `status <> 'completed'`;
- três índices normais e um UNIQUE parcial;
- dois triggers BEFORE UPDATE;
- ausência de `IF NOT EXISTS` nas tabelas, índices, policies e triggers.

## 6. Testes pós-migration

Executar com dois clientes independentes do SDK, Publishable Key e sessões A/B. Não usar `service_role`. Capturar todos os UUIDs criados para cleanup.

### 6.1 Matriz RLS

#### `application_plans`

| Operação | A→A | A→B | B→B | B→A |
|---|---|---|---|---|
| INSERT | PASS | BLOCK | PASS | BLOCK |
| SELECT | PASS | BLOCK | PASS | BLOCK |
| UPDATE | PASS | BLOCK | PASS | BLOCK |
| DELETE | PASS | BLOCK | PASS | BLOCK |

#### `scheduled_applications`

| Operação | A→A | A→B | B→B | B→A |
|---|---|---|---|---|
| INSERT | PASS | BLOCK | PASS | BLOCK |
| SELECT | PASS | BLOCK | PASS | BLOCK |
| UPDATE | PASS | BLOCK | PASS | BLOCK |
| DELETE não completed | PASS | BLOCK | PASS | BLOCK |
| DELETE completed | BLOCK | BLOCK | BLOCK | BLOCK |

Para testes DELETE próprios, usar registros sem dependentes ou limpar ocorrências antes dos planos. O BLOCK próprio de completed é regra de rastreabilidade, não falha da RLS.

### 6.2 Ownership das FKs

| Teste | Esperado |
|---|---|
| A cria ocorrência com `plan_id` do plano A | PASS |
| A cria ocorrência com `plan_id` do plano B e `user_id` A | BLOCK pela FK composta |
| B repete com os próprios dados | PASS |
| A conclui ocorrência A com application A | PASS |
| A tenta usar application B | BLOCK pela FK composta |
| Segunda ocorrência tenta usar a mesma application | BLOCK pelo índice UNIQUE parcial |

### 6.3 Constraints

| Caso | Esperado |
|---|---|
| `start_date` válida | PASS |
| `start_date` NULL | BLOCK |
| timezone válida no plano (`America/Sao_Paulo` ou `UTC`) | PASS |
| timezone vazia no plano | BLOCK |
| `dose_mg = 0` ou negativo | BLOCK |
| medicamento vazio ou apenas espaços | BLOCK |
| `frequency_type` fora de `once/days` | BLOCK |
| `days` com intervalo NULL | BLOCK |
| `days` com intervalo 0 ou 366 | BLOCK |
| `once` com intervalo preenchido | BLOCK |
| status inválido | BLOCK |
| `completed` sem application ID | BLOCK |
| `scheduled`, `cancelled` ou `missed` com application ID | BLOCK |
| reminder com mais de 5 itens | BLOCK |
| reminder contendo NULL | BLOCK |
| reminder negativo | BLOCK |
| reminder configurável positivo, por exemplo 30 | PASS |
| timezone vazia ou com espaço/formato inválido | BLOCK |
| ocorrência duplicada no mesmo plano/data/hora | BLOCK |
| google sync status inválido | BLOCK |

### 6.4 Proteção de DELETE por status

| Caso | Esperado |
|---|---|
| DELETE de ocorrência própria `scheduled` | PASS |
| DELETE de ocorrência própria `cancelled` | PASS |
| DELETE de ocorrência própria `missed` | PASS |
| DELETE de ocorrência própria `completed` | BLOCK |

O UPDATE de uma ocorrência completed continua disponível ao proprietário pelas policies gerais, sempre sujeito aos CHECKs, FKs e demais constraints. Regras mais restritas para alteração de completed serão definidas junto da confirmação transacional futura.

### 6.5 `updated_at`

1. registrar `updated_at` inicial;
2. aguardar apenas o necessário para diferenciar timestamps;
3. executar UPDATE permitido;
4. confirmar `updated_at > valor inicial` nas duas tabelas;
5. confirmar que `created_at` não mudou.

### 6.6 Regressão

- repetir matriz principal de `applications` e `weight_records`;
- confirmar vínculo existente `weight_records(application_id,user_id)`;
- confirmar que Auth, Diário e Peso não sofreram alterações;
- confirmar que nenhuma ocorrência é gerada automaticamente.

### 6.7 Cleanup

Ordem segura:

1. remover ocorrências temporárias não completed;
2. para ocorrências completed de teste, desfazer vínculo/status apenas se o teste tiver autorização explícita e IDs próprios;
3. remover ocorrências restantes;
4. remover applications temporárias do teste;
5. remover planos temporários;
6. consultar por todos os UUIDs capturados e confirmar zero resíduos;
7. nunca excluir profiles ou usuários Auth.

## 7. Consultas de auditoria pós-migration

```sql
select
  table_name,
  row_security_active
from (
  select
    c.relname as table_name,
    c.relrowsecurity as row_security_active
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('application_plans', 'scheduled_applications')
) audit
order by table_name;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('application_plans', 'scheduled_applications')
order by tablename, cmd, policyname;

select
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('application_plans', 'scheduled_applications')
order by event_object_table, trigger_name;
```

Esperado: RLS ativa em ambas, quatro policies por tabela e um trigger BEFORE UPDATE por tabela.

## 8. Rollback separado

O rollback não integra a migration principal. Antes de executá-lo, confirmar que não existem dados reais que precisem ser preservados.

### 8.1 Rollback das tabelas

Os triggers e policies pertencentes às tabelas são removidos junto com elas.

```sql
begin;

drop table public.scheduled_applications;
drop table public.application_plans;

commit;
```

### 8.2 Função `public.set_updated_at()`

Se a pré-validação mostrou que a função **já existia**, não removê-la.

Se a pré-validação mostrou que estava ausente, a migration a criou exclusivamente e nenhuma outra tabela passou a utilizá-la, executar depois das tabelas:

```sql
drop function public.set_updated_at();
```

Antes do DROP, confirmar dependências:

```sql
select
  n.nspname as dependent_schema,
  c.relname as dependent_table,
  t.tgname as trigger_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and pn.nspname = 'public'
  and p.proname = 'set_updated_at';
```

Somente remover a função se essa consulta retornar zero linhas após o DROP das tabelas novas.

## 9. Ordem exata de execução futura

1. Fazer backup e registrar contagens relevantes.
2. Executar todas as queries de pré-validação.
3. Guardar evidência de existência/ausência de `public.set_updated_at()`.
4. Revisar o SQL no ambiente alvo.
5. Executar `MEU_PLANO_V1_MIGRATION.sql` uma única vez.
6. Executar auditorias de RLS, policies, triggers, constraints e índices.
7. Rodar matriz A/B e testes negativos.
8. Rodar regressão de `applications` e `weight_records`.
9. Fazer cleanup por UUID e confirmar zero resíduos.
10. Somente após aprovação iniciar a implementação do módulo local.

## 10. Resultado desta etapa

- Migration SQL criada: SIM.
- Migration executada: **NÃO**.
- Supabase alterado: **NÃO**.
- Aplicação alterada: **NÃO**.
- RLS existente alterada: **NÃO**.
- OAuth/Google implementado: **NÃO**.
- Commit/push/deploy: **NÃO**.

## 11. Hotfix local — botão Cancelar aplicação (09/08/2026)

### Escopo

- Fluxo auditado: `Meu Plano → Próximas aplicações → Cancelar → Cancelar aplicação`.
- Arquivos funcionais alterados: `js/plan.js` e sua cópia sincronizada em `public/js/plan.js` pelo build.
- Schema, migration, RLS, policies, Auth, Diário, Peso e Simulador: não alterados.

### Causa raiz

- O fechamento do modal dependia anteriormente do estado global `requestInFlight`, podendo impedir o botão `Voltar` de fechar a confirmação.
- A operação de cancelamento passou a usar estado independente (`cancelRequestInFlight`) e tratamento `try/catch/finally`, evitando bloqueio permanente após exceções assíncronas.
- Uma correção intermediária havia substituído o cancelamento lógico por `DELETE`, em desacordo com a regra da Sprint. O fluxo foi restaurado para `UPDATE status = 'cancelled'`.

### Comportamento final

- O UUID é mantido internamente em `cancellingId`; nenhum `user_id` vem do DOM.
- O botão executa `UPDATE public.scheduled_applications SET status = 'cancelled'` filtrado pelo UUID e pelo status atual `scheduled`.
- O registro atualizado é solicitado com `select(...).maybeSingle()` e seu UUID é validado antes de declarar sucesso.
- Durante a operação, o botão fica desabilitado e exibe `Cancelando...`.
- Em sucesso, o modal fecha, `cancellingId` é limpo, os dados do Meu Plano são recarregados e o toast informa `Aplicação agendada cancelada.`
- Em erro, o modal permanece aberto, o botão é restaurado, uma mensagem amigável é exibida e o erro técnico é registrado no console.
- `Voltar`, clique no backdrop, botão `X` e tecla `Escape` fecham o modal sem executar UPDATE e limpam o UUID temporário.
- Nenhum `DELETE` é executado por esse botão.

### Validações

- `node --check .\js\plan.js`: PASS.
- `git diff --check`: PASS.
- `npm run build`: SUCCESS.
- Integridade source/public: 11/11 arquivos sincronizados.
- Credenciais QA disponíveis nesta sessão: 0/4.
- UPDATE autenticado real no Supabase: não executado nesta sessão por ausência das credenciais QA; validação funcional autenticada permanece pendente.
- Commit, push e deploy: não executados.

## 15. Etapa 4.1 — teste autenticado da RPC (09/08/2026)

- Método: SDK oficial Supabase com Publishable Key e sessão Auth real; `service_role` não utilizada.
- Usuário autenticado UUID: `354be9da-7a8d-4101-b1a5-b42d1f1e2fbb`.
- E-mail mascarado; senha, JWT, access token e refresh token não registrados.
- Occurrence utilizada: `b657eca4-2cb3-41d9-919d-a1ac6700a5ad`.
- Data planejada original: `2026-08-14`.
- Application criada: `4b8063f5-e17a-425b-b5df-c5836a99fc00`.
- Primeira chamada: `already_completed = false` e `weight_record_id = NULL`: PASS.
- Campos, fórmula, source, calculation_version e notes da application: PASS.
- Occurrence alterada para `completed`: PASS.
- `completed_application_id` igual à application criada: PASS.
- `scheduled_date` preservada: PASS.
- Peso associado ausente: PASS.
- Contagem de applications aumentou exatamente em 1: PASS.
- Retry: mesmo `application_id`, `already_completed = true` e nenhuma nova application: PASS.
- Duplo clique concorrente em segunda ocorrência QA: PENDENTE por ausência de ocorrência separada autorizada no teste.
- Ownership cruzado: PENDENTE por ausência de segunda sessão QA nesta etapa.
- Credenciais usadas apenas no ambiente temporário do processo e removidas ao término; nenhum segredo persistido em arquivo: PASS.
- Script temporário: `scripts/test-confirm-scheduled-auth.mjs`.
- Cleanup da evidência: não executado conforme briefing.
- Commit, push e deploy: não executados.

## 14. Etapa 4 — desenho de Confirmar aplicação (09/08/2026)

- Criado `MEU_PLANO_V1_CONFIRM_ANALISE.md` com o desenho de reutilização do modal do Diário, estados de UX, operação atômica, idempotência, erros, RLS e testes futuros.
- Criado `MEU_PLANO_V1_CONFIRM_MIGRATION.sql` como proposta não executada.
- Solução proposta: RPC `public.confirm_scheduled_application(...)`, `SECURITY INVOKER`, ownership por `auth.uid()` e lock `FOR UPDATE` da ocorrência.
- A RPC proposta cria application, cria peso opcional e conclui scheduled_application na mesma transação PostgreSQL.
- Medicine e dose são derivados do plano no banco; `user_id` não é aceito como parâmetro.
- `scheduled_date` permanece planejada e `application_date` registra a data real.
- Retry de ocorrência já completed retorna a application existente sem duplicação.
- Migration SQL executada: NÃO.
- Schema, RLS, policies e aplicação alterados: NÃO.
- Validação estática dos artefatos: PASS.
- `git diff --check`: PASS.
- Build: não aplicável, pois nenhum arquivo servido pela aplicação foi alterado.
- Commit, push e deploy: não executados.

## 13. Hotfix de recorrência — validação das 12 ocorrências (09/08/2026)

### Diagnóstico

- O método existente já operava com datas civis: `addCivilDays()` incrementava ano, mês e dia explicitamente, sem milissegundos, UTC ou objeto `Date` mutável.
- `generateOccurrenceDates()` já gerava índices de 0 a 11 para recorrência em dias, incluindo a data inicial.
- A persistência já era feita por um único INSERT em lote, não por inserts individuais ou `Promise.all`.
- O teste isolado comprovou que a posição 5 para início `2026-08-14` e intervalo 7 é `2026-09-18`.
- O código anterior comparava a quantidade retornada com a quantidade enviada, mas não validava formalmente os payloads antes do INSERT nem comparava as identidades das datas retornadas.
- Com um único INSERT PostgreSQL e validação de quantidade, não há evidência no código atual de que apenas 18/09 possa ser omitido silenciosamente. A ausência observada pode decorrer de alteração posterior de status/registro ou da consulta usada para contar somente ocorrências `scheduled`; o estado real não pôde ser auditado nesta sessão.

### Correção preventiva

- Antes de criar o plano, as datas são validadas quanto à quantidade exata esperada, formato civil e ausência de duplicidades.
- Depois de obter o `plan_id`, os payloads são validados quanto a data, horário, timezone, lembretes e mesmo plano.
- O INSERT continua sendo único e em lote.
- O retorno agora é comparado por identidade composta `plan_id + scheduled_date + scheduled_time`, não apenas por quantidade.
- Qualquer divergência impede o toast de sucesso e aciona a rotina existente de tratamento/limpeza do plano incompleto.
- Não foi implementada RPC ou transação nesta etapa.

### Datas comprovadas

- Caso A: `2026-08-14`, `2026-08-21`, `2026-08-28`, `2026-09-04`, `2026-09-11`, `2026-09-18`, `2026-09-25`, `2026-10-02`, `2026-10-09`, `2026-10-16`, `2026-10-23`, `2026-10-30`.
- Caso B: `2026-01-30`, `2026-02-06`, `2026-02-13`, `2026-02-20`, `2026-02-27`, `2026-03-06`, `2026-03-13`, `2026-03-20`, `2026-03-27`, `2026-04-03`, `2026-04-10`, `2026-04-17`.
- Caso C: `2026-12-20`, `2026-12-27`, `2027-01-03`, `2027-01-10`, `2027-01-17`, `2027-01-24`, `2027-01-31`, `2027-02-07`, `2027-02-14`, `2027-02-21`, `2027-02-28`, `2027-03-07`.

### Validações

- Casos A, B e C: PASS.
- Posição 5 do Caso A igual a `2026-09-18`: PASS.
- `node --check .\js\plan.js`: PASS.
- `git diff --check`: PASS.
- `npm run build`: SUCCESS.
- Integridade source/public: 11/11 arquivos sincronizados.
- Credenciais QA disponíveis nesta sessão: 0/4.
- Quantidade retornada pelo Supabase em teste funcional novo: não verificada nesta sessão por ausência de credenciais/sessão automatizável.
- Schema, migration, RLS, policies e módulos fora de Meu Plano: não alterados.
- Commit, push e deploy: não executados.

## 12. Hotfix 2 — confirmação de cancelamento sem feedback (09/08/2026)

### Diagnóstico comprovado

- O elemento `#plan-cancel-confirm` existe uma única vez no DOM, possui `type="button"` e é estático.
- O seletor `document.getElementById('plan-cancel-confirm')` não falhava, o botão não era recriado e não havia perda do listener por `replaceChildren` ou `innerHTML`.
- O listener disparava, porém aguardava `client.auth.getUser()` antes de desabilitar o botão e trocar seu texto.
- Se a autenticação demorasse, ou se `client`, `cancellingId` ou a ocorrência falhassem nas guardas iniciais, o handler retornava sem qualquer mudança visual ou mensagem, produzindo a aparência de botão inativo.

### Correção

- A referência estática do botão passou a ser capturada na inicialização como `cancelConfirmButton` e recebe um único listener.
- Imediatamente após o clique, antes de qualquer chamada assíncrona, o botão é desabilitado, passa a exibir `Cancelando...` e o modal recebe `aria-busy="true"`.
- Ausência de cliente, UUID, ocorrência agendada ou sessão válida não falha mais silenciosamente: o modal apresenta mensagem amigável e o console registra a causa técnica.
- O cancelamento continua usando exclusivamente o UUID preservado em `cancellingId`.
- A operação permanece `UPDATE status = 'cancelled'`, filtrada por `id` e `status = 'scheduled'`, com retorno e validação do UUID.
- `try/catch/finally` restaura texto, estado habilitado e `aria-busy` em sucesso, erro ou exceção.
- Nenhum log temporário de diagnóstico foi mantido e nenhum `DELETE` foi introduzido.

### Validações

- Unicidade de `id="plan-cancel-confirm"`: PASS, 1 ocorrência.
- Ordem do handler `loading imediato → autenticação → UPDATE cancelled`: PASS.
- Ausência de `DELETE` no handler: PASS.
- `node --check .\js\plan.js`: PASS.
- `git diff --check`: PASS.
- `npm run build`: SUCCESS.
- Integridade source/public: 11/11 arquivos sincronizados.
- Credenciais QA disponíveis nesta sessão: 0/4.
- Teste manual autenticado e status final no Supabase: não executados nesta sessão por ausência de credenciais/sessão automatizável; permanecem pendentes e não foram declarados como PASS.
- Commit, push e deploy: não executados.

## 16. Etapa 4.2 — integração Confirmar aplicação (09/08/2026)

### Implementação

- O modal `#application-form-modal` do Diário foi reutilizado; nenhum segundo formulário foi criado.
- `js/diary.js` expõe `window.Diary.openScheduledConfirmation(...)` e mantém `occurrenceId` somente em estado JS interno.
- O modo `scheduled-confirmation` deixa medicamento e dose readonly, mantém data real editável e deixa frasco, seringa, peso e observações para preenchimento no momento real.
- O submit desse modo chama exclusivamente `confirm_scheduled_application`; não envia `user_id`, medicine, dose, volume, units, source ou calculation_version.
- Feedback `Confirmando...`, bloqueio de duplo clique, `aria-busy`, mensagens amigáveis e detalhes técnicos no console foram adicionados.
- Ocorrência futura mantém a data planejada visível, limita a data real até hoje e apresenta instrução para correção.
- `js/plan.js` adiciona a ação principal `Confirmar aplicação` somente nas ocorrências scheduled renderizadas.
- Eventos atualizam Meu Plano, Meu Diário e Meu Peso após sucesso ou retry.

### Evidências autenticadas

- Sem peso: occurrence `7b8d46b5-e5cb-4138-a06c-7b4e014295eb`; application `7090a0dc-8b1a-4203-a5d9-e74bf14b8727`.
- Com peso: occurrence `20d3d126-3067-4e26-af2e-a476312e41d9`; application `5229ddac-2d58-4296-97b3-bd23f3c4ce2c`.
- Application criada exatamente uma vez em cada confirmação: PASS.
- Occurrences alteradas para completed e `completed_application_id` correto: PASS.
- `scheduled_date` preservada: PASS.
- Data real diferente da data planejada: PASS.
- Sem peso não criou weight_record: PASS.
- Com peso criou um weight_record, `source = application` e `application_id` correto: PASS.
- Retry retornou os mesmos UUIDs e `already_completed = true`, sem duplicação: PASS.
- Duplo clique concorrente em duas chamadas simultâneas: PENDENTE; bloqueio de UI e idempotência sequencial validados.
- Cancelamento, edição e fluxos normais: preservados por inspeção/regressão estática; teste visual manual permanece recomendado.

### Validações finais

- `node --check js/diary.js`: PASS.
- `node --check js/plan.js`: PASS.
- `node --check scripts/test-confirm-scheduled-auth.mjs`: PASS.
- Contrato de parâmetros da RPC: PASS.
- `git diff --check`: PASS.
- `npm run build`: SUCCESS.
- Integridade source/public: 11/11 arquivos sincronizados.
- Segredos persistidos: NÃO; variáveis temporárias removidas.
- Commit, push e deploy: não executados.

## 17. Etapa 5.1 — revisão final da migration Google Agenda (10/08/2026)

### Revisão realizada

- A migration conceitual foi promovida a candidata à revisão, sem execução.
- `public.google_calendar_connections` mantém somente metadata segura, uma conexão por usuário, FK para `auth.users` com cascade e `UNIQUE (id, user_id)`.
- `private.google_calendar_credentials` passou a usar exclusivamente a FK composta `(connection_id, user_id)`, impedindo associação cruzada e evitando FK direta redundante para `auth.users`.
- `private.google_oauth_states` preserva state por hash, PKCE protegido, expiração, uso único e associação ao usuário.
- Foram adicionados triggers `BEFORE UPDATE` que reutilizam `public.set_updated_at()` nas tabelas de conexão e credenciais.
- RLS e grants permitem ao browser somente `SELECT` da própria metadata; tabelas privadas permanecem sem grants ou policies para `anon`/`authenticated`.
- Access token permanece apenas em memória; somente refresh token cifrado é persistido. Authorization code e Client Secret não são armazenados.
- Índices redundantes foram evitados e nenhuma alteração foi feita em `scheduled_applications`.
- O rollback comentado contempla policy, triggers e tabelas; remoção do schema privado permanece condicional a uso exclusivo e vazio.

### Validação e segurança

- Auditoria estática das constraints, FK composta, triggers, RLS, grants, índices e rollback: SUCCESS.
- Varredura por credenciais QA, senha, token, Client Secret e chave `service_role`: nenhum valor sensível encontrado.
- SQL, migration e rollback: não executados.
- Edge Functions e frontend: não implementados nem alterados.
- Commit, push e deploy: não executados.

## 18. Etapa 5.2A — implementação google-oauth-start (10/08/2026)

### Implementação

- Criada a Edge Function `google-oauth-start`, configurada com `verify_jwt = true`.
- O handler aceita somente `POST` e `OPTIONS`; demais métodos retornam 405.
- O JWT recebido em `Authorization: Bearer` é validado por Supabase Auth `getUser`; não há decodificação manual nem parâmetro `user_id`.
- O acesso a `private.google_oauth_states` usa conexão PostgreSQL exclusivamente server-side por variável padrão da Edge Function, mantendo o schema fora do Data API.
- State usa 32 bytes aleatórios, Base64URL e persistência exclusiva do hash SHA-256, com TTL de 10 minutos.
- PKCE usa verifier aleatório de 64 bytes, challenge SHA-256/Base64URL e método S256.
- O verifier é cifrado com AES-256-GCM, chave Base64 validada em 32 bytes, nonce aleatório de 12 bytes e versão de chave 1.
- A URL solicita somente `calendar.events.owned`, `openid` e `email`; os dois últimos suportam a identificação futura da conta conectada.
- `prompt=consent` é usado apenas quando não existe conexão ativa; status `connected` não força novo consentimento.
- CORS usa allowlist exata das três origins atualmente documentadas, sem wildcard.
- Cleanup remove somente states expirados do próprio usuário autenticado.

### Validações

- Testes automatizados de métodos, autenticação simulada, CORS, URL, scopes, state, PKCE, AES-GCM, TTL, `used_at` e estratégia de prompt: PASS.
- Deploy de `google-oauth-start` no projeto `jxfjsleqwfjrkcxcqpvw`: SUCCESS.
- URL publicada: `https://jxfjsleqwfjrkcxcqpvw.supabase.co/functions/v1/google-oauth-start`.
- POST sem Authorization: HTTP 401, `UNAUTHORIZED_NO_AUTH_HEADER`: PASS.
- POST autenticado real: HTTP 200, `authorization_url` presente e `expires_in_seconds = 600`: PASS.
- Persistência real em `private.google_oauth_states`: `state_hash = 32 bytes`, verifier cifrado = 102 bytes, nonce = 12 bytes, versão da chave = 1, `redirect_target = plan` e `used_at = NULL`.
- TTL observado no momento da auditoria: 504 segundos restantes, compatível com expiração configurada em 600 segundos.
- Resultado: **ETAPA 5.2A VALIDADA EM PRODUÇÃO**.
- `npm run build`: SUCCESS, 11/11 arquivos source/public sincronizados.
- `git diff --check`: PASS.
- Varredura por senha, JWT, token, Client Secret e chave privilegiada: nenhum valor sensível encontrado.
- Callback e sincronização ainda não estavam implementados nessa validação; frontend, commit e push não foram executados.

## 19. Etapa 5.2B — implementação google-oauth-callback (11/08/2026)

### Implementação

- Criada a Edge Function pública `google-oauth-callback`, aceitando somente GET e sem exigir JWT Supabase.
- `google-oauth-start` permaneceu com `verify_jwt = true`; callback foi configurado separadamente com `verify_jwt = false`.
- O state é procurado somente pelo hash SHA-256 e consumido atomicamente com `UPDATE ... RETURNING`, condicionado a não utilizado e não expirado.
- Cancelamento do consentimento também consome o state, mas não realiza token exchange nem cria conexão.
- O verifier PKCE é descriptografado somente em memória com AES-256-GCM e nonce de 12 bytes.
- A troca do authorization code usa o endpoint oficial, redirect e secrets server-side; request e resposta sensíveis não são logados.
- Access token é usado somente em memória para UserInfo; authorization code, access token e ID token não são persistidos.
- A identidade Google usa hash SHA-256 de `sub`; e-mail completo é convertido em hint mascarado.
- Refresh token novo é cifrado com nonce independente. Quando ausente, uma credential válida anterior é preservada; primeira conexão sem refresh token falha e a transação não marca a conexão como ativa.
- Connection e credential são persistidas em transação única, sempre com o mesmo `(connection_id, user_id)`.
- Respostas temporárias de sucesso, cancelamento e erro são páginas HTML estáticas, sanitizadas e protegidas por no-store, no-referrer, nosniff e CSP restritiva.

### Validações

- Testes automatizados do callback, incluindo state inválido/expirado/usado, replay concorrente, cancelamento, PKCE, token exchange, UserInfo, refresh token, sanitização e métodos: PASS.
- Regressão automatizada de `google-oauth-start`: PASS.
- Bundle pelo CLI: não disponível na versão 2.113.0; nenhum deploy foi usado como substituto.
- `npm run build`: SUCCESS, 11/11 arquivos source/public sincronizados.
- `git diff --check`: PASS.
- Project Ref incorreto `jxfjsleqwfjrkcxccqpvw`: nenhuma ocorrência encontrada no repositório.
- Varredura de valores sensíveis: PASS; ocorrências de `access_token` e `refresh_token` são somente nomes de campos/variáveis e testes sintéticos.
- Diretórios temporários locais do Supabase CLI foram adicionados ao `.gitignore`.
- Callback, start e demais funções: nenhum deploy ou redeploy executado nesta etapa.
- Frontend, banco, RLS, commit e push: não alterados/executados.

## 20. Etapa 5.2B.1 — hardening pré-deploy do callback (11/08/2026)

### Correções de segurança

- `granted_scopes` agora aceita exclusivamente os scopes efetivamente retornados pelo token endpoint.
- `calendar.events.owned` tornou-se obrigatório; scope ausente, vazio ou sem a permissão exigida bloqueia antes de UserInfo e persistência.
- O fallback que inferia scopes solicitados foi removido e a categoria segura `required_calendar_scope_not_granted` foi adicionada.
- A connection existente e seu `google_subject_hash` são consultados com lock antes de qualquer alteração de identidade.
- Sem refresh token novo, a credential anterior só é preservada quando existe e o hash do `sub` anterior é idêntico ao novo.
- Troca de conta sem refresh token gera `account_switch_requires_refresh_token` e rollback integral, preservando metadata e credential antigas.
- Refresh token novo permite criar ou substituir conta e credential atomicamente na mesma transação.
- O consumo atômico do state passou a exigir `redirect_target = plan` no mesmo `UPDATE ... RETURNING`.

### Validações

- Calendar scope presente: PASS.
- Calendar scope ausente, vazio ou NULL: BLOCK, sem persistência.
- Scopes não retornados não são inventados: PASS.
- Primeira conexão com/sem refresh, preservação da mesma conta e troca de conta: PASS conforme regras de segurança.
- Troca de conta sem refresh preserva o estado anterior: PASS.
- State destinado a outro fluxo: BLOCK sem consumo; filtro confirmado no mesmo UPDATE atômico.
- Categorias sanitizadas de scope e troca de conta: PASS.
- `node --check` nos módulos JS e testes aplicáveis: PASS.
- Testes completos de callback: PASS.
- Regressão completa de `google-oauth-start`: PASS.
- `npm run build`: SUCCESS, 11/11 arquivos sincronizados.
- `git diff --check`: PASS.
- Security scan: nenhum valor real de Client Secret, chave, JWT, access token, refresh token ou authorization code encontrado; valores presentes nos testes são sintéticos.
- Configuração JWT preservada: start `true`, callback `false`.
- Deploy, OAuth real, frontend, Google Cloud, Secrets, banco, schema, migration, commit e push: não executados.

## 21. Fechamento QA — Etapa 5.2B em produção (11/08/2026)

### Resultado

**ETAPA 5.2B — GOOGLE OAUTH CALLBACK VALIDADA EM PRODUÇÃO**

- Deploy de `google-oauth-callback`: SUCCESS.
- Project Ref: `jxfjsleqwfjrkcxcqpvw`.
- Fluxo OAuth real `Google consent → callback → persistência`: SUCCESS.
- Callback validado com conta real QA.

### Google Calendar connection

- `connection_status = connected`.
- `calendar_id = primary`.
- `google_account_hint = ar***@gmail.com`.
- `google_subject_hash`: 64 caracteres.
- `calendar.events.owned` concedido: true.
- `last_error_code = NULL`.

### Credential

- Credential existente: true.
- `refresh_token_ciphertext`: 119 bytes.
- `refresh_token_nonce`: 12 bytes.
- `encryption_key_version = 1`.
- `token_type = Bearer`.

### OAuth State utilizado

- `state_hash`: 32 bytes.
- `redirect_target = plan`.
- State consumido: true.
- `used_at = 2026-08-11 20:08:04.999511+00`.
- `expires_at = 2026-08-11 20:15:29.94+00`.
- O state foi consumido antes da expiração e não pode ser reutilizado.

### Confirmações de segurança

- Refresh token não registrado em plaintext.
- Access token não persistido.
- Authorization code não persistido.
- Google `sub` não persistido em plaintext.
- E-mail completo não persistido.
- Nenhum secret exposto.

### Fechamento consolidado

- **ETAPA 5.2A — VALIDADA EM PRODUÇÃO**.
- **ETAPA 5.2B — VALIDADA EM PRODUÇÃO**.
- Próxima etapa planejada: **5.3 — integração da conexão Google Agenda no frontend Meu Plano**.

## 22. Etapa 5.3A — integração visual Google Agenda (11/08/2026)

### Implementação

- Adicionado card responsivo “Google Agenda” dentro de Meu Plano, entre o status geral e os cards de planejamento.
- O card possui ícone SVG inline, descrição, status textual, account hint mascarado e ação de conectar/reconectar.
- Estados suportados: loading, not_connected, connected, expired, revoked, disconnected e error.
- A consulta seleciona somente `connection_status`, `google_account_hint`, `calendar_id` e `updated_at` de `public.google_calendar_connections`, sem filtro manual de `user_id`; ownership permanece sob RLS.
- O frontend nunca consulta o schema `private` e não contém Client ID, secrets, tokens, state, PKCE ou Google subject/hash.
- Conectar/reconectar valida sessão e usuário pelos métodos oficiais do Supabase SDK, chama `google-oauth-start` via Functions SDK, impede duplo clique e mantém a authorization URL somente em memória.
- A URL recebida é validada como HTTPS, host `accounts.google.com` e caminho oficial antes da navegação.
- O callback passou a responder com HTTP 303 para a origem fixa do Dose Certa e `view=plan`, usando somente os resultados allowlisted connected, cancelled ou error.
- O frontend trata o parâmetro apenas como feedback de UX, remove-o com `history.replaceState` e sempre confirma o status real no banco.
- A lógica validada de state, PKCE, scopes, identidade e credential do callback permaneceu inalterada.
- Não foram implementados disconnect, revogação, sincronização ou criação/alteração/exclusão de eventos Google.

### UX, acessibilidade e responsividade

- Botão com `type=button`, bloqueio, estado disabled e `aria-busy` durante a conexão.
- Status e mensagens são compreensíveis sem depender apenas de cor e usam região live.
- Em telas até 760px, o card passa para duas colunas e a ação ocupa toda a largura.
- Account hint usa quebra segura e não expõe e-mail completo além do valor já mascarado pelo backend.

### Validações

- Sem connection, connected, expired, revoked e error: PASS.
- Sessão ausente, duplo clique, falha do start e URL de autorização inválida: PASS.
- Redirects seguros do callback para success/cancel/error: PASS.
- Processamento e remoção de connected/cancelled/error; parâmetro inválido ignorado: PASS.
- Consulta real da connection pública e ausência de acesso private: PASS.
- Regressão de `google-oauth-callback`: PASS.
- Regressão de `google-oauth-start`: PASS.
- `node --check` nos JS alterados e testes: PASS.
- `npm run build`: SUCCESS, 12/12 arquivos source/public sincronizados.
- `git diff --check`: PASS.
- Security scan do source e bundle: nenhum secret, token, PKCE, Google subject/hash ou acesso private encontrado.
- Meu Plano e demais módulos não tiveram suas regras funcionais alteradas; testes automatizados de OAuth passaram e a allowlist do build preservou todos os módulos existentes.
- Deploy, commit e push: não executados.

## 23. Etapa 5.3A.1 — validação real do retorno OAuth (11/08/2026)

### Causa

- O frontend consultava `public.google_calendar_connections`, mas descartava o retorno de `loadConnection()` antes de apresentar o feedback do callback.
- Assim, `google_calendar=connected` poderia produzir toast de sucesso mesmo sem connection, com status diferente de connected ou após falha da consulta.

### Correção

- `applySession()` agora captura o resultado real retornado por `controller.loadConnection()`.
- O toast de sucesso exige simultaneamente resultado OAuth `connected` e `connection_status = connected` confirmado no banco.
- Sem registro, com outro status ou com falha de consulta, o frontend mostra erro seguro de confirmação e nunca sucesso.
- Cancelamento e erro continuam independentes de uma conexão anterior; o card permanece derivado exclusivamente do banco.
- O parâmetro `google_calendar` continua removido com `history.replaceState`; `view=plan` permanece.
- Callback, OAuth start, banco, RLS, sync, connect, controle de duplo clique, sessão, mobile e acessibilidade não foram alterados.

### Validações

- URL connected + banco connected: SUCCESS toast, PASS.
- URL connected + banco sem connection: error toast, PASS.
- URL connected + banco status error: sem success, PASS.
- URL connected + falha de consulta: sem success, card em error, PASS.
- URL cancelled + banco connected: cancel toast e card conectado, PASS.
- URL error + banco connected: error toast e card conectado, PASS.
- Remoção do parâmetro e rejeição de valor inválido: PASS.
- `node --check` do módulo e teste frontend: PASS.
- Testes frontend Google Calendar: PASS.
- Regressão de callback e OAuth start: PASS.
- `git diff --check`: PASS.
- `npm run build`: SUCCESS, 12/12 arquivos sincronizados.
- Deploy, redeploy, OAuth real, sync, Google Cloud, Secrets, commit e push: não executados.
