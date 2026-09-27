# Guia completo para Agente de QA

> Baseline preparada em 08/09/2026 a partir do checkout local e da memória oficial do projeto.
>
> Este documento orienta QA funcional, regressivo, de integração, segurança e compatibilidade. Ele não confirma publicação, migrations aplicadas ou configuração de produção. Tudo que depender de Supabase, Cloudflare ou Google deve ser validado no ambiente explicitamente autorizado.

## Estado de QA em 09/09/2026

O registro `AUDITORIA_QA_2026-09-09_CODEX.md` é a fotografia mais recente do checkout: 97 testes locais aprovados, 0 falhas e build de 22/22 arquivos, executados com `npm test` e `npm run build`. Essas contagens são históricas até que a pessoa responsável execute os mesmos comandos novamente.

Permanecem pendentes de evidência remota identificada: schema/RLS do Supabase, publicação Cloudflare, OAuth Google ponta a ponta, exclusão destrutiva de conta, telemetria e a integração entre duas sessões QA. O pop-up e a impressão do relatório também exigem conferência manual no Chrome antes do release.

Migrations versionadas são propostas ou a fonte canônica de DDL; sua existência não confirma aplicação no ambiente remoto.

### Taxonomia de resultado

| Rótulo | Uso correto |
|---|---|
| PASS LOCAL | Verificação concluída no checkout, sem afirmar execução de teste automatizado. |
| PASS AUTOMATIZADO | Teste reproduzível aprovado, com comando e data registrados. |
| PASS REMOTO | Evidência identificada no ambiente autorizado; não pode ser inferida pelo código. |
| PASS RELEASE | Build, publicação comparada e gates de release aplicáveis aprovados. |
| PENDENTE MANUAL | Exige observação humana, como pop-up/impressão em Chrome. |
| PENDENTE REMOTO | Exige Supabase, Cloudflare, Google ou outra dependência externa autorizada. |

`CONFIRMADO NO CÓDIGO` pode complementar um registro, mas nunca equivale a `PASS REMOTO`.

## 1. Objetivo deste guia

O agente de QA deve usar este documento para:

- entender o produto, seu limite educativo e seus fluxos;
- conhecer dependências e correlações entre funcionalidades;
- localizar a fonte técnica de cada comportamento;
- separar implementação local, intenção de migration, evidência histórica e estado remoto;
- executar regressão sem transformar especificações antigas em fatos atuais;
- preservar privacidade, RLS, ownership, datas civis e atomicidade;
- registrar defeitos com evidência reproduzível;
- evitar deploy, migration, exclusão ou escrita remota sem autorização específica.

Fontes principais: `Project Governance.md`, `Emagreça na Dose Certa - AI Context.md`, `Architecture.md`, `Current State.md`, `Backlog.md`, código do checkout e migrations versionadas.

## 2. Modelo obrigatório de evidência

Toda conclusão de QA deve receber uma das classificações abaixo:

| Classificação | Significado |
|---|---|
| Confirmado pelo código | O comportamento ou contrato existe no checkout atual. |
| Confirmado por migration | Existe DDL versionado; não prova aplicação no banco remoto. |
| Confirmado por teste local | Um teste reproduzível passou sem rede ou credenciais. |
| Indicado por log | Um registro histórico declara que a ação ocorreu, sem inspeção remota atual. |
| Inferido, mas não confirmado | A conclusão é provável, porém ainda não foi observada em execução. |
| Dependente de validação remota | Exige Supabase, Google ou Cloudflare autorizado e identificado. |

Hierarquia: realidade atual do código/ambiente validado → memória oficial → logs, análises e propostas. Em caso de divergência, não escolher silenciosamente uma versão.

Evidência: `Project Governance.md`, seções “Níveis de autoridade” e “Durante a implementação”.

## 3. Propósito, limites e linguagem do produto

Dose Certa é uma aplicação web educativa para:

- converter dose em mg em volume;
- converter volume em unidades de seringa U-100;
- representar visualmente a quantidade em seringas de 30, 50 e 100 UI;
- organizar registros pessoais de aplicações, peso, medidas, efeitos, frascos e planejamento;
- permitir integração organizacional com Google Agenda;
- produzir relatório pessoal imprimível.

O produto não deve:

- prescrever dose;
- recomendar medicamento, alteração de dose, local de aplicação ou conduta;
- diagnosticar, interpretar sintomas, exames ou evolução;
- prometer resultado de saúde;
- substituir médico, farmacêutico ou outro profissional;
- usar dados de saúde para publicidade, precificação ou decisão automatizada.

Qualquer texto novo ou comportamento que pareça recomendação clínica deve ser reportado como regressão de produto/segurança.

Evidências: `README.md`; `index.html`, bloco de segurança; `app.js`, função `calculateDose`; `PREMIUM_DISCOVERY_V1.md`; `DADOS_METRICAS_V1_ANALISE.md`.

## 4. Estado do checkout que o QA receberá

### Confirmado no checkout

- front-end sem framework em HTML, CSS e JavaScript;
- Supabase Auth, Data API, RLS, RPC e Edge Functions;
- simulador, autenticação, onboarding, Diário, peso, medidas, efeitos, relatório, Plano, frascos e métricas;
- OAuth Google e motor server-side de sincronização;
- build por allowlist para `public/`;
- suíte local reorganizada em `tests/local/`;
- testes remotos separados em `tests/integration/`;
- Node mínimo declarado como `>=20`.

### Ainda não confirmado remotamente

- conteúdo realmente publicado no domínio;
- versão efetiva do Worker;
- migrations e policies presentes no Supabase remoto;
- secrets e redirects das Edge Functions;
- funcionamento ponta a ponta do Google Agenda;
- exclusão integral da conta e dos dados em QA;
- telemetria de ativação;
- pipeline externo de deploy.

### Estado de governança relevante

O DC-002 está documentado como concluído. A implementação do DC-008 existe e foi validada no checkout, mas a memória oficial ainda o apresenta como proposto. O agente deve reportar essa divergência e não declarar o item oficialmente concluído até atualização autorizada do Backlog.

Evidências: `Backlog.md`; `Changelog.md`; `package.json`; `tests/README.md`; `.gitignore`; `tests/local/`; `tests/integration/`.

