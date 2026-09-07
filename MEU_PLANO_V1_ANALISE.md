# Meu Plano V1 — Etapa 1: análise e desenho

Status: **ANÁLISE — NÃO IMPLEMENTADO**
Data: 2026-08-09

Este documento propõe a arquitetura do módulo **Meu Plano**. Nenhum SQL foi executado, nenhuma tela foi criada e nenhuma configuração externa foi alterada nesta etapa.

## A. Estado atual

O projeto é uma aplicação estática em HTML, CSS e JavaScript puro. A raiz é a fonte de verdade; `public/` é um artefato ignorado e reconstruído por allowlist. O browser usa um único cliente Supabase com Publishable Key, Supabase Auth e sessão persistida pelo SDK.

Áreas existentes:

- simulador público de dose, com snapshot em memória;
- Auth: cadastro, login, logout e recuperação de senha;
- Meu Diário: CRUD de aplicações **realizadas** em `public.applications`;
- Meu Peso: CRUD de pesos manuais e leitura do peso vinculado a uma aplicação;
- dashboards locais derivados dos registros carregados.

O Diário já recusa `application_date` futura e informa que planejamento pertence ao Plano. Essa barreira deve ser preservada.

Estado Git analisado:

- branch `main` no commit `9ec3638`;
- cinco commits mais recentes revisados;
- nenhum diff de código no início da etapa;
- `PESO_V1_ANALISE.md` e `PESO_V1_MIGRATION_PROPOSTA.md` já estavam não rastreados e não foram modificados.

Não existe migration/DDL versionado do schema atual. Tipos, defaults e constraints só são classificados como confirmados quando há evidência operacional ou documental; o restante deve ser validado no Supabase antes de qualquer migration.

## B. Dependências existentes

### Cliente e Auth

`js/supabase-config.js` cria `window.supabaseClient` com URL e Publishable Key públicas, `persistSession`, `autoRefreshToken` e detecção de sessão na URL. `js/auth.js`, `js/diary.js` e `js/weight.js` reutilizam esse cliente.

O usuário atual é acompanhado por `getSession()` e `onAuthStateChange()`. Antes de mutações sensíveis, Diário e Peso chamam `client.auth.getUser()` e comparam o UUID retornado com o usuário mantido em memória. `user_id` não vem do formulário.

### Schema conhecido de `applications`

Colunas exercitadas pelo código e teste RLS:

| Coluna | Conhecimento confirmado |
|---|---|
| `id` | UUID operacional, usado em SELECT/UPDATE/DELETE exatos |
| `user_id` | UUID de ownership, necessário no INSERT validado |
| `application_date` | DATE e NOT NULL documentados |
| `medicine` | texto operacional; nulabilidade/limite formal não comprovados |
| `vial_mg`, `vial_ml`, `dose_mg` | numeric operacional |
| `volume_ml`, `units` | numeric derivados pelo cálculo compartilhado |
| `syringe_capacity` | numeric operacional |
| `source` | valor atual do Diário: `simulator` |
| `calculation_version` | valor atual: `1` |
| `notes` | texto operacional |
| `created_at`, `updated_at` | colunas existentes; tipos/defaults/triggers não versionados |

Peso não pertence a `applications`.

### Schema conhecido de `weight_records`

Colunas usadas atualmente:

- `id`, `user_id`, `record_date`, `weight_kg`, `notes`, `created_at`, `updated_at`;
- `source`, com valores operacionais `manual` e `application`;
- `application_id`, UUID nullable que vincula o peso à aplicação.

Há evidência operacional de `record_date` como data civil, `weight_kg` numérico e `application_id` nullable. O DDL final da migration de Peso, incluindo PK, FKs, CHECKs e defaults, não está versionado no repositório; deve ser consultado antes de criar FKs que dependam de `applications(id, user_id)`.

### `profiles` e `user_settings`

- `profiles`: o teste confirma `id` e `display_name`; criação é responsabilidade de trigger, não do front-end. SELECT/UPDATE próprios passaram e acesso cruzado foi bloqueado.
- `user_settings`: o teste confirma `user_id` e uso operacional de `height_cm`, `initial_weight_kg`, `target_weight_kg` e `journey_start_date`. Não há DDL local suficiente para afirmar tipos e constraints completos.
- Meu Plano não precisa depender dessas tabelas na V1. O timezone pode futuramente ser uma preferência do usuário, mas a ocorrência deve manter seu próprio snapshot IANA.

