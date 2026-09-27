# ADMIN-ANALYTICS-V1 — Console administrativo de adoção

**Branch:** `feature/product-analytics-dashboard`
**Estado:** PRONTA PARA DEV — sem autorização de deploy/migration remota

## Decisões de produto aprovadas

- Administrador autorizado: conta configurada no backend para o endereço informado pelo PO.
- Transparência: manter o texto atual, pois V1 usa somente os quatro eventos mínimos já existentes.
- Retenção: eventos brutos de `product_events` por 30 dias; agregados calculados sob demanda, sem persistir dados novos.
- Eventos V1: somente `account_created`, `onboarding_completed`, `first_product_action` e `product_returned`.

## Escopo

1. Criar `admin.html` independente, com login Supabase e dashboard inicialmente vazio até autenticação.
2. Criar `js/admin-analytics.js` para login, sessão, carregamento de agregados, logout e estados de erro acessíveis.
3. Criar Edge Function `admin-product-analytics` que:
   - exige JWT válido;
   - verifica o e-mail permitido exclusivamente no servidor por segredo de ambiente;
   - usa credencial de servidor somente para agregar os eventos existentes;
   - retorna apenas métricas agregadas de 30 dias, sem `user_id`, e-mail ou dados clínicos;
   - aplica CORS allowlist já usada no projeto;
   - executa limpeza defensiva de eventos com mais de 30 dias ao atender o dashboard.
4. Criar migration versionada para retenção diária de 30 dias, com agendamento explícito e reversível quando a extensão suportada estiver disponível.
5. Criar testes locais de contrato para página, função, allowlist, agregação, ausência de PII e retenção.

## Dashboard V1

- Período: últimos 30 dias, sem filtro por usuário.
- Cards: novas contas, conclusão de onboarding, ativação, retorno e conversão simulador → conta.
- Funil: conta criada → onboarding concluído → primeira ação → retorno.
- Adoção: distribuição de `first_product_action` por `application`, `weight`, `plan` e `google_calendar`.
- Insights: regras explicáveis com volume mínimo de 30 usuários e comparação de 7 dias com histórico anterior.

## Critérios de aceite

- Conta não autorizada recebe acesso negado sem dados agregados.
- E-mail permitido não aparece no HTML/JS público nem na resposta da função.
- Respostas não incluem identificadores, conteúdo clínico ou eventos individuais.
- Página funciona em desktop e móvel, tem loading/erro/logout e navegação por teclado.
- Não há alteração em eventos existentes, RLS, app do paciente ou coleta de novos campos.
- Testes, build e `git diff --check` passam.

## Fora do escopo

- Novos eventos ou tracking de visitantes anônimos;
- dashboard para pacientes;
- deploy Cloudflare ou de Edge Function;
- aplicação da migration de retenção;
- configuração de segredos de produção.

## Gate de produção posterior

Antes de publicar: configurar segredo administrativo do Edge Function, aplicar somente a migration de retenção após precheck do projeto Supabase e validar em conta administrativa autorizada e conta não autorizada descartável.