## 5. Arquitetura operacional

### 5.1 Front-end

| Arquivo | Responsabilidade | Correlações críticas |
|---|---|---|
| `index.html` | Estrutura da SPA, formulários, seções, modais e ordem de scripts. | Todos os módulos; ordem de carregamento. |
| `styles.css` | Layout, responsividade, estados e sistema visual. | Desktop/mobile, modais e seringa. |
| `app.js` | Catálogo, fórmula, resultado e seringa SVG. | Diário recebe a simulação; onboarding protege o salvamento. |
| `js/date-utils.js` | Datas civis locais. | Efeitos, onboarding, Diário, medidas, Plano e peso. |
| `js/supabase-config.js` | Cliente público Supabase. | Todos os recursos autenticados. |
| `js/auth.js` | Cadastro, login, sessão, logout e recuperação. | Onboarding, navegação e todos os dados privados. |
| `js/onboarding.js` | Perfil, consentimentos, peso inicial e exclusão. | Auth, peso, Google e analytics. |
| `js/diary.js` | Aplicações, confirmação de agenda, peso e frasco opcionais. | Simulador, Plano, Peso, Frascos. |
| `js/weight.js` | Histórico, gráfico e CRUD de peso. | Diário e onboarding. |
| `js/measurements.js` | CRUD de medidas corporais. | Relatório e sessão. |
| `js/effects.js` | CRUD de anotações pessoais. | Relatório e sessão. |
| `js/report.js` | Consulta e relatório imprimível. | Aplicações, peso, medidas e efeitos. |
| `js/plan.js` | Planos, ocorrências, lembretes, calendário e rodízio. | Diário, Google e registros de local. |
| `js/vials.js` | Cadastro, saldo e seleção de frascos. | Diário e RPCs atômicas. |
| `js/google-calendar.js` | Estado da conexão e OAuth start. | Plano e Edge Functions Google. |
| `js/analytics.js` | Eventos operacionais mínimos. | Auth, onboarding e eventos DOM. |

Globais relevantes: `DoseMedicines`, `DoseCalculator`, `DoseDate`, `MedicationVials`, `Diary`, `PlanModule`, `DoseAnalytics` e `showToast`.

Eventos relevantes: `dosecerta:simulation`, `dosecerta:auth-session`, `dosecerta:account-created`, `dosecerta:application-confirmed` e `dosecerta:applications-changed`.

Evidências: `index.html`, ordem de scripts; `app.js`; `js/*.js`.

### 5.2 Back-end e integrações

| Componente | Responsabilidade | Estado de confirmação |
|---|---|---|
| Supabase Auth | Identidade, sessão e recuperação de senha. | Código local; configuração remota pendente. |
| PostgreSQL/Data API | Dados pessoais. | Chamadas locais; schema remoto pendente. |
| RLS | Isolamento por `user_id = auth.uid()`. | Migrations presentes; estado remoto pendente. |
| RPCs PostgreSQL | Aplicação + retirada de frasco; confirmação de ocorrência. | Migrations presentes; execução remota pendente. |
| `google-oauth-start` | State, PKCE e URL de autorização. | Código e testes locais. |
| `google-oauth-callback` | Troca de code, validação e credencial privada. | Código e testes locais. |
| `google-calendar-sync` | Criação, alteração e cancelamento de evento. | Motor e testes locais; chamador ponta a ponta pendente. |
| `record-product-event` | Telemetria mínima autenticada. | Código/migration; operação remota pendente. |
| `delete-account` | Revalidação e exclusão permanente. | Código; validação remota destrutiva pendente. |
| Cloudflare Static Assets | Hospedagem do conteúdo de `public/`. | Configuração local; publicação atual pendente. |

## 6. Regras transversais que não podem regredir

1. Fórmula canônica:
   - concentração = mg do frasco / mL do frasco;
   - volume = dose em mg / concentração;
   - UI = volume × 100;
   - ocupação = UI / capacidade × 100.
2. Capacidades: 30, 50 e 100 UI.
3. Datas civis usam `DoseDate.toCivilDate()` e `DoseDate.todayCivil()`; não usar recorte de `toISOString()`.
4. Timestamps reais continuam ISO/UTC.
5. `applications` representa aplicações realizadas; `scheduled_applications` representa planejamento.
6. Aplicação e retirada de frasco devem permanecer atômicas.
7. Peso opcional ainda é uma correlação separada e possui risco de consistência registrado em DC-003.
8. RLS e ownership são obrigatórios para todos os dados pessoais.
9. Não confiar em `user_id` vindo do formulário.
10. Modais devem fechar por X, Cancelar, backdrop e Escape, inclusive após falhas.
11. Controles necessários devem ser capturados antes de `await`; estados assíncronos devem ser liberados em `finally`.
12. Conteúdo do usuário deve usar `textContent` ou escaping antes de HTML.
13. Não editar `public/` manualmente.
14. Não expor service role, JWT, senha, refresh token, credencial Google ou dados pessoais em logs.
15. Não alterar o design aprovado da seringa como efeito colateral.

Evidências: `app.js`; `js/date-utils.js`; `js/diary.js`; migrations de frasco; testes em `tests/local/contracts/`.

## 7. Preparação do ambiente de QA

### 7.1 Pré-requisitos locais

- Node.js 20 ou superior.
- npm e o lockfile do projeto.
- Navegador moderno com viewport desktop e mobile.
- Servidor HTTP local; não abrir o HTML somente por `file://`.
- Para fluxos autenticados, ambiente Supabase QA identificado e autorizado.

### 7.2 Comandos locais oficiais

```powershell
npm ci
npm test
npm run test:civil-date
npm run build
python -m http.server 8000 --directory public
```

Resultado histórico da implementação DC-008 no checkout: `npm test` executou 95 testes; o teste civil executou 8; o build sincronizou 22 arquivos. O agente deve registrar o resultado da sua própria execução, sem reutilizar contagens históricas como evidência atual.

### 7.3 Testes remotos

Comandos existentes:

```powershell
npm run test:integration:rls
npm run test:integration:onboarding
```

Eles não pertencem a `npm test`. Exigem:

