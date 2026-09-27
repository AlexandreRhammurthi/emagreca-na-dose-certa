# Relatório DEV — ADMIN-ANALYTICS-V1

**Estado:** PRONTA PARA QA — SEM PUBLICAÇÃO REMOTA
**Branch:** `feature/product-analytics-dashboard`
**HEAD sob teste:** `04b86a5` (sem commit da tarefa)

## Implementação

- `admin.html`: login separado e dashboard de métricas agregadas dos últimos 30 dias, com loading, erro, logout, teclado e layout responsivo.
- `js/admin-analytics.js`: autenticação por sessão normal, consulta da Edge Function, renderização segura com DOM e nenhum identificador/segredo no cliente.
- `supabase/functions/admin-product-analytics/index.ts`: valida JWT, compara a conta autorizada somente com o segredo `ADMIN_ANALYTICS_ALLOWED_EMAIL`, faz limpeza defensiva de 30 dias e retorna apenas agregados dos quatro eventos aprovados.
- `supabase/migrations/20260927000000_product_events_retention_v1.sql`: índice, rotina de purge com `SECURITY INVOKER` e agendamento diário reversível quando `pg_cron` já existir.
- `tests/local/contracts/admin-analytics-v1.test.mjs`: contratos de página, cliente, Edge Function, CORS, allowlist, ausência de PII na resposta e retenção.
- `scripts/build.mjs` e `styles.css`: inclusão segura dos artefatos de fonte e estilos do console.

O app do paciente, eventos existentes, RLS e coleta de telemetria foram preservados. O e-mail administrativo não foi incluído em HTML, JavaScript público, resposta, teste ou log. A função usa somente os quatro nomes de evento já existentes e não retorna identificadores, conteúdo clínico ou eventos individuais.

## Validações

| Comando | Resultado |
| --- | --- |
| `node --test tests/local/contracts/admin-analytics-v1.test.mjs` | PASS — 5/5 |
| `npm.cmd test` | PASS — 152/152 |
| `npm.cmd run build` | PASS — BUILD: SUCCESS; 24/24 arquivos sincronizados; Secret Key/service_role no bundle: NÃO |
| `git diff --check` | PASS |

## Riscos conhecidos

- A migration requer precheck do projeto Supabase e não deve ser aplicada automaticamente; se `pg_cron` não estiver habilitado, a limpeza defensiva da Edge Function permanece ativa.
- Antes de deploy, é necessário configurar exclusivamente no ambiente da Edge Function o segredo administrativo aprovado. Não há valor de segredo em arquivos do repositório.
- Validação visual em Chromium e teste manual de conta autorizada/não autorizada permanecem pendentes do QA e do gate de produção.

## Instruções para QA

1. Abrir `admin.html` deslogado: confirmar somente login, navegação por teclado e ausência de dashboard.
2. Testar credenciais inválidas e resposta de acesso negado, sem conteúdo agregado exibido.
3. Em ambiente autorizado, conferir cards, funil, adoção, estado de dados insuficientes, atualização e logout.
4. Validar desktop, 390 px, console, rede e screenshots sem PII.
5. Confirmar que o app do paciente continua funcionando sem alteração.
