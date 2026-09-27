# Relatório DEV — PILOT-001

**Estado:** PRONTA PARA QA — COM BLOQUEIO DE SUÍTE BASELINE
**Branch:** `feature/pilot-simulador-estado-zero`
**HEAD sob teste:** `67857e7` (sem commit da tarefa)

## Implementação

- `app.js`: resultado passa a exigir medicamento selecionado e valores numéricos positivos; um estado inválido limpa leitura, equivalência, barra, cálculo detalhado, líquido, êmbolo e marcador para zero.
- `index.html`: estado estático inicial também é zero, evitando exibir `8,33 UI` antes do JavaScript executar.
- `tests/local/contracts/syringe-protection.test.mjs`: contrato para o estado seguro inicial e preservação da fórmula.

As fórmulas, arredondamentos de resultados válidos, capacidades e SVG semirrealista foram preservados. Valores válidos continuam usando a formatação prévia; apenas zero usa precisão fixa (`0,00 UI` e `0,000 mL`).

## Validações

| Comando | Resultado |
| --- | --- |
| `node --check app.js` | PASS |
| `node --test tests/local/contracts/syringe-protection.test.mjs` | PASS — 5/5 |
| `npm test` | BLOCKED — 146/147 PASS; falha preexistente em `cor008-signup-success.test.mjs`, sem alteração em `js/auth.js` ou nesse teste nesta tarefa |
| `npm run build` | PASS — BUILD: SUCCESS; 22/22 arquivos sincronizados; secret/service_role: NÃO |
| `git diff --check` | PASS |

## Riscos conhecidos

- A suíte completa não está verde por uma asserção preexistente do COR-008 sobre a ordem interna de `closeModal`; está fora do escopo da PILOT-001 e bloqueia uma aprovação QA final baseada em suíte completa.
- Validação visual em Chromium permanece pendente do agente QA.

## Instruções para QA

1. Abrir o simulador sem medicamento e com campos zerados: confirmar `0,00 UI`, `0,000 mL`, `0%`, seringa sem líquido e marcador/êmbolo no zero.
2. Conferir dados parciais e medicamento ausente.
3. Selecionar medicamento e preencher uma dose válida; confirmar resultado e geometria existentes.
4. Alternar capacidades 30, 50 e 100 UI antes e depois de preencher os valores.
5. Validar desktop, 390 px, console e rede.