- `TEST_TARGET=qa`;
- `TEST_SUPABASE_URL`;
- `TEST_SUPABASE_PROJECT_REF`;
- `TEST_SUPABASE_PUBLISHABLE_KEY`;
- duas contas QA em `TEST_USER_A_*` e `TEST_USER_B_*`.

As travas devem recusar alvo não identificado, URL divergente do project ref e endpoint conhecido de produção antes de rede. Nunca executar essas suítes sem autorização para escrita e cleanup no QA.

Evidências: `tests/README.md`; `tests/integration/env.example`; `tests/integration/supabase/qa-environment.mjs`.

### 7.4 Teste visual

`tests/visual/syringe-visual.mjs` é manual, não integra `npm test`, depende de Playwright não declarado e gera screenshots ignorados. Não tratar imagens existentes como golden baselines.

## 8. Roteiro funcional completo

### 8.1 Inicialização e navegação pública

**QA-GEN-001 — carregamento inicial**

- Abrir a aplicação por HTTP.
- Confirmar ausência de erro JavaScript.
- Confirmar cabeçalho, simulador, aviso educativo e rodapé.
- Confirmar que Diário, Peso, Plano e Perfil não ficam expostos sem sessão.
- Confirmar botões “Entrar” e “Criar conta”.

**QA-GEN-002 — responsividade**

- Validar larguras aproximadas de 360, 390, 768, 1024 e 1440 px.
- Confirmar ausência de scroll horizontal indevido.
- Confirmar campos, seringa, botões e modais legíveis.
- Validar orientação retrato e paisagem em mobile.

**QA-GEN-003 — teclado e acessibilidade básica**

- Percorrer controles com Tab.
- Confirmar foco visível e ordem lógica.
- Confirmar nomes acessíveis de botões iconográficos.
- Confirmar `aria-live` para toast, status e erros.
- Confirmar que Escape fecha o modal ativo e devolve interação à página.

Evidências: `index.html`; `styles.css`; `tests/local/contracts/modal-resilience-v1.test.mjs`.

### 8.2 Simulador U-100

**Entradas**

- medicamento;
- mg totais do frasco;
- mL totais do frasco;
- dose em mg;
- capacidade de 30, 50 ou 100 UI.

**Saídas**

- concentração;
- volume calculado;
- unidades U-100;
- percentual da capacidade;
- posição do líquido, êmbolo e marcador na seringa.

**Casos obrigatórios**

| ID | Caso | Resultado esperado |
|---|---|---|
| QA-SIM-001 | 15 mg / 0,5 mL; dose 2,5 mg | 30 mg/mL, aproximadamente 0,083 mL e 8,33 UI. |
| QA-SIM-002 | Alternar 30/50/100 UI | UI não muda; somente escala e percentual mudam. |
| QA-SIM-003 | Campo vazio | Erro; nenhuma simulação válida deve ser propagada. |
| QA-SIM-004 | Zero, negativo ou não numérico | Rejeição segura. |
| QA-SIM-005 | Dose que excede a seringa | Aviso de capacidade sem recomendar nova dose. |
| QA-SIM-006 | Casas decimais e vírgula visual | Formatação pt-BR coerente. |
| QA-SIM-007 | Troca de medicamento | Cálculo depende dos números, não do nome. |
| QA-SIM-008 | Redimensionamento | Escala, líquido e marcador permanecem alinhados. |
| QA-SIM-009 | Usuário sem sessão tenta salvar | Abre gate de cadastro/onboarding. |
| QA-SIM-010 | Usuário autenticado tenta salvar | Abre fluxo do Diário com valores atuais. |

Não aceitar mudança na fórmula ou nos IDs/camadas SVG sem revisão específica.

Evidências: `app.js`; `index.html`, seção “Calculadora de dose”; `tests/local/contracts/syringe-protection.test.mjs`.

### 8.3 Cadastro, login, sessão e logout

**QA-AUTH-001 — cadastro válido**

- Informar nome, e-mail válido e senha aceita pelo Supabase.
- Confirmar maioridade e aceite legal.
- Confirmar resposta adequada para sessão imediata ou confirmação de e-mail, conforme configuração QA.
- Confirmar evento de conta criada sem dados clínicos.

**QA-AUTH-002 — validações**

- Nome ausente.
- E-mail inválido.
- Senha curta/fraca.
- Maioridade não confirmada.
- Termos não aceitos.
- E-mail já cadastrado.
- Falha de rede.
- Confirmar mensagens compreensíveis e sem detalhes internos.

**QA-AUTH-003 — login**

- Credenciais válidas.
- Senha errada.
- Usuário inexistente.
- E-mail não confirmado, se aplicável.
- Repetição rápida do submit.
- Confirmar mensagem neutra quando necessário.

**QA-AUTH-004 — restauração de sessão**

- Recarregar página com sessão válida.
- Confirmar saudação e seções privadas.
- Expirar/revogar sessão no QA e confirmar retorno seguro ao estado público.

**QA-AUTH-005 — logout**

- Confirmar limpeza visual dos dados privados.
- Confirmar que back/forward não reexibe dados de outro usuário.
- Entrar com segunda conta e verificar segregação.

Evidências: `js/auth.js`; `js/supabase-config.js`; `AUTH_V1.1_LOG.md`.

### 8.4 Recuperação de senha

| ID | Etapa | Verificação |
|---|---|---|
| QA-PWD-001 | Solicitar recuperação com e-mail cadastrado | Resposta neutra e redirect autorizado. |
| QA-PWD-002 | Solicitar com e-mail não cadastrado | Não revelar existência da conta. |
| QA-PWD-003 | Abrir link válido | Evento `PASSWORD_RECOVERY` e formulário de nova senha. |
| QA-PWD-004 | Senhas divergentes/fracas | Bloqueio local/remoto e mensagem segura. |
| QA-PWD-005 | Atualização válida | `updateUser`, confirmação e limpeza dos parâmetros da URL. |
| QA-PWD-006 | Link expirado/reutilizado | Erro recuperável, sem sessão indevida. |
| QA-PWD-007 | Redirect desconhecido | Deve ser recusado pela configuração remota. |

Evidências: `js/auth.js`, chamadas `resetPasswordForEmail` e `updateUser`; `README.md`, “Recuperação completa de senha”.

### 8.5 Onboarding e perfil

