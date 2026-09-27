# Suíte de testes

## Suíte oficial local

`npm test` e `npm run test:local` executam somente os testes de `tests/local/`. O runner descobre arquivos `*.test.mjs` de forma cross-platform e carrega `tests/local/no-network.mjs`, que bloqueia `fetch` real durante a execução.

- `local/contracts/`: contratos entre HTML, JavaScript, migrations e funções.
- `local/google/`: lógica do Google Calendar exercitada com mocks e fixtures sintéticas.
- `local/unit/`: testes unitários, incluindo datas civis do DC-002.
- `fixtures/`: fixtures compartilhadas; somente dados sintéticos.

Comandos:

```text
npm ci
npm test
npm run test:civil-date
npm run build
```

Nenhum comando local exige `.env`, credenciais, rede ou Supabase.

## Integração remota de QA

Os comandos abaixo não fazem parte de `npm test` e escrevem em um Supabase real de QA:

```text
npm run test:integration:rls
npm run test:integration:onboarding
```

Antes de criar qualquer cliente ou chamada de rede, ambos exigem `TEST_TARGET=qa`, URL, project ref e publishable key exclusivos de teste, além de duas contas QA. A URL deve corresponder ao project ref informado e não pode ser o endpoint conhecido de produção. Use `tests/integration/env.example` como lista de variáveis, sem versionar valores reais. Os runners omitem dados pessoais e executam cleanup em `finally`.

## Visual e diagnósticos

`tests/visual/syringe-visual.mjs` é um runner manual preservado fora da suíte oficial. Ele depende de servidor local e de Playwright, que não é dependência deste projeto; screenshots em `tests/visual/artifacts/` não são baselines e permanecem ignorados.

`tests/maintenance/`, resultados remotos, diretórios `.temp` e artefatos visuais são deliberadamente ignorados. `scripts/test-confirm-scheduled-auth.mjs` continua sendo diagnóstico local e não pertence à suíte oficial.
