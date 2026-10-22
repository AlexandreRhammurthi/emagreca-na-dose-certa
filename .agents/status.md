# Andamento da tarefa

**Tarefa:** ADMIN-USER-GROWTH — Gráfico de crescimento cumulativo de usuários
**Branch:** `feature/admin-user-growth`
**Agente ativo:** DEV
**Etapa atual:** PRONTA PARA QA — tooltip do gráfico
**Gates concluídos:** escopo e fonte de dados revisados; branch isolada criada; implementação; tooltip interativo; contratos locais; suíte; build; integridade do diff
**Percentual estimado:** 75%
**Última atualização:** 2026-10-21

## Última ação

O painel recebe uma série diária agregada, acumulada desde o primeiro cadastro até o dia atual. O cliente desenha o gráfico sem receber e-mail, ID ou outro dado individual. O tooltip mostra data, novos cadastros do dia e total acumulado com mouse ou toque. `npm.cmd test` passou com 169 testes; `npm.cmd run build` passou com 28/28 arquivos; `git diff --check` passou. A checagem `deno check` não foi executada porque o binário Deno não está instalado neste ambiente.

## Próximo passo

QA deve validar o gráfico em desktop e mobile, inclusive sem cadastros e com dias sem novos cadastros. Deploy da Edge Function e do site dependerá de autorização explícita.

## Regras de leitura

- Este arquivo é o status operacional; não substitui o relatório DEV ou QA.
- Percentual mede gates concluídos e pode diminuir se surgir uma regressão.
- **QA: PASS** — commit e push da branch estão autorizados. Deploy permanece sujeito à autorização explícita do responsável do projeto.