O onboarding possui três etapas e coleta:

- data de nascimento;
- gênero e opção livre;
- país, estado e cidade;
- peso inicial;
- altura;
- objetivo da jornada;
- medicamento;
- intervalo em dias;
- horário;
- opt-in do Google Agenda;
- consentimento de dados de saúde.

**Casos obrigatórios**

1. Usuário menor de 18 anos no dia civil local: bloquear conclusão.
2. Aniversário de 18 anos hoje: aceitar conforme data local, sem UTC.
3. Datas inválidas/futuras: rejeitar.
4. Gênero “outro”: validar campo complementar.
5. Medicamento “outro”: validar campo complementar.
6. Intervalo: limites de 1 a 30 dias.
7. Peso e altura inválidos: bloquear.
8. Avançar/voltar entre etapas preservando estado.
9. Fechar/reabrir conforme as regras do fluxo obrigatório.
10. Conclusão válida: perfil, peso inicial e consentimentos.
11. Falha após salvar perfil, mas antes de peso/consentimentos: registrar possível estado parcial ligado ao DC-001.
12. Editar perfil depois do onboarding.
13. Opt-in Google sem conexão: deve orientar conexão, não fingir sincronização.
14. Entrar novamente com onboarding completo: não repetir indevidamente.
15. Conta B não lê nem altera perfil/consentimentos da A.

A conclusão atual é coordenada pelo cliente em operações distintas; atomicidade é backlog crítico DC-001.

Evidências: `index.html`, modal de onboarding; `js/onboarding.js`; `supabase/migrations/20260906_onboarding_v1.sql`; `ONBOARDING_V1_SPRINT_2_RLS.md`; `tests/local/contracts/onboarding-v1.test.mjs`.

### 8.6 Meu Diário

**Dados da aplicação**

- medicamento;
- data civil;
- apresentação em mg/mL;
- dose;
- volume e UI calculados;
- seringa;
- observação de até 500 caracteres;
- peso opcional;
- frasco opcional;
- origem planejada opcional.

**Casos de criação**

1. Salvar a simulação atual.
2. Abrir “Registrar nova Aplicação”.
3. Registro retroativo.
4. Data futura: oferecer encaminhamento ao Meu Plano, sem gravar como realizada silenciosamente.
5. Peso opcional vazio e preenchido.
6. Frasco opcional vazio e selecionado.
7. Saldo insuficiente: bloquear e oferecer cadastro de novo frasco.
8. Duplo clique/latência: não duplicar aplicação.
9. Sessão expirada: falhar sem gravar em usuário errado.
10. Valores calculados devem coincidir com o simulador.

**Consulta e dashboard**

- última aplicação;
- contagem dos últimos 30 dias;
- medicamento mais registrado;
- resumo da aplicação mais recente;
- atividade recente;
- histórico de até 50 registros;
- estado vazio e erro de carregamento.

**Edição e exclusão**

- editar campos permitidos;
- recalcular volume/UI;
- alterar/remover frasco respeitando RPC;
- comportamento do peso associado;
- excluir com confirmação;
- fechar confirmação por Cancelar, backdrop e Escape;
- atualizar dashboard, histórico, peso, Plano e frascos após sucesso.

**Correlação com Plano**

Confirmar ocorrência deve:

- preservar data planejada;
- registrar data real;
- criar a aplicação por RPC;
- marcar a ocorrência como concluída;
- impedir confirmação repetida;
- preservar ownership.

Evidências: `js/diary.js`; `index.html`, modais de aplicação; `supabase/migrations/20260907000200_application_vial_atomic_v1.sql`; `MEU_PLANO_V1_CONFIRM_ANALISE.md`; `DIARIO_V1_LOG.md`.

### 8.7 Meu Peso

**Casos**

1. Estado sem registros.
2. Criar peso manual com data civil.
3. Aceitar entrada pt-BR prevista pela interface.
4. Rejeitar vazio, zero, negativo e formato inválido.
5. Observação até 500 caracteres.
6. Editar peso manual.
7. Excluir com confirmação e rotas de fechamento.
8. Identificar origem manual versus aplicação.
9. Peso criado pelo Diário aparece na lista/gráfico.
10. Peso inicial do onboarding aparece corretamente.
11. Alteração/exclusão de aplicação não deve gerar peso órfão ou associação incorreta.
12. Registro legado por mesma data só deve usar o fallback explícito quando `application_id` é nulo.
13. Gráfico com 0, 1, 2 e muitos pontos.
14. Ordenação cronológica e datas iguais.
15. Segregação entre usuários.

Risco conhecido: aplicação e peso opcional não são transacionais no fluxo comum; DC-003 cobre consistência.

Evidências: `js/weight.js`; `PESO_V1_ANALISE.md`; `PESO_V1_MIGRATION_PROPOSTA.md`; `tests/local/contracts/regression-ux-vials.test.mjs`.

### 8.8 Medidas corporais

Campos opcionais, com pelo menos uma medida:

- abdômen;
- cintura;
- braço esquerdo/direito;
- coxa esquerda/direita;
- panturrilha esquerda/direita;
- data civil;
- observação.

**Casos**

- criar cada campo isoladamente;
- criar combinação de todos;
- rejeitar formulário sem nenhuma medida;
- rejeitar zero, negativo e valor acima do limite do schema;
- validar duas casas decimais;
- editar removendo/adicionando medidas;
- excluir;
- ordenar por data e criação;
- testar texto de observação no limite;
- validar RLS entre A e B;
- confirmar atualização do relatório.

Evidências: `js/measurements.js`; `supabase/migrations/20260907000500_body_measurements_v1.sql`; `MEDIDAS_CORPORAIS_V1_ANALISE.md`; `tests/local/contracts/body-measurements-v1.test.mjs`.

### 8.9 Efeitos relatados

**Casos**

- criar anotação de 1 a 1.000 caracteres;
- rejeitar vazio e excesso;
- data civil correta;
- listar em ordem;
- editar;
- excluir após confirmação;
- escapar HTML/script inserido pelo usuário;
- erro e latência;
- clique repetido durante gravação;
- RLS entre usuários;
- inclusão no relatório.

Risco inferido: o módulo não possui flags dedicadas para impedir submissões concorrentes; DC-012.