### RLS comprovada

O teste real com duas sessões independentes aprovou:

- `applications` e `weight_records`: SELECT/INSERT/UPDATE/DELETE próprios permitidos e cruzados bloqueados;
- `user_settings`: SELECT/UPSERT/UPDATE próprios permitidos e cruzados bloqueados;
- `profiles`: SELECT/UPDATE próprios permitidos e cruzados bloqueados; INSERT/DELETE N/A.

As definições textuais das policies não estão versionadas. Para as tabelas novas, será necessária uma migration própria e uma nova matriz RLS real.

### Build

Fluxo atual:

```text
source na raiz
  ↓ npm run build
allowlist de scripts/build.mjs
  ↓ limpeza + cópia + SHA-256 + varredura de segredos
public/
  ↓ Wrangler
Cloudflare
```

Uma implementação futura deverá incluir `js/plan.js` e eventuais assets na allowlist. `public/` nunca deve ser editada diretamente.

## C. Arquitetura proposta

Separação obrigatória:

```text
application_plans
Regra do plano e padrão de recorrência
        ↓ gera
scheduled_applications
Ocorrências futuras individuais
        ↓ somente após confirmação explícita
applications
Aplicações realmente realizadas
        ↓ vínculo opcional já existente
weight_records
Evolução de peso
```

Recomenda-se manter os nomes `application_plans` e `scheduled_applications`:

- são claros no PostgREST;
- distinguem regra e ocorrência;
- evitam confusão com `applications`, já consolidada como histórico realizado;
- permitem expansão sem transformar o Diário em agenda.

O módulo seria controlado por `js/plan.js`, usando o cliente Supabase existente, sessão oficial, estados em memória limpos no logout e componentes visuais próprios em `index.html`/`styles.css`.

## D. `application_plans`

Representa a regra reutilizável do plano, não uma data realizada.

Modelo recomendado:

| Coluna proposta | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID | PK, default gerado no banco |
| `user_id` | UUID | NOT NULL, ownership |
| `medicine` | TEXT | NOT NULL, texto não vazio |
| `dose_mg` | NUMERIC | NOT NULL, maior que zero |
| `frequency_type` | TEXT | `once`, `days` ou `weeks` |
| `frequency_interval` | INTEGER | NULL em `once`; positivo nos demais |
| `time_of_day` | TIME | horário local padrão da regra |
| `default_reminder_minutes` | INTEGER[] | snapshot padrão, por exemplo 1440, 120 e 0 |
| `active` | BOOLEAN | default TRUE; desativação lógica preferida |
| `created_at`, `updated_at` | TIMESTAMPTZ | timestamps do banco |

Justificativas:

- `frequency_type='days'` + `frequency_interval=7` significa a cada sete dias.
- `frequency_type='weeks'` + intervalo 1 mantém o mesmo dia da semana da data inicial.
- `once` usa uma única ocorrência e intervalo NULL.
- Os lembretes do plano são defaults. Cada ocorrência recebe uma cópia editável, evitando que alterar o plano reescreva silenciosamente eventos já agendados.
- `active=false` encerra novas gerações sem apagar histórico.

## E. `scheduled_applications`

Representa cada ocorrência futura materializada.

| Coluna proposta | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID | PK, default gerado no banco |
| `user_id` | UUID | NOT NULL, ownership |
| `plan_id` | UUID | NOT NULL, vínculo com a regra |
| `scheduled_date` | DATE | data civil local |
| `scheduled_time` | TIME | horário civil local |
| `timezone` | TEXT | nome IANA, por exemplo `America/Sao_Paulo` |
| `status` | TEXT | `scheduled`, `completed`, `cancelled` ou `missed` |
| `reminder_minutes` | INTEGER[] | cópia/override por ocorrência |
| `notes` | TEXT | observação opcional do planejamento |
| `google_calendar_id` | TEXT | calendário remoto usado, nullable |
| `google_event_id` | TEXT | evento remoto, nullable |
| `google_sync_status` | TEXT | `not_connected`, `pending`, `synced` ou `error` |
| `completed_application_id` | UUID | nullable e único, aponta para a aplicação confirmada |
| `created_at`, `updated_at` | TIMESTAMPTZ | timestamps do banco |

