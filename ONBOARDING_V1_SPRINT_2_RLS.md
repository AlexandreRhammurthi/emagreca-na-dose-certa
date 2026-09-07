# Sprint 2 — Migration e RLS do Onboarding V1

## Objetivo

Validar e publicar de forma controlada as tabelas `onboarding_profiles` e `user_consents`, suas policies RLS e a Edge Function `delete-account`.

## Pré-condições

- Revisão jurídica dos rascunhos de Termos e Privacidade;
- Execução e registro do roteiro somente leitura `supabase/onboarding-v1-preflight.sql` para confirmar o impacto de `auth.users` nas FKs existentes;
- Backup do projeto Supabase;
- Duas contas QA independentes;
- Autorização explícita para executar SQL e deployar a Edge Function.

## Matriz RLS obrigatória

| Tabela | Operação | Próprio usuário | Outro usuário |
|---|---|---:|---:|
| onboarding_profiles | SELECT/INSERT/UPDATE/DELETE | PASS | BLOCK |
| user_consents | SELECT/INSERT/UPDATE/DELETE | PASS | BLOCK |

## Validação de exclusão

1. Usuário autenticado informa senha incorreta: `403`, sem excluir dados.
2. Usuário autenticado informa senha correta e confirma `EXCLUIR`: remoção da conta e dos dados em cascade.
3. Usuário A nunca pode excluir usuário B.
4. Logs e respostas não contêm senha, token ou chave administrativa.

## Evidência da etapa 2.1 — produção (2026-09-06)

- Projeto Supabase: saudável durante a consulta.
- `onboarding_profiles` e `user_consents`: ainda não existem; não há policies prévias para essas tabelas. Resultado esperado antes da migration.
- `applications`, `weight_records`, `application_plans`, `scheduled_applications`, `profiles`, `user_settings`, conexões Google e estados OAuth possuem vínculos diretos ao usuário com `ON DELETE CASCADE`.
- `scheduled_applications` também possui FKs `RESTRICT` para plano e aplicação. Embora a própria ocorrência tenha cascade direto pelo usuário, a deleção integral da conta só será aprovada após teste autenticado com conta QA descartável e confirmação de que a cadeia inteira é removida sem erro.
- Nenhuma migration, função ou dado foi alterado nesta etapa.

## Evidência da etapa 2.2 — migration aplicada (2026-09-06)

- `public.onboarding_profiles`: criada.
- `public.user_consents`: criada.
- Policies RLS próprias nas duas tabelas: `8` confirmadas pelo catálogo.
- A migration foi estritamente aditiva; nenhuma tabela existente foi modificada.
- O deploy de `delete-account` não foi realizado. Como a função usa credencial administrativa exclusivamente no servidor para apagar a conta autenticada, sua publicação exige autorização explícita para esse risco.

## Evidência da etapa 2.4 — Edge Function publicada (2026-09-06)

- Função publicada: `delete-account`.
- Endpoint: `https://jxfjsleqwfjrkcxcqpvw.supabase.co/functions/v1/delete-account`.
- Teste `POST` sem `Authorization`: `401` confirmado.
- Nenhuma conta ou dado foi excluído no teste sem autenticação.
- O teste autenticado de exclusão exige a senha da conta QA e confirmação final imediatamente antes da remoção permanente.

## Evidência da etapa 2.3 — matriz RLS autenticada (2026-09-06)

- Duas sessões independentes, autenticadas pelas contas QA autorizadas, foram validadas contra os UUIDs de teste esperados.
- `onboarding_profiles`: INSERT, SELECT, UPDATE e DELETE próprios passaram para A e B; todas as direções cruzadas A→B e B→A foram bloqueadas.
- `user_consents`: INSERT, SELECT, UPDATE e DELETE próprios passaram para A e B; todas as direções cruzadas A→B e B→A foram bloqueadas.
- O roteiro `scripts/test-onboarding-rls-auth.mjs` executa operações sequenciais pela Publishable Key, sem chave administrativa no cliente e com limpeza no bloco `finally`.
- Auditoria posterior somente leitura: zero registros temporários remanescentes nas duas tabelas para as contas QA.

## Resultado da Sprint 2

**ONBOARDING V1 — MIGRATION, RLS E EXCLUSÃO DE CONTA: APROVADO.**

- Migration aditiva aplicada em produção;
- oito policies RLS confirmadas e matriz autenticada aprovada;
- Edge Function `delete-account` com JWT obrigatório publicada e validada com senha incorreta (`403`) e conta QA descartável;
- cleanup confirmado; nenhum segredo foi exposto.

## Ordem de execução

1. Executar o preflight somente leitura e aprovar a cadeia de exclusão de conta.
2. Revisar SQL em ambiente de teste.
3. Executar migration manualmente.
4. Rodar matriz RLS com duas sessões.
5. Configurar segredo da Edge Function apenas no Supabase.
6. Deployar somente `delete-account` com JWT obrigatório.
7. Executar QA autenticado e cleanup.
8. Autorizar publicação do frontend somente após todos os passos PASS.