Evidências: `js/effects.js`; `supabase/migrations/20260907000400_application_effect_notes_v1.sql`; `tests/local/contracts/effects-v1.test.mjs`.

### 8.10 Relatório pessoal imprimível

A implementação atual consulta aplicações, pesos, medidas e efeitos, cria uma janela e aciona impressão. Não gera arquivo PDF diretamente.

**Casos**

1. Sem dados.
2. Apenas aplicações.
3. Apenas pesos.
4. Apenas medidas.
5. Apenas efeitos.
6. Todas as seções.
7. Acentos, quebras de linha e textos longos.
8. Conteúdo semelhante a HTML/script deve aparecer escapado.
9. Ordem e valores devem coincidir com as telas.
10. Nenhum token, ID interno ou dado de autenticação.
11. Nenhuma requisição externa contendo o relatório.
12. Janela bloqueada pelo navegador.
13. Impressão/salvar como PDF em navegadores suportados.
14. Legibilidade, paginação e contraste.

Divergência de escopo: a PRD prevê seleção de período e seções; o código atual não confirma toda essa seleção. DC-005 trata a conclusão do Relatório PDF V1.

Evidências: `js/report.js`; `RELATORIO_PDF_V1_ANALISE.md`; `RELATORIO_PDF_V1_MIGRATION_PROPOSTA.md`; `tests/local/contracts/report-pdf-v1.test.mjs`.

### 8.11 Meu Plano

**Modal de agendamento**

- medicamento;
- dose/apresentação;
- data e horário civis;
- timezone;
- recorrência única, semanal ou intervalo personalizado;
- lembretes;
- locais habilitados.

**Casos**

1. Aplicação única gera uma ocorrência.
2. Plano semanal gera 12 ocorrências.
3. Intervalo personalizado válido gera 12 ocorrências.
4. Intervalos inválidos são rejeitados.
5. Viradas de mês, ano e ano bissexto.
6. Timezone IANA preservada.
7. Lembretes 1440, 120, 15 e 0.
8. Sem lembrete.
9. Máximo e valores permitidos pelo schema.
10. Próxima aplicação e lista futuras.
11. Calendário: mês anterior/seguinte, dias vazios e múltiplas ocorrências.
12. Editar uma ocorrência sem alterar indevidamente as demais.
13. Cancelar ocorrência com confirmação.
14. Confirmar no Diário.
15. Mudança concorrente de status.
16. Falha após criar plano e antes de criar ocorrências: compensação.
17. Falha ao gravar local: comportamento parcial deve ser visível.
18. Conta B não acessa plano/ocorrência de A.

Risco conhecido: plano, ocorrências e registros de local são operações separadas e coordenadas no cliente; DC-011.

Evidências: `js/plan.js`; `MEU_PLANO_V1_ANALISE.md`; `MEU_PLANO_V1_MIGRATION.sql`; `MEU_PLANO_V1_MIGRATION_LOG.md`; `tests/local/contracts/reminders-rotation-v1.test.mjs`.

### 8.12 Lembretes e rodízio de local

**Lembretes**

- 1440 minutos: um dia antes;
- 120 minutos: duas horas antes;
- 15 minutos: preparação;
- 0: no horário.

A aplicação não possui Web Push ou Service Worker. Entrega depende do Google Agenda quando sincronizado.

**Rodízio**

Locais fechados:

- abdômen esquerdo/direito;
- coxa esquerda/direita;
- braço esquerdo/direito;
- outro com texto;
- opção de não informar no fluxo apropriado.

A sugestão deve usar apenas histórico do próprio usuário e ser apresentada como organização, nunca recomendação. Não criar registro automaticamente.

**Casos**

- primeiro uso sem histórico;
- local menos recentemente usado;
- empate com ordem estável;
- “outro” exige texto;
- texto “outro” no limite;
- local não enviado ao Google, analytics ou tela bloqueada;
- vínculo exclusivo com aplicação ou ocorrência;
- cascade previsto;
- cross-user bloqueado.

Evidências: `LEMBRETES_RODIZIO_V1_ANALISE.md`; `supabase/migrations/20260907000300_application_site_records_v1.sql`; `js/plan.js`.

### 8.13 Inventário de frascos

**Implementado**

- cadastro;
- medicamento, mg/mL iniciais, data de abertura e observação;
- consulta de frascos ativos;
- saldo derivado de retiradas;
- vínculo opcional;
- consumo atômico e bloqueio de saldo.

**Parcial**

- área completa de inventário;
- edição;
- finalizar/arquivar;
- histórico detalhado;
- projeção de aplicações restantes.

**Casos**

1. Cadastrar frasco válido.
2. Rejeitar mg/mL não positivos.
3. Saldo inicial igual ao informado.
4. Aplicação vinculada reduz mg e mL proporcionalmente.
5. Aplicação sem vínculo não altera frasco.
6. Saldo insuficiente bloqueia a transação inteira.
7. Duas retiradas concorrentes não podem produzir saldo negativo.
8. Uma aplicação não pode consumir dois frascos.
9. Alterar vínculo recalcula corretamente.
10. Excluir aplicação trata `vial_usage` conforme FK.
11. Não inferir vínculo por medicamento/data.
12. Conta A não usa frasco da B.
13. Estados `active`, `finished` e `archived` existem no schema, mas a UI completa é pendente.

Evidências: `js/vials.js`; `supabase/migrations/20260907000100_vial_inventory_v1.sql`; `20260907000200_application_vial_atomic_v1.sql`; `DURACAO_FRASCO_V1_ANALISE.md`; DC-006.

### 8.14 Google Agenda

#### Conexão OAuth

Casos:

- usuário sem sessão;
- iniciar conexão autenticada;
- URL de autorização com state e PKCE;
- state ausente, inválido, expirado ou reutilizado;
- callback com code válido;
- callback com erro/negação do Google;
- identidade Google incompatível;
- persistência pública sem tokens;
- refresh token somente no schema privado e cifrado;
- retorno para origem permitida;
- reconectar e trocar conta;
- estado conectado, expirado e erro;
- ação explícita de desconexão não foi encontrada no front-end.

#### Sincronização

Estados da ocorrência: `scheduled`, `completed`, `missed`, `cancelled`.

