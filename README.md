# Dose Certa

Aplicação web educativa para converter uma dose prescrita em mg para volume e unidades de seringa U-100, além de organizar registros pessoais da jornada. Não oferece diagnóstico, prescrição, recomendação de conduta ou substitui médico, farmacêutico, bula ou nutricionista.

## Estado e evidência

O código nesta pasta é a fonte de verdade local. Arquivos SQL versionados descrevem migrations propostas/canônicas, mas **não comprovam** que tenham sido aplicados ao Supabase remoto. Do mesmo modo, um build local não comprova que o domínio público esteja na mesma versão.

O fechamento de QA de 09/09/2026 registrou uma fotografia de 97 testes locais aprovados e build de 22/22 arquivos; execute os comandos abaixo para obter o estado atual antes de qualquer publicação. Validações remotas pendentes estão documentadas em `AUDITORIA_QA_2026-09-09_CODEX.md`.

## Arquitetura

O front-end usa HTML, CSS e JavaScript nativos. A raiz é o código-fonte; `public/` é uma saída descartável, gerada por allowlist, e nunca deve ser editada manualmente.

```text
/
├── index.html, styles.css, app.js        # interface, visual e simulador U-100
├── js/
│   ├── auth.js, supabase-config.js       # sessão e cliente público Supabase
│   ├── diary.js, weight.js               # aplicações e peso
│   ├── measurements.js, effects.js       # medidas e anotações pessoais
│   ├── plan.js, google-calendar.js       # planejamento e conexão Google
│   ├── vials.js, report.js               # frascos e relatório imprimível
│   ├── onboarding.js, analytics.js       # perfil e métricas operacionais
│   └── date-utils.js                     # datas civis, sem deslocamento UTC
├── supabase/                             # Edge Functions e migrations versionadas
├── tests/local/                          # testes sem rede
├── tests/integration/                    # testes remotos opt-in de QA
├── scripts/                              # build, checks e execução de testes
└── public/                               # artefato gerado, não versionado
```

O simulador concentra fórmula, arredondamentos, validações e seringa. Os módulos de dados usam o único cliente autenticado, RLS e ownership por `user_id`. O relatório consulta somente aplicações, peso, medidas e efeitos do titular e abre sob ação explícita dele.

### Funcionalidades e integrações

- **Simulador:** apresentação, dose, volume, UI e seringa U-100 de 30, 50 ou 100 UI.
- **Autenticação e onboarding:** conta, perfil de jornada, consentimentos, dados iniciais e exclusão permanente mediante confirmação.
- **Diário e Meu Peso:** aplicações realizadas, peso, gráfico e edição dos próprios registros.
- **Medidas e efeitos:** medidas corporais e anotações livres pessoais, sem interpretação clínica.
- **Meu Plano:** recorrência, lembretes, rodízio organizacional de locais e ocorrências futuras.
- **Frascos:** cadastro, volume/saldo e vínculo opcional com a aplicação por operação atômica.
- **Relatório:** visualização imprimível das quatro coleções pessoais.
- **Google Calendar/OAuth:** conexão e sincronização restritas às Edge Functions `google-oauth-start`, `google-oauth-callback` e `google-calendar-sync`.
- **Analytics:** eventos mínimos de produto via `record-product-event`, sem payload clínico.
- **Edge Functions adicionais:** `delete-account` trata exclusivamente a exclusão autenticada de conta e dados.

## Segurança e limites

- O cliente pode conter apenas URL do projeto e chave **publishable** do Supabase.
- Nunca registre ou versione `service_role`, Secret Key, senha do banco, JWT secret, token de deploy, senha, access token ou refresh token.
- RLS, sessão autenticada e as RPCs/Edge Functions são a fronteira de autorização; o navegador não deve contorná-las.
- Registros de saúde são pessoais. Não use dados para publicidade, prescrição, decisão automatizada ou aconselhamento clínico.
- Operações destrutivas, migrations, exclusão de conta e deploy exigem validação e autorização adequadas.

## Configuração local

Use Node.js 20 ou superior e npm. A configuração pública do Supabase fica em `js/supabase-config.js`. Para testes de integração, copie `tests/integration/env.example` para um arquivo local ignorado e preencha apenas credenciais exclusivas de QA:

```text
TEST_SUPABASE_URL
TEST_SUPABASE_PROJECT_REF
TEST_SUPABASE_PUBLISHABLE_KEY
TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD
TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD
```

Nunca envie esses valores em commits, logs ou chat.

## Comandos

```powershell
npm ci
npm test
npm run test:civil-date
npm run build
python -m http.server 8000 --directory public
```

Outros comandos do `package.json`:

```powershell
npm run test:local
npm run test:integration:rls
npm run test:integration:onboarding
npm run deploy
```

Os dois comandos de integração acessam ambiente remoto e só devem ser usados com variáveis QA autorizadas. `npm run deploy` cria o build e publica pelo Wrangler; não o execute sem autorização de publicação.

## Build e publicação

`npm run build` recria `public/`, verifica padrões de credenciais privilegiadas e compara os arquivos gerados com a origem. O build deve terminar com `BUILD: SUCCESS`.

O Worker recebe somente os assets de `public/` conforme `wrangler.jsonc`. Antes de uma publicação, execute no mínimo:

```powershell
npm ci
npm test
npm run test:civil-date
npm run build
git diff --check
npx wrangler deploy --dry-run
```

## Dados, migrations e ambiente remoto

As migrations em `supabase/migrations/` são parte do histórico do projeto. Uma migration no repositório pode ser uma proposta ou a versão canônica a aplicar; confirme o schema, RLS, funções e grants no ambiente alvo antes de inferir que ela já está ativa.

Em 09/09/2026 ainda requerem verificação remota identificada: schema e RLS do Supabase, publicação Cloudflare, OAuth Google ponta a ponta, exclusão destrutiva de conta, telemetria e a integração entre duas sessões QA. O teste manual de abertura/impressão do relatório no Chrome também deve ser executado em navegador antes do release.