`google_calendar_id` é recomendado além do ID do evento: atualização e cancelamento na Calendar API precisam identificar o calendário onde o evento foi criado.

Uma UNIQUE em `(plan_id, scheduled_date, scheduled_time)` evita geração duplicada da mesma ocorrência. Se o negócio futuramente permitir duas ocorrências do mesmo plano no mesmo instante, essa regra deverá ser revista antes da migration.

## F. Relação com `applications`

Uma ocorrência futura nunca cria uma aplicação automaticamente.

Fluxo recomendado:

```text
scheduled_applications.status = scheduled
                ↓ usuário escolhe “Confirmar aplicação”
abrir o formulário completo já existente do Diário
                ↓ usuário informa/confirma frasco, dose, seringa, peso e data real
transação no banco:
  INSERT applications
  UPDATE scheduled_applications
    status = completed
    completed_application_id = applications.id
```

O formulário do Plano não contém volume, UI, seringa ou apresentação. Logo, “Confirmar aplicação” deve reaproveitar o formulário/cálculo do Diário e apenas pré-preencher medicamento, dose e data planejada. A data efetiva pode ser corrigida pelo usuário.

Para evitar aplicação criada sem baixa da ocorrência, a futura implementação deve preferir uma função/RPC transacional com `SECURITY INVOKER`, ownership por `auth.uid()` e payload completo validado. Se o DDL/RLS não permitir esse desenho, a alternativa precisa documentar e tratar explicitamente sucesso parcial; duas chamadas independentes no browser não são a opção ideal.

`completed_application_id` deve ser imutável depois de preenchido, salvo fluxo explícito de correção. Uma ocorrência completed não pode confirmar novamente.

## G. Relação com `weight_records`

Meu Plano não grava peso.

Ao confirmar uma ocorrência, o fluxo passa ao Diário. Se o usuário informar peso, o mecanismo existente cria/atualiza `weight_records` com:

- `source='application'`;
- `application_id` igual à aplicação criada;
- `record_date` igual à data efetiva.

Assim, o encadeamento é:

```text
scheduled_applications
  → completed_application_id
applications
  ← weight_records.application_id
```

Não deve existir FK direta entre ocorrência futura e peso.

## H. Recorrência

O plano guarda a regra, mas o calendário consulta ocorrências individuais.

Estratégia V1:

1. usuário informa data inicial, horário e frequência;
2. o backend valida a regra e gera ocorrências para uma janela limitada, recomendação inicial de 90 dias ou 12 ocorrências;
3. cada ocorrência recebe data, hora, timezone e lembretes próprios;
4. ao se aproximar do fim da janela, uma rotina idempotente pode gerar a próxima janela;
5. uma chave/constraint impede duplicação.

Padrões iniciais:

- única: uma ocorrência;
- a cada X dias: soma calendário de X dias a partir da data inicial;
- semanal: mesmo dia da semana, a cada X semanas.

Editar apenas uma ocorrência altera `scheduled_applications`. Editar a regra deve perguntar se afeta somente novas ocorrências ou também as futuras ainda `scheduled`; nunca deve alterar completed/cancelled silenciosamente.

Não usar apenas RRULE abstrata como fonte da tela. Materializar ocorrências permite edição, cancelamento, reagendamento, confirmação e sincronização individual.

## I. Status

Modelo suficiente para V1:

- `scheduled`: futura e ativa;
- `completed`: confirmada e vinculada a uma application;
- `cancelled`: cancelada explicitamente;
- `missed`: data passou sem confirmação, após regra de negócio explícita.

Reagendar mantém `scheduled` e altera data/hora. O histórico de alteração não faz parte da V1; se auditoria de reagendamento se tornar requisito, deverá usar tabela de eventos própria, não novos estados artificiais.

Não marcar automaticamente como completed. A transição para missed também deve ser definida com cautela: atraso não prova que a dose não foi aplicada.

## J. UX mobile

Ordem mobile recomendada:

1. card **Próxima aplicação** com data, hora, medicamento, dose e status;
2. botão primário **+ Agendar aplicação**;
3. lista compacta **Próximas aplicações**;
4. botão **Ver calendário** para expandir/abrir a visão mensal;
5. card discreto de conexão com Google Agenda.

Cada ocorrência usa ícone de ampola e ações já padronizadas: lápis verde para editar e lixeira vermelho-claro para cancelar/excluir quando permitido. A confirmação deve ser textual e destacada, não apenas um ícone ambíguo.