- scheduled: criar/atualizar evento;
- completed/missed: preservar histórico com título e reminders adequados;
- cancelled: remover evento, aceitando ausência 404/410;
- ID determinístico e idempotente;
- retry não duplica;
- concorrência não sobrescreve novo status;
- payload não inclui dados clínicos desnecessários;
- respostas/logs não expõem token, calendar ID ou event ID.

Limitação crítica: existe motor `google-calendar-sync`, mas não há chamador executável visível no front-end nem trigger/cron versionado. Não classificar “não sincronizou” como bug antes de confirmar a arquitetura remota; registrar como validação pendente.

Evidências: `js/google-calendar.js`; `supabase/functions/google-oauth-*/`; `supabase/functions/google-calendar-sync/`; `MEU_PLANO_V1_GOOGLE_ANALISE.md`; testes em `tests/local/google/`.

### 8.15 Métricas operacionais

Eventos permitidos:

- `account_created`;
- `onboarding_completed`;
- `first_product_action`;
- `product_returned`;
- flag local de simulação anterior ao cadastro.

Proibido transmitir medicamento, dose, mg/mL/UI, peso, medidas, gênero, nascimento, localização, observações, e-mail, nome, IP integral, token, URL parametrizada ou JSON livre.

**Casos**

- evento sem JWT: 401;
- evento fora da allowlist: rejeitar;
- chave extra: rejeitar;
- `user_id` deve vir da sessão;
- cliente não deve consultar eventos;
- exclusão da conta deve produzir cascade;
- primeira ação atualmente é disparada de forma confirmada pela aplicação; outras categorias precisam validação/instrumentação.

Evidências: `js/analytics.js`; `supabase/functions/record-product-event/index.ts`; `supabase/migrations/20260907000600_product_events_v1.sql`; `DADOS_METRICAS_V1_ANALISE.md`.

### 8.16 Exclusão permanente de conta

Este é um teste destrutivo e deve usar somente conta descartável de QA.

**Casos**

1. Exigir confirmação textual definida pela interface.
2. Exigir senha atual.
3. Senha errada não exclui nada.
4. JWT ausente/inválido é recusado.
5. Usuário autenticado só exclui a própria conta.
6. Confirmar cascades de todas as tabelas pessoais.
7. Confirmar encerramento da sessão.
8. Confirmar impossibilidade de login posterior.
9. Falha parcial deve gerar mensagem segura.
10. Não imprimir service role, senha ou JWT.
11. Cleanup e evidência sem dados pessoais.

Evidências: `js/onboarding.js`; `supabase/functions/delete-account/index.ts`; `ONBOARDING_V1_SPRINT_2_RLS.md`.

### 8.17 Páginas auxiliares e legal

- `privacy.html`: Política de Privacidade.
- `terms.html`: Termos de Uso.
- `project-delivery-pipeline.html`: visão de pipeline, distribuída no build mas sem link principal.

Verificar links, responsividade, retorno à aplicação e coerência textual. Os Termos permanecem gate de release comercial no DC-004; não declarar adequação jurídica apenas por existência do arquivo.

## 9. Correlações entre funcionalidades

| Origem | Destino | Contrato |
|---|---|---|
| Simulador | Diário | Reutiliza a simulação e a fórmula canônica. |
| Simulador sem sessão | Auth/Onboarding | Salvar exige conta e perfil. |
| Onboarding | Peso | Pode criar peso inicial com data civil local. |
| Onboarding | Google | Opt-in não equivale a conexão concluída. |
| Diário | Peso | Peso opcional associado à aplicação. |
| Diário | Frascos | RPC cria/edita aplicação e retirada atomicamente. |
| Diário | Plano | Confirma ocorrência e diferencia data prevista/real. |
| Diário | Analytics | Aplicação confirmada pode marcar primeira ação. |
| Plano | Rodízio | Ocorrências carregam sugestão/registro de local. |
| Plano | Google | Ocorrência é fonte do evento; elo de disparo não confirmado. |
| Peso/Medidas/Efeitos/Diário | Relatório | Dados próprios compõem a saída imprimível. |
| Auth | Todos os módulos privados | Sessão controla visibilidade e ownership. |
| Exclusão de conta | Todas as tabelas | Cascades precisam ser validados remotamente. |
| DoseDate | Seis módulos | Evita deslocamento de datas civis por UTC. |

Ao testar uma alteração, sempre executar regressão nos destinos correlacionados.

## 10. Modelo de dados para QA

| Objeto | Uso | Fonte versionada | Observação |
|---|---|---|---|
| `applications` | Aplicações realizadas | DDL-base ausente | Schema remoto precisa confirmação. |
| `weight_records` | Peso | DDL-base ausente | Possui compatibilidade legada. |
| `profiles` | Perfil básico Auth | DDL-base/trigger ausente | Citado pelo README/código. |
| `user_settings` | Preferências | DDL-base ausente | Usado pela suíte RLS. |
| `onboarding_profiles` | Jornada e dados do onboarding | Migration 20260906 | RLS própria. |
| `user_consents` | Consentimentos versionados | Migration 20260906 | RLS própria. |
| `application_plans` | Plano | SQL na raiz | Não está na sequência canônica. |
| `scheduled_applications` | Ocorrências | SQL na raiz | Planejamento, não realização. |
| `application_site_records` | Local confirmado | Migration 20260907 | FK composta/ownership. |
| `medication_vials` | Frascos | Migration 20260907 | Estados parciais na UI. |
| `vial_usages` | Retiradas | Migration 20260907 | Uma por aplicação. |
| `body_measurements` | Circunferências | Migration 20260907 | Pelo menos uma medida. |
| `application_effect_notes` | Efeitos livres | Migration 20260907 | Texto sensível. |
| `product_events` | Métricas mínimas | Migration 20260907 | Cliente sem SELECT. |
| `google_calendar_connections` | Estado público Google | SQL candidato na raiz | Estado remoto pendente. |
| `private.google_calendar_credentials` | Refresh token cifrado | SQL candidato | Nunca consultar pelo cliente. |
| `private.google_oauth_states` | State/PKCE | SQL candidato | Uso único/expiração. |
| `set_updated_at()` | Trigger compartilhado | DDL-base ausente | Dependência crítica. |

