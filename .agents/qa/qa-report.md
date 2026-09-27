# Relatório QA — PILOT-001

**Estado:** PASS
**Branch testada:** `feature/pilot-simulador-estado-zero`
**HEAD sob teste:** `67857e7` (alterações da tarefa ainda não commitadas)
**Data:** 2026-09-26

## Cobertura renderizada em Chromium

| Cenário | Desktop 1366×900 | Mobile 390×844 | Resultado |
| --- | --- | --- | --- |
| Estado inicial sem medicamento e valores zero | Executado | Executado | PASS — `0,00 UI`, `0,000 mL`, `0%`, líquido vazio e marcador no zero |
| Medicamento ausente / preenchimento parcial | Executado via estado inicial e contrato | Executado via estado inicial | PASS — resultado permanece no estado zero |
| Prescrição válida (15 mg / 0,5 mL / 2,5 mg) | Executado | Executado | PASS — `8,33 UI`, `0,083 mL`, líquido e marcador sincronizados |
| Capacidades 30, 50 e 100 UI no zero | Executado | Não repetido | PASS — leitura e geometria permanecem no zero |
| Capacidades 30, 50 e 100 UI com prescrição válida | Executado | Não repetido | PASS — leitura calculada preservada e atualização acionada |
| Console/rede relevante ao produto | Executado | Executado | PASS — nenhum erro de produto; falhas externas de CDN/fontes foram bloqueadas pelo sandbox e não são regressão do app |

O cadastro obrigatório de visitantes é um fluxo fora deste piloto e bloqueia intencionalmente o clique em controles. Para validar a geometria após prescrição válida, o gate foi neutralizado apenas na página de teste; a aplicação não foi alterada.

## Evidência

- Runner final independente: `.agents/artifacts/pilot001-visual-final.mjs`.
- Resultado: `PILOT-001 FINAL VISUAL: PASS`.
- Screenshots renderizados e arquivados, sem dados pessoais:
  - `.agents/artifacts/screenshots/pilot001-desktop-zero.png`
  - `.agents/artifacts/screenshots/pilot001-desktop-valid.png`
  - `.agents/artifacts/screenshots/pilot001-mobile-zero.png`
  - `.agents/artifacts/screenshots/pilot001-mobile-valid.png`
- Revisão visual humana das evidências: PASS. A leitura zero aparece como `0,00 UI`, a equivalência como `0,000 mL`, a barra está vazia e o marcador/vedação ficam no limite zero. A prescrição válida mantém `8,33 UI` e a seringa sincronizada em desktop e móvel.

## Gates

| Comando / gate | Resultado |
| --- | --- |
| `node .agents/artifacts/pilot001-visual-final.mjs` | PASS — Chromium, desktop, 390×844, zero, prescrição válida e capacidades 30/50/100 |
| `node --test tests/local/contracts/syringe-protection.test.mjs` | PASS — 5/5 (evidência DEV, não reexecutada nesta rodada) |
| `npm.cmd test` | PASS — 147/147 |
| `npm.cmd run build` | PASS — `BUILD: SUCCESS`, 22/22 arquivos sincronizados; Secret Key/service_role: NÃO |
| `git diff --check` | PASS |

## Achados

### QA-001 — Baseline da suíte local não estava verde

**Severidade:** resolvida
**Ambiente:** Node 24, checkout local
**Passos:** executar `npm.cmd test`.
**Resultado anterior:** 146/147 passavam. Falhava em `tests/local/contracts/cor008-signup-success.test.mjs`, cenário `modal de cadastro pode ser fechado antes de uma solicitação ser enviada`.
**Correção validada:** o contrato foi atualizado para verificar o comportamento observável de `closeModal()` (detecção do cancelamento antes de limpar o gate e emissão do evento), sem alterar `js/auth.js`.
**Evidência final:** `npm.cmd test` retornou 147/147 PASS em 2026-09-27.
**Escopo:** a atualização permanece limitada ao teste COR-008; não houve mudança de produto, autenticação ou simulador nesta correção.

### QA-002 — Captura de screenshots

**Estado:** RESOLVIDO.
Após a liberação de escrita no workspace, a rodada final gravou as quatro evidências desktop/móvel acima. Não há bloqueio visual remanescente.

## Revisão do diff da PILOT-001

- `app.js` só altera o caminho de apresentação sem prescrição válida: limpa `currentSimulation`, emite detalhe nulo e chama `renderZeroResult(capacity)`.
- O estado zero mostra `0,00 UI`, `0,000 mL`, `0%`, líquido vazio, marcador e vedação no zero.
- O caminho de prescrição válida continua em `renderSyringeResult()` e preserva a fórmula existente.
- Não foram identificadas alterações em Supabase, migrations, autenticação, capacidades ou arquivos gerados no diff do produto.

## Gate final independente — 2026-09-27

| Verificação | Resultado |
| --- | --- |
| Escopo do diff | PASS — somente estado zero do simulador (`app.js`, `index.html`), contratos focais, contrato semântico COR-008 e Playwright/artefatos de agentes |
| `npm.cmd test` | PASS — 147/147 |
| `npm.cmd run build` | PASS — `BUILD: SUCCESS`, 22/22 arquivos sincronizados, nenhuma Secret Key ou `service_role` detectada |
| `git diff --check` | PASS |
| Chromium desktop e móvel | PASS — runner executado novamente na versão atual |
| Console/rede relevante | PASS — nenhuma falha de produto; bloqueios externos de CDN/fontes não são regressão |
| Evidência visual | PASS — screenshots regenerados em 2026-09-27, incluindo zero desktop e prescrição válida móvel |
| Integridade após evidência | PASS — `app.js` e `index.html` são anteriores às capturas finais; a alteração posterior limita-se ao contrato COR-008 |

O runner `.agents/artifacts/pilot001-visual-final.mjs` confirmou novamente estado zero, prescrição válida e capacidades 30/50/100 UI. A revisão visual das capturas finais confirma leitura `0,00 UI`, equivalência `0,000 mL`, barra vazia e geometria no zero; a prescrição válida preserva `8,33 UI` e sincronismo visual.

## Decisão

**QA: PASS**

QA autoriza o DEV a realizar commit, push da branch `feature/pilot-simulador-estado-zero` e deploy, desde que a etapa de deploy seja autorizada pelo responsável do projeto e os checks finais de Git sejam executados. Este QA não executou commit, push ou deploy.
