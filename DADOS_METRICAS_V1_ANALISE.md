# Dados e métricas V1 — definição e arquitetura

## Objetivo

Medir ativação e retenção do produto sem registrar dados clínicos, conteúdos livres ou valores usados no simulador. Esta etapa não cria tabela, não ativa rastreador externo e não altera produção.

## Estado atual

- Não há biblioteca de analytics, pixel ou rastreador de terceiros no frontend.
- O Diário já possui métricas exibidas ao próprio usuário; elas não são telemetria de produto.
- O Onboarding V1 dispõe de perfil, consentimentos e uma Edge Function de exclusão; a futura telemetria deve respeitar a mesma exclusão em cascade.

## Funil de ativação V1

| Etapa | Evento permitido | Definição |
|---|---|---|
| Interesse | `simulator_result_ready_local` | Marcador apenas na sessão do navegador; não enviado sozinho ao servidor. |
| Cadastro | `account_created` | Conta autenticada criada; inclui somente `simulated_in_session` booleano. |
| Perfil | `onboarding_completed` | Perfil do onboarding gravado com sucesso. |
| Primeiro valor | `first_product_action` | Primeira aplicação, plano, peso ou conexão Google concluídos; registra somente a categoria da ação. |
| Retenção | `product_returned` | Primeiro uso autenticado em um novo dia civil, sem informação clínica. |

Ativação = `onboarding_completed` + `first_product_action` em até sete dias da criação da conta.

## Dados expressamente proibidos

Nunca registrar em eventos de produto:

- medicamento, dose, mg, mL, UI, peso, altura, sexo/gênero, idade, data de nascimento ou objetivo de saúde;
- cidade, estado, país, observações, notas, datas de aplicação ou dados do Google Agenda;
- e-mail, nome, telefone, IP, User-Agent integral, token, URL com parâmetros, identificador Google ou conteúdo de formulário;
- JSON livre, texto livre ou propriedades arbitrárias enviadas pelo cliente.

## Contrato mínimo de evento

```text
id             UUID
user_id        UUID derivado exclusivamente do JWT
event_name     enum permitido
occurred_at    timestamptz do servidor
source         enum: simulator | onboarding | diary | weight | plan | google_calendar
action_kind    enum nullable: application | weight | plan | google_calendar
simulated_in_session boolean nullable
```

`user_id` é pseudonimizado para consultas internas e não deve ser exibido nos painéis. Não haverá campo genérico `metadata` nesta V1.

## Arquitetura recomendada

1. Criar `public.product_events` em migration aditiva, com FK para `auth.users(id) ON DELETE CASCADE`.
2. Ativar RLS. O cliente não recebe `SELECT` sobre telemetria e não usa chave administrativa.
3. Publicar uma Edge Function autenticada `record-product-event`, com `verify_jwt = true` e allowlist fechada de `event_name`, `source` e `action_kind`.
4. A função deriva o usuário de `auth.uid()`/JWT e grava o horário no servidor. Ela rejeita chaves extras, strings livres e eventos fora da allowlist.
5. O frontend envia eventos somente depois da autenticação. Antes do cadastro, o resultado do simulador fica apenas em `sessionStorage` como flag booleana e é convertido em `simulated_in_session` no evento `account_created`.
6. Painéis internos usam apenas agregados por período, nunca listas de usuários.

## RLS e exclusão

- INSERT: permitido apenas pelo fluxo autenticado, com `user_id = auth.uid()`.
- SELECT/UPDATE/DELETE: bloqueados ao cliente por padrão.
- Exclusão de `auth.users`: remove os eventos por cascade; isto entra no teste da Edge Function `delete-account`.
- Não usar `service_role` no navegador. Qualquer consulta administrativa futura deve ficar fora do cliente e ter acesso mínimo documentado.

## Retenção e transparência

- Retenção recomendada: 13 meses para agregação de retenção anual; depois, excluir eventos brutos ou manter somente agregados sem identificador.
- Atualizar a Política de Privacidade antes da ativação, declarando a coleta de métricas operacionais não clínicas e sua finalidade.
- Não vincular dados de métricas a publicidade comportamental, venda de dados ou segmentação de saúde.

## Painel interno mínimo

| Indicador | Fórmula |
|---|---|
| Cadastros | contas com `account_created` por dia/semana |
| Conversão simulador → cadastro | `account_created` com `simulated_in_session=true` / `account_created` |
| Conclusão de perfil | usuários com `onboarding_completed` / contas criadas |
| Ativação 7 dias | usuários ativados em até 7 dias / contas criadas |
| Retenção D7/D30 | usuários com `product_returned` no período / coorte de criação |
| Conexão Google | `first_product_action` com `action_kind=google_calendar` / usuários ativados |

## Testes obrigatórios da próxima etapa

1. Cliente não consegue inserir evento em nome de outro usuário.
2. Cliente não consegue consultar eventos próprios ou de terceiros.
3. Evento fora da allowlist é recusado.
4. Campo extra, texto livre e propriedade clínica são recusados.
5. Ação real gera somente a categoria permitida.
6. Exclusão de conta remove eventos em cascade.
7. Log, resposta e painel não expõem identificadores, tokens ou dados clínicos.

## Riscos e decisão necessária

Implementar telemetria em produção cria uma nova finalidade de tratamento de dados. Antes da migration e do deploy da Edge Function, é necessária revisão do texto de Privacidade e autorização explícita para escrever a tabela de eventos em produção.

## Recomendação

Prosseguir com uma Sprint 2A de implementação local da allowlist, migration e testes. A aplicação em produção fica bloqueada até aprovação de privacidade e autorização específica para a nova coleta.