Não criar, alterar ou apagar schema durante QA sem plano e autorização separados.

## 11. Segurança, privacidade e testes cross-user

Para toda tabela pessoal, executar quando autorizado:

1. A lê os próprios dados.
2. A não lê dados de B.
3. A cria somente com ownership próprio.
4. A não cria em nome de B.
5. A atualiza somente os próprios dados.
6. A não atualiza B por filtro direto ou UUID conhecido.
7. A exclui somente os próprios dados.
8. A não exclui B.
9. Relações compostas impedem associar recurso de A a recurso de B.
10. Logout e troca de conta limpam a interface.

Também validar:

- ausência de PII/PHI em console, toast, URL e logs;
- nenhuma credencial em HTML, JS distribuído ou relatório;
- CORS allowlist;
- respostas 401/403/404 sem enumeração;
- XSS em observações, cidades, “outro”, notas e efeitos;
- falha de rede sem duplicidade;
- concorrência e idempotência;
- uso exclusivo de publishable key no cliente.

## 12. Catálogo de PRDs, análises, Markdown e especificações

### 12.1 Documentação operacional vigente

| Documento | Papel |
|---|---|
| `README.md` | Introdução e operação básica; contém pontos desatualizados registrados em DC-013. |
| `tests/README.md` | Fonte atual da suíte local, integração QA e teste visual. |
| `tests/fixtures/README.md` | Política: somente fixtures sintéticas. |
| `supabase/functions/google-oauth-start/README.md` | Contrato e decisões do início OAuth. |
| `supabase/functions/google-oauth-callback/README.md` | Fluxo e hardening do callback. |
| `supabase/functions/google-calendar-sync/README.md` | Contrato, ciclo de vida, idempotência, estados e limites. |

### 12.2 PRDs, análises e propostas funcionais

| Documento | Escopo | Como usar em QA |
|---|---|---|
| `MEU_PLANO_V1_ANALISE.md` | Plano, recorrência, status, timezone, UX e RLS. | Especificação de intenção; confrontar com `js/plan.js`. |
| `MEU_PLANO_V1_CONFIRM_ANALISE.md` | Confirmação de ocorrência no Diário. | Fonte de atomicidade, dados e idempotência. |
| `MEU_PLANO_V1_GOOGLE_ANALISE.md` | OAuth, tokens, modelo Google e sincronização. | Fonte funcional e de segurança; não prova operação remota. |
| `LEMBRETES_RODIZIO_V1_ANALISE.md` | Lembretes e sugestão de local. | Validar linguagem não clínica e algoritmo. |
| `LEMBRETES_RODIZIO_V1_MIGRATION_PROPOSTA.md` | Modelo de locais/RLS. | Parte foi superada pela migration canônica. |
| `DURACAO_FRASCO_V1_ANALISE.md` | Inventário, saldo e estimativa. | Separar implementado de DC-006. |
| `DURACAO_FRASCO_V1_MIGRATION_PROPOSTA.md` | FKs e saldo. | Comparar com migrations efetivas. |
| `MEDIDAS_CORPORAIS_V1_ANALISE.md` | Campos, UX e privacidade. | Base dos casos de medidas. |
| `MEDIDAS_CORPORAIS_V1_MIGRATION_PROPOSTA.md` | Schema/RLS propostos. | Comparar com migration canônica. |
| `PESO_V1_ANALISE.md` | Peso, origem e integração com Diário. | Base de regressão e legado. |
| `PESO_V1_MIGRATION_PROPOSTA.md` | Associação a aplicação e tratamento legado. | Não presumir aplicação remota. |
| `RELATORIO_PDF_V1_ANALISE.md` | Relatório selecionável e segurança. | Identifica lacunas do código atual. |
| `RELATORIO_PDF_V1_MIGRATION_PROPOSTA.md` | Notas de efeitos. | Comparar com migration canônica. |
| `DADOS_METRICAS_V1_ANALISE.md` | Funil, dados proibidos e retenção. | Base de privacidade de analytics. |
| `PREMIUM_DISCOVERY_V1.md` | Hipótese comercial sem cobrança. | Planejamento; não testar como feature existente. |
| `PROJECT_DELIVERY_PIPELINE.md` | Cadência e sequência histórica de produto. | Planejamento/histórico, não estado atual isolado. |

### 12.3 Logs e evidências históricas

| Documento | Conteúdo | Cuidado |
|---|---|---|
| `AUTH_V1.1_LOG.md` | Auditoria de Auth, redirects e matriz de testes. | Evidência histórica. |
| `RLS_V1_LOG.md` | Matriz RLS histórica das tabelas-base. | Não substitui teste atual em QA. |
| `DIARIO_V1_LOG.md` | Implementação e histórico do Diário/peso. | Pode conter estados superados. |
| `BUILD_V1_LOG.md` | Evolução do build, deploys e sprints. | Grande registro cronológico, não especificação canônica. |
| `MEU_PLANO_V1_MIGRATION_LOG.md` | Migration, hotfixes e Google. | Mistura plano, execução e pós-deploy. |
| `ONBOARDING_V1_SPRINT_2_RLS.md` | Evidências históricas de migration/RLS/exclusão. | Validar novamente no remoto autorizado. |
| `PLATFORM_RELEASE_AUDIT_2026-09-07.md` | Snapshot de release e backup. | Contagens e produção são históricas. |
| `tests/rls/RLS_TEST_RESULT.md` | Resultado local/remoto anterior. | Artefato ignorado; não integra a suíte oficial. |

### 12.4 SQLs e especificações executáveis

- `MEU_PLANO_V1_MIGRATION.sql`: planos e ocorrências fora da pasta canônica.
- `MEU_PLANO_V1_CONFIRM_MIGRATION.sql`: RPC de confirmação original.
- `MEU_PLANO_V1_GOOGLE_MIGRATION_PROPOSTA.sql`: estruturas Google ainda rotuladas como candidatas.
- `supabase/migrations/20260906_onboarding_v1.sql`.
- `supabase/migrations/20260907000400_application_effect_notes_v1.sql`.
- `supabase/migrations/20260907000300_application_site_records_v1.sql`.
- `supabase/migrations/20260907000200_application_vial_atomic_v1.sql`.
- `supabase/migrations/20260907000500_body_measurements_v1.sql`.
- `supabase/migrations/20260907000600_product_events_v1.sql`.
- `supabase/migrations/20260907000100_vial_inventory_v1.sql`.
- preflights em `supabase/*-preflight.sql`.

