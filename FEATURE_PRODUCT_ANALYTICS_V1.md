# FEATURE-ANL-001 — Observabilidade de produto e dashboard interno

**Branch:** `feature/product-analytics-dashboard`  
**Dono de produto:** PO/Guardião  
**Estado:** ESPECIFICAÇÃO PRONTA — bloqueada para implementação até definir acesso administrativo e base legal de telemetria

## Objetivo

Permitir que a equipe acompanhe, por período, a adoção e a usabilidade do Dose Certa sem expor informações clínicas, dados identificáveis ou o conteúdo dos registros dos usuários.

O resultado será um dashboard interno, protegido, orientado a decisões de produto: identificar onde usuários abandonam a jornada, quais recursos geram retorno e quais melhorias devem entrar no backlog.

## Princípios inegociáveis

- Não registrar dose, medicamento, peso, altura, anotações, efeitos, localização, e-mail, nome, IP, user agent bruto ou conteúdo de formulários.
- Não disponibilizar registros individuais no dashboard; somente agregados.
- Não usar `service_role`, chave secreta ou leitura direta de tabelas clínicas no navegador.
- Não permitir que usuários comuns leiam eventos de outros usuários.
- Cada evento deve ter finalidade de produto documentada, retenção definida e atualização correspondente de transparência/privacidade antes da publicação.

## Base já existente

`product_events` já registra, por usuário/dia, eventos mínimos autenticados:

- `account_created`;
- `onboarding_completed`;
- `first_product_action`;
- `product_returned`.

O campo `simulated_in_session` permite identificar se a criação de conta ocorreu após uma simulação na mesma sessão. A tabela não concede `SELECT` ao usuário comum, o que é adequado.

Limitação: o modelo atual mede usuários únicos por dia, não passos detalhados de sessão. Ele não deve ser usado para inferir funis que ainda não são observáveis.

## Dashboard interno V1

### 1. Resumo executivo

| KPI | Fórmula | Decisão atendida |
| --- | --- | --- |
| Novas contas | usuários únicos com `account_created` | aquisição orgânica |
| Ativação | usuários com `first_product_action` ÷ novas contas da coorte | valor inicial percebido |
| Conclusão de onboarding | `onboarding_completed` ÷ `account_created` | fricção de perfil |
| Retorno D7 | usuários da coorte que retornam no dia 7 ÷ coorte | retenção inicial |
| Simulação → conta | `account_created` com `simulated_in_session=true` ÷ contas criadas | conversão do simulador |
| Saúde da instrumentação | eventos válidos gravados ÷ chamadas de tracking | confiabilidade da análise |

### 2. Funil de jornada

Apresentar coortes por dia/semana, com contagem e taxa de avanço:

```text
Conta criada
→ Onboarding concluído
→ Primeira ação de produto
→ Retorno em D7
```

O dashboard deve deixar explícito que a primeira versão não mede visitantes anônimos. Uma etapa só aparece no funil se houver um evento coletado e documentado para ela.

### 3. Adoção de recursos

| Recurso | Evento V1 proposto | KPI |
| --- | --- | --- |
| Simulador | `simulator_completed` | usuários únicos/dia e conversão posterior em conta |
| Diário | `diary_opened`, `application_recorded` | adoção e primeira aplicação registrada |
| Peso | `weight_recorded` | usuários que acompanham evolução |
| Plano/lembretes | `plan_opened`, `reminder_created` | ativação de planejamento |
| Google Agenda | `calendar_connect_started`, `calendar_connected` | tentativa → conexão bem-sucedida |
| Relatório | `report_exported` | valor percebido para consulta |
| Medidas corporais | `body_measurements_recorded` | adoção de acompanhamento completo |

Todos os eventos propostos usam apenas nome do evento, data, origem e categoria permitida — nunca valores de saúde ou conteúdo livre.

### 4. Usabilidade e qualidade

| KPI | Definição |
| --- | --- |
| Taxa de erro funcional | erros sanitizados por ação iniciada, por recurso |
| Cancelamento de fluxo | fechamento/cancelamento antes da conclusão, sem conteúdo do formulário |
| Tempo até primeira ação | dias entre conta criada e primeira ação de produto, agregado por coorte |
| Conclusão de conexão Agenda | conexões concluídas ÷ tentativas |
| Cobertura de telemetria | percentual de eventos esperados que chegam ao endpoint |