Estados necessários: loading, vazio, erro, offline/pendente de sincronização e sucesso. O calendário mensal não deve dominar a primeira dobra no celular.

### Formulário mínimo

- Medicamento;
- Dose planejada em mg;
- Data inicial;
- Horário;
- Frequência: única, a cada X dias ou semanal;
- Lembretes com opções controladas;
- Observação opcional.

Não incluir apresentação, volume do frasco, UI, seringa ou cálculo. Exibir aviso: o agendamento é um lembrete e não altera prescrição.

## K. UX desktop

Layout recomendado:

- cabeçalho “Calendário de aplicações”, **Agendar aplicação** e status Google;
- calendário mensal à esquerda;
- “Próxima aplicação” à direita;
- lista de próximas ocorrências abaixo;
- detalhes/edição em modal acessível, seguindo foco, ESC e retorno ao acionador já usados no projeto.

O calendário usa marcadores de ampola, mas datas, dose e status permanecem disponíveis em texto e `aria-label`. Cor não deve ser o único indicador.

## L. Google Calendar

Arquitetura futura:

```text
Browser autenticado
  ↓ solicita conexão/operação sem receber credenciais Google persistentes
Supabase Edge Function
  ↓ OAuth 2.0 / token server-side
Google Calendar API
```

V1 deve ser unidirecional: **Meu Plano → Google Agenda**.

Operações:

- após criar ocorrência: criar evento;
- após reagendar/editar: atualizar evento identificado por calendar/event ID;
- ao cancelar: cancelar/excluir o evento conforme a política escolhida;
- guardar `scheduled_application_id` em `extendedProperties.private` do evento para correlação, sem dados clínicos desnecessários.

Tokens Google não podem ficar em JavaScript, localStorage, sessionStorage ou tabela legível diretamente pelo cliente. A futura solução deverá guardar refresh token cifrado em infraestrutura server-side, solicitar o menor escopo possível e permitir desconexão/revogação.

Não implementar sincronização bidirecional na V1. Webhooks, alterações feitas diretamente no Google, conflitos, eventos duplicados, expiração de canais e reconciliação são uma etapa posterior.

## M. Lembretes

Modelo V1 por ocorrência: `reminder_minutes`, contendo opções controladas, por exemplo:

- `1440`: um dia antes;
- `120`: duas horas antes;
- `0`: no horário.

Ao criar o evento Google, esses offsets viram lembretes do evento. O status `synced` significa apenas que a API aceitou a sincronização; não garante que o aparelho entregará um alarme. Entrega depende das configurações, permissões, conectividade e políticas do Google/dispositivo.

Web Push/PWA próprio é outro sistema: exige consentimento, service worker, assinatura push, backend de envio, reintentos, timezone e política de expiração. Deve ser planejado somente depois do calendário local e Google estáveis.

## N. Segurança/RLS

Objetivo para as duas tabelas:

| Operação | A→A | A→B | B→B | B→A |
|---|---|---|---|---|
| SELECT | PASS | BLOCK | PASS | BLOCK |
| INSERT | PASS | BLOCK | PASS | BLOCK |
| UPDATE | PASS | BLOCK | PASS | BLOCK |
| DELETE | PASS conforme regra | BLOCK | PASS conforme regra | BLOCK |

Policies conceituais:

```sql
alter table public.application_plans enable row level security;
alter table public.scheduled_applications enable row level security;

-- Em cada tabela:
-- SELECT/DELETE: USING (user_id = auth.uid())
-- INSERT: WITH CHECK (user_id = auth.uid())
-- UPDATE: USING (user_id = auth.uid())
--         WITH CHECK (user_id = auth.uid())
```

Essas policies são necessárias, mas não suficientes para vínculos seguros. Usar FKs compostas:

```text
scheduled_applications(plan_id, user_id)
  → application_plans(id, user_id)

scheduled_applications(completed_application_id, user_id)
  → applications(id, user_id)
```

Isso exige UNIQUE candidata em `(id, user_id)` nas tabelas referenciadas, caso ainda não exista. A definição real de `applications` deve ser inspecionada antes.

Edge Functions devem validar o JWT Supabase, derivar o usuário da sessão e nunca aceitar ownership apenas do body. `service_role`, se algum processamento interno futuro realmente exigir, deve permanecer exclusivamente no servidor e não substituir validações de ownership.

