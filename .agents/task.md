# Tarefa ativa — piloto DEV/QA

**ID:** PILOT-001
**Título:** Estado inicial seguro do resultado da dose
**Branch prevista:** `feature/pilot-simulador-estado-zero`
**Status:** PRONTA PARA DEV

## Contexto

Na tela inicial, os campos de medicamento, apresentação do rótulo e dose prescrita podem estar vazios ou com valor zero, mas o painel “Carregue até” apresenta uma dose anterior (`8,33 UI`). Esse resultado não pode permanecer visível quando não existe uma prescrição válida.

## Escopo

Alterar somente o estado de exibição e atualização do simulador. Não alterar fórmulas de conversão, arredondamentos, limites de capacidade, autenticação, diário, dados persistidos ou o desenho da seringa.

## Critérios de aceite

Quando medicamento não estiver selecionado, ou qualquer campo essencial estiver vazio, inválido ou igual a zero:

- “Carregue até” mostra `0,00 UI`;
- equivalência mostra `0,000 mL`;
- percentual mostra `0% da seringa de X UI`;
- seringa fica sem líquido, com êmbolo e marcador na posição zero;
- não é exibido valor remanescente de interação anterior.

Quando medicamento, apresentação válida em mg/mL e dose prescrita maior que zero estiverem preenchidos:

- o resultado calculado atual permanece correto;
- alterações de dose, apresentação e capacidade continuam atualizando em tempo real;
- líquido, vedação e marcador permanecem sincronizados.

## Casos QA mínimos

1. Estado inicial sem medicamento e valores zero.
2. Medicamento ausente com dose/preenchimento parcial.
3. Medicamento válido com apresentação/dose zero.
4. Dose válida fracionária.
5. Troca de capacidade 30, 50 e 100 UI antes e depois de preencher uma prescrição válida.
6. Desktop e viewport móvel.
7. Ausência de erros de console.

## Validações obrigatórias

`npm test`
`npm run build`
`git diff --check`

QA deve realizar também validação visual renderizada em Chromium, quando o navegador estiver configurado.

## Fora do escopo

- Deploy;
- migrations/Supabase/RLS;
- alteração de dependências;
- commit/push antes de QA PASS.