Erros devem ser classificados por código interno permitido, nunca por payload, texto livre ou dados de saúde.

## Insights que o dashboard deve gerar

Os insights são hipóteses priorizáveis, não decisões automáticas. Cada alerta deve comparar os últimos 7 dias com a média das 4 semanas anteriores e exigir volume mínimo de 30 usuários na coorte.

| Sinal | Hipótese | Próxima feature sugerida |
| --- | --- | --- |
| Onboarding < 65% das contas | formulário longo ou benefício pouco claro | onboarding progressivo e salvamento por etapa |
| Ativação < 40% em 7 dias | CTA pós-cadastro não conduz ao primeiro valor | checklist “primeiros passos” no Diário |
| Retorno D7 < 30% | lembretes e rotina não estão gerando hábito | check-in semanal e lembrete de registro de peso |
| Agenda: tentativa alta, conexão baixa | OAuth/permissões geram fricção | diagnóstico de conexão e alternativa de lembrete local |
| Relatório exportado por poucos usuários ativos | benefício clínico pouco visível | CTA contextual antes da consulta e preview do relatório |
| Medidas corporais pouco usadas, peso usado | formulário de medidas parece custoso | registro rápido por área e lembretes mensais |
| Taxa de erro elevada em um fluxo | problema técnico ou cópia confusa | investigação UX direcionada e teste de regressão dedicado |

Os percentuais são limiares iniciais. Após 30 dias de dados consistentes, o PO deve recalibrá-los conforme a linha de base real do produto.

## Arquitetura proposta

### Fase A — Coleta mínima e agregação segura

1. Criar uma migration versionada que amplie a lista permitida de eventos e `action_kind`, sem modificar eventos existentes.
2. Manter inserção exclusivamente pela Edge Function validada, com JWT do usuário e allowlist de campos.
3. Criar uma fonte de agregados por dia/coorte; nenhum dado individual é retornado.
4. Adicionar testes de contrato para allowlist, ausência de campos clínicos, RLS e agregações.

### Fase B — Console administrativo interno

1. Criar rota/página de dashboard separada do aplicativo do paciente.
2. Proteger a leitura por autorização administrativa explícita e auditável, definida antes da implementação.
3. Usar uma Edge Function de leitura agregada, com resposta mínima e cache curto.
4. Exibir filtros de período, coorte e recurso; jamais filtro por usuário individual.

### Fase C — Insights e backlog

1. Calcular indicadores e comparativos agregados no backend.
2. Exibir alertas explicáveis, com métrica, período, volume e recomendação.
3. Registrar insight aprovado pelo PO como item rastreável de backlog, sem automatizar mudanças de produto.

## Critérios de aceite

- Dashboard não é acessível por contas de pacientes nem por URLs não autorizadas.
- Nenhuma resposta, evento, log ou screenshot contém dados clínicos ou identificadores diretos.
- Todos os KPIs exibem definição, período, denominador e tamanho da coorte.
- Um período sem dados mostra “dados insuficientes”, nunca zero como inferência.
- Eventos duplicados são idempotentes e não inflacionam usuários únicos.
- Funil, retenção e insights são cobertos por testes de contrato e testes de interface.
- A política de privacidade/transparência é atualizada antes do deploy se a coleta for ampliada.

## Decisões obrigatórias antes do DEV iniciar

1. **Acesso administrativo:** qual conta/grupo pode ver o console e qual mecanismo será usado (recomendação: controle no backend com allowlist administrativa, nunca somente esconder menu).
2. **Base legal e transparência:** aprovar texto de privacidade, finalidade e retenção da telemetria ampliada.
3. **Retenção:** definir prazo de retenção dos eventos brutos e dos agregados.
4. **Escopo V1:** aprovar os eventos propostos ou começar apenas com os quatro eventos existentes.

## Próximo passo do PO

Obter as quatro decisões acima. Após isso, abrir a tarefa DEV da Fase A, com migration isolada, avaliação de risco de produção e gate QA específico para segurança e privacidade.