Após migration, executar testes com duas sessões independentes, UUID cruzado conhecido, tentativas de associar plano/aplicação do outro usuário e cleanup somente por IDs criados no teste.

## O. Timezone

`scheduled_date` e `scheduled_time` representam a intenção civil do usuário. `timezone` guarda um identificador IANA, por exemplo `America/Sao_Paulo`.

Regras:

- não criar `Date('YYYY-MM-DD')` no browser para datas civis;
- não armazenar somente offset como `-03:00`, pois regras podem mudar;
- ao gerar evento Google ou tarefa de lembrete, combinar data + hora usando a timezone IANA;
- recorrência deve somar dias/semanas no calendário local e depois resolver o instante, não somar milissegundos UTC;
- mudança de timezone do perfil não deve reinterpretar silenciosamente ocorrências existentes: cada ocorrência mantém seu snapshot.

Horários inexistentes/ambíguos por mudança de relógio devem ser recusados ou apresentados para confirmação. O banco não valida sozinho se um texto é uma timezone IANA válida; a futura migration/Edge Function deve validar contra uma lista confiável.

## P. Migration proposta

SQL **conceitual**, sujeito à inspeção do DDL real:

```sql
begin;

create table public.application_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medicine text not null check (length(btrim(medicine)) between 1 and 100),
  dose_mg numeric not null check (dose_mg > 0),
  frequency_type text not null
    check (frequency_type in ('once', 'days', 'weeks')),
  frequency_interval integer null,
  time_of_day time without time zone not null,
  default_reminder_minutes integer[] not null default array[1440, 120, 0],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_plans_frequency_check check (
    (frequency_type = 'once' and frequency_interval is null)
    or
    (frequency_type in ('days', 'weeks') and frequency_interval between 1 and 365)
  ),
  constraint application_plans_reminders_check check (
    cardinality(default_reminder_minutes) between 0 and 5
    and default_reminder_minutes <@ array[0, 120, 1440]::integer[]
  ),
  unique (id, user_id)
);

create table public.scheduled_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  scheduled_date date not null,
  scheduled_time time without time zone not null,
  timezone text not null check (length(timezone) between 1 and 100),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'missed')),
  reminder_minutes integer[] not null default array[1440, 120, 0],
  notes text null check (notes is null or length(notes) <= 500),
  google_calendar_id text null,
  google_event_id text null,
  google_sync_status text not null default 'not_connected'
    check (google_sync_status in ('not_connected', 'pending', 'synced', 'error')),
  completed_application_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_plan_owner_fkey
    foreign key (plan_id, user_id)
    references public.application_plans(id, user_id)
    on delete restrict,
  constraint scheduled_completed_application_owner_fkey
    foreign key (completed_application_id, user_id)
    references public.applications(id, user_id)
    on delete restrict,
  constraint scheduled_reminders_check check (
    cardinality(reminder_minutes) between 0 and 5
    and reminder_minutes <@ array[0, 120, 1440]::integer[]
  ),
  constraint scheduled_completion_check check (
    (status = 'completed' and completed_application_id is not null)
    or
    (status <> 'completed' and completed_application_id is null)
  ),
  unique (id, user_id),
  unique (completed_application_id),
  unique (plan_id, scheduled_date, scheduled_time)
);

create index application_plans_user_active_idx
  on public.application_plans(user_id, active, created_at desc);

create index scheduled_applications_user_date_idx
  on public.scheduled_applications
  (user_id, scheduled_date, scheduled_time, created_at);

create index scheduled_applications_pending_google_idx
  on public.scheduled_applications(google_sync_status, updated_at)
  where google_sync_status in ('pending', 'error');

alter table public.application_plans enable row level security;
alter table public.scheduled_applications enable row level security;

-- Criar policies ownership descritas na seção N.
-- Reutilizar ou criar trigger padronizado de updated_at somente após
-- confirmar a implementação existente do projeto.

commit;
```

Observações obrigatórias antes de converter isso em migration executável:

1. confirmar disponibilidade de `gen_random_uuid()`;
2. confirmar a chave candidata `(applications.id, applications.user_id)`;
3. confirmar padrão real de trigger `updated_at`;
4. decidir se a lista fixa de lembretes continuará limitada a 0/120/1440;
5. criar migrations separadas: primeiro `application_plans`, depois `scheduled_applications`;
6. criar a função transacional de confirmação em migration posterior, após validar o fluxo do Diário;
7. validar policies e FKs com duas sessões reais.