SQL na raiz ou documento com “proposta” não deve ser executado automaticamente.

## 13. Backlog e riscos que afetam QA

| ID | Tema | Consequência para QA |
|---|---|---|
| DC-001 | Onboarding atômico | Testar falhas em cada etapa; risco crítico confirmado. |
| DC-002 | Datas civis | Concluído; manter regressão de timezone. |
| DC-003 | Aplicação e peso | Procurar órfãos/divergências em falhas. |
| DC-004 | Termos | Gate comercial, não bloqueia desenvolvimento. |
| DC-005 | Relatório PDF | Não esperar seleção/arquivo direto onde não existe. |
| DC-006 | Frascos | Administração completa ainda parcial. |
| DC-007 | Premium discovery | Não existe cobrança/entitlement. |
| DC-008 | Suíte reproduzível | Implementado no checkout; memória oficial pendente. |
| DC-009 | Schema canônico | Clone não reconstrói banco completo. |
| DC-010 | Build/deploy | Wrangler e SDK CDN ainda têm riscos. |
| DC-011 | Plano transacional | Simular falha entre operações. |
| DC-012 | Concorrência em efeitos | Testar duplo clique e latência. |
| DC-013 | README | Não usar README como única fonte. |

Aguardam investigação sem ID: Google ponta a ponta, policies RLS remotas, exclusão de conta, pipeline de produção, telemetria de ativação e diagnóstico `scripts/test-confirm-scheduled-auth.mjs`.

## 14. Regressão por tipo de alteração

| Alteração | Regressão mínima |
|---|---|
| Simulador/seringa | Fórmula, 30/50/100 UI, SVG, overflow e Diário. |
| Auth | Cadastro, login, sessão, logout, recuperação e onboarding. |
| Datas | Timezone São Paulo, viradas de mês/ano e todos os seis consumidores. |
| Diário | CRUD, dashboard, Peso, Plano e Frascos. |
| Peso | Manual, onboarding, Diário, gráfico e fallback legado. |
| Plano | Recorrência, calendário, cancelamento, confirmação, rodízio e Google. |
| Frascos/RPC | Saldo, concorrência, edição/exclusão e cross-user. |
| Google | OAuth, CORS, PKCE, lifecycle, retry, idempotência e privacidade. |
| Relatório | Todas as fontes, escaping, impressão e ausência de rede. |
| CSS/HTML | Desktop/mobile, teclado, modais e seringa. |
| Migration/RLS | Matriz A/A, A/B, B/B, B/A e cleanup. |
| Build | `npm test`, build, hashes, allowlist e `git diff --check`. |

## 15. Critérios de saída da campanha

A campanha só pode ser declarada aprovada quando:

- `npm ci`, `npm test`, teste civil e build passarem no checkout avaliado;
- smoke test desktop e mobile for concluído;
- fluxos públicos e autenticados essenciais forem executados;
- defeitos críticos não permanecerem abertos;
- nenhum dado de A for acessível por B;
- nenhuma credencial ou dado sensível aparecer em logs/saídas;
- tudo que não foi validado remotamente estiver explicitamente marcado;
- artefatos, contas e registros QA tiverem cleanup confirmado;
- versão/commit, navegador, viewport, ambiente e horário estiverem registrados;
- produção não tiver sido alterada sem autorização.

## 16. Modelo de relatório de defeito

```text
ID:
Título:
Funcionalidade:
Ambiente e alvo:
Commit/checkout:
Navegador e viewport:
Conta QA (apelido, nunca e-mail/ID):
Pré-condições:
Passos para reproduzir:
Resultado esperado:
Resultado observado:
Frequência:
Severidade:
Natureza da evidência:
Dados/tabelas afetados:
Correlação com outros módulos:
Console/rede (sanitizados):
Screenshots sem PII:
Cleanup realizado:
Validação remota necessária:
Arquivos ou especificações relacionadas:
```

Severidade deve refletir impacto observado. Não classificar dívida técnica ou validação remota pendente como defeito crítico sem reprodução.

## 17. Ordem recomendada da campanha

1. Inventário do checkout, commit e configuração.
2. `npm ci`, suíte local, teste civil e build.
3. Smoke público e simulador.
4. Auth, recuperação e onboarding.
5. Diário + Peso + Frascos.
6. Plano + confirmação + rodízio.
7. Medidas + Efeitos + Relatório.
8. Google OAuth e sincronização, apenas em QA autorizado.
9. RLS cross-user e exclusão, apenas com contas descartáveis.
10. Responsividade, teclado, modais, falhas e concorrência.
11. Privacidade, logs, URLs e conteúdo distribuído.
12. Regressão correlacionada.
13. Cleanup e relatório final com “não validado”.

## 18. Não presumir

- que um log prova o estado atual de produção;
- que uma migration está aplicada;
- que Google sincroniza ponta a ponta;
- que “Exportar relatório PDF” gera arquivo diretamente;
- que lembrete existe sem Google Agenda;
- que inventário completo de frascos está pronto;
- que Premium, cobrança ou assinatura existem;
- que o README está atualizado;
- que uma conta ou ID histórico pode ser reutilizado;
- que um teste mockado substitui QA remoto;
- que o conteúdo de `public/` é fonte editável.

## 19. Fontes de verdade a reler antes da execução

No Obsidian:

- [[Project Governance]]
- [[Emagreça na Dose Certa - AI Context]]
- [[Project Home]]
- [[Current State]]
- [[Architecture]]
- [[Backlog]]
- [[Roadmap]]
- [[Changelog]]
- [[Decisions/Decision Index]]

No checkout:

- `package.json`;
- `tests/README.md`;
- `index.html`;
- `app.js`;
- `js/`;
- `supabase/migrations/`;
- `supabase/functions/`;
- PRDs/análises relacionadas ao módulo sob teste.

Sempre confronte este guia com o checkout recebido. Se o código mudar, este documento pode ficar desatualizado e deve ser revisado conforme a governança.