### Exclusão e cancelamento

- Plano com ocorrências: preferir `active=false`, não DELETE físico.
- Encerrar plano: cancelar em lote somente ocorrências futuras `scheduled`, após confirmação; preservar completed/cancelled/missed.
- Excluir/cancelar ocorrência: afetar apenas aquela ocorrência e seu evento Google.
- Ocorrência completed: não apagar nem desvincular silenciosamente; FK `RESTRICT` protege a relação.
- Aplicação vinculada: sua exclusão exige regra de negócio própria; na V1, `RESTRICT` é mais seguro que apagar/soltar automaticamente o comprovante da confirmação.

### Rollback conceitual

Executar somente depois de exportar/auditar dados e remover dependências futuras:

```sql
begin;
drop table if exists public.scheduled_applications;
drop table if exists public.application_plans;
commit;
```

Rollback destrutivo não deve ser usado após dados reais sem backup e plano de preservação. Policies, triggers e funções com nomes definidos pela migration executável também deverão ser removidos explicitamente.

## Q. Riscos

- Misturar ocorrência futura com `applications` e distorcer o Diário.
- Confirmar duas vezes por duplo clique ou retry; exigir idempotência/constraint/transação.
- Gerar ocorrências duplicadas ao expandir a janela recorrente.
- Criar application e falhar ao marcar ocorrência como completed.
- Alterar regra e reescrever ocorrências já personalizadas.
- Bugs UTC/DST deslocarem horário ou data.
- Excluir plano e perder rastreabilidade de ocorrências completed.
- Evento Google criado, mas ID não persistido; retry gerar duplicidade.
- Evento removido diretamente no Google sem conhecimento do app na sincronização unidirecional.
- Refresh token Google exposto ou revogado.
- `synced` ser interpretado como lembrete garantido.
- Dados sensíveis demais no título/descrição do evento compartilhado.
- RLS correta na linha, mas FK simples permitir vínculo cruzado por UUID.
- DDL atual não versionado divergir das suposições do SQL conceitual.
- Crescimento ilimitado de ocorrências; usar janela de geração e paginação.
- A exclusão atual de application conflitar com uma futura FK `RESTRICT`; definir UX antes da migration final.

## R. Ordem de implementação

Sequência de menor risco:

1. consultar e versionar o DDL real necessário, incluindo constraints e policies atuais;
2. transformar o SQL conceitual em duas migrations revisáveis;
3. criar tabelas, índices, FKs compostas, CHECKs, timestamps e RLS;
4. executar matriz RLS A/B e testes de integridade/rollback;
5. implementar `js/plan.js` e Meu Plano local, sem Google;
6. implementar CRUD de planos e ocorrências, recorrência idempotente e UX mobile-first;
7. implementar confirmação explícita reaproveitando Diário e uma operação transacional;
8. testar regressão de Diário, Peso, Auth, RLS e build;
9. implementar conexão Google OAuth por Edge Function e armazenamento seguro de tokens;
10. implementar create/update/cancel unidirecional no Google Calendar com idempotência;
11. adicionar reconciliação e observabilidade de erros;
12. considerar Web Push/PWA somente em sprint futura independente.

Cada etapa de implementação deve terminar em `npm run build`, confirmação source/public e testes proporcionais ao risco antes de commit/deploy.

## S. Recomendação final

Adotar `application_plans` + `scheduled_applications` é a separação correta. O plano guarda a regra; ocorrências individuais dão flexibilidade; `applications` continua sendo prova de algo realizado; `weight_records` permanece dedicado ao peso.

A primeira entrega funcional deve ser **Meu Plano sem Google**, com calendário/lista, recorrência simples, CRUD e confirmação explícita integrada ao Diário. Só depois de validar dados, RLS, idempotência, timezone e transação de confirmação deve entrar OAuth/Calendar.

O Google Agenda deve ser um canal de lembrete sincronizado, nunca a fonte clínica de verdade. A fonte de verdade do planejamento é `scheduled_applications`; a fonte de verdade do realizado é `applications`.

**Nenhuma parte desta proposta foi implementada ou executada nesta etapa.**
