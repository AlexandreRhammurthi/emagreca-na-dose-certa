# Auditoria de QA e Plano de Correções — Dose Certa

**Data:** 09/09/2026  
**Produto:** Dose Certa / Emagreça na Dose Certa  
**Escopo:** aplicação web, módulos autenticados, simulador, documentação, build e testes locais  
**Destinatário:** IA Codex, para execução das correções e validações  
**Classificação do documento:** handoff técnico de QA

---

## 1. Instruções para o Codex

Execute este documento como uma lista de trabalho técnica:

1. Leia cada item de correção antes de alterar código.
2. Corrija sempre os arquivos-fonte na raiz do projeto.
3. Nunca edite manualmente arquivos em `public/`; execute `npm run build` depois das alterações.
4. Preserve RLS, ownership, datas civis, atomicidade, acessibilidade e o limite educativo do produto.
5. Não use `service_role`, Secret Key, JWT, senha, refresh token ou credencial Google no frontend, no repositório ou nos logs.
6. Não declare uma integração remota como validada sem evidência no ambiente QA autorizado.
7. Depois de cada correção, execute o teste mais específico possível e, ao final, execute o build e a suíte completa.
8. Não remova testes para fazer a suíte passar.
9. Registre no final deste documento quais itens foram corrigidos, quais testes passaram e quais dependências remotas continuam pendentes.

### Comandos obrigatórios ao finalizar

```powershell
npm ci
npm run build
npm test
npm run test:civil-date
```

Para testes remotos, somente com ambiente QA autorizado e variáveis configuradas:

```powershell
npm run test:integration:rls
npm run test:integration:onboarding
```

---

## 2. Resumo executivo

### Resultado geral

- **Build:** PASS — `BUILD: SUCCESS`, 22/22 arquivos sincronizados.
- **Suíte local:** PASS — 97 testes aprovados, 0 falhas, 0 cancelados.
- **Autenticação real no browser:** PASS — login com conta QA fornecida, sessão e nome do usuário exibidos.
- **Simulador:** PASS — exemplo 15 mg / 0,5 mL / dose 2,5 mg apresentou aproximadamente 8,33 UI em seringa de 50 UI.
- **Diário:** PASS — aplicação persistida e exibida no histórico.
- **Peso:** PASS — registro manual e peso vinculado à aplicação apareceram no gráfico e no histórico.
- **Medidas corporais:** PASS — registro persistido e exibido.
- **Efeitos relatados:** PASS — anotação persistida e exibida.
- **Meu Plano:** PASS — agendamento futuro, sugestão de rodízio e cancelamento validados.
- **Google Agenda:** estado de conexão exibido como conectado na sessão; ciclo OAuth/Google completo não foi revalidado nesta execução.
- **Relatório:** contrato automatizado PASS; abertura manual do popup não foi confirmada pelo browser de automação.
- **Documentação:** existem divergências de atualização que devem ser corrigidas antes de considerar a documentação sincronizada com o checkout atual.

### Conclusão de QA

O checkout está funcional para os principais fluxos locais autenticados e possui uma suíte automatizada forte. Não há falha crítica confirmada nos testes executados. Há, entretanto, pendências de evidência remota e duas ações de correção documental/operacional que devem ser tratadas antes do fechamento definitivo de release:

1. tornar a exportação do relatório verificável de forma robusta em browser real e automatizado;
2. atualizar o `README.md` e os documentos de estado para refletirem a arquitetura atual e os resultados reais de QA.

---

## 3. Critério de evidência utilizado

| Status | Significado |
|---|---|
| **PASS local** | Reproduzido no checkout ou no browser local autenticado. |
| **PASS automatizado** | Teste reproduzível passou na suíte local. |
| **CONFIRMADO NO CÓDIGO** | Contrato ou comportamento existe no código-fonte atual. |
| **PENDENTE REMOTO** | Requer Supabase, Google, Cloudflare ou ambiente autorizado. |
| **PENDENTE MANUAL** | Não foi possível concluir a observação por limitação do browser/ambiente. |
| **CORREÇÃO RECOMENDADA** | Melhoria necessária para reduzir risco ou eliminar divergência documental. |

Não considerar logs históricos ou propostas de migration como prova de que uma alteração foi executada no Supabase remoto.

---

## 4. Escopo testado

### 4.1 Fluxos públicos

- Carregamento por HTTP em `http://localhost:8000/`.
- Renderização do simulador.
- Catálogo de medicamentos.
- Entradas de concentração, dose e capacidade de seringa.
- Resultado visual da seringa e mensagem educativa de segurança.
- Proteção da área autenticada para usuário não autenticado.

### 4.2 Fluxos autenticados

- Login com usuário QA.
- Restauração/carregamento da sessão.
- Navegação para Diário, Peso e Meu Plano.
- Registro de aplicação.
- Registro de peso.
- Peso vinculado ao registro de aplicação.
- Medidas corporais.
- Efeitos relatados.
- Criação de aplicação agendada futura.
- Sugestão de rodízio de local.
- Cancelamento de aplicação agendada.
- Estado da conexão Google Agenda exibido na interface.
- Tentativa de exportação do relatório.

### 4.3 Validações técnicas

- Build por allowlist para `public/`.
- Ausência de Secret Key e `service_role` no build.
- Contratos locais de RLS, onboarding, datas civis, modais, frascos, relatório, efeitos, medidas e Google.
- Testes locais de OAuth start, OAuth callback e sincronização Google.
- CORS/preflight da função de métricas.

### 4.4 Documentação revisada

- `README.md`
- `QA Agent Guide.md`
- `PLATFORM_RELEASE_AUDIT_2026-09-07.md`
- logs de Auth, Build, Diário, Plano, RLS, Peso, Medidas, Relatório e Métricas
- propostas e preflights de migration relacionados às funcionalidades atuais

---

## 5. Evidências funcionais observadas

### 5.1 Simulador

Entrada usada:

- Medicamento: Tirzepatida
- Frasco: 15 mg / 0,5 mL
- Dose: 2,5 mg
- Seringa: 50 UI

Resultado observado:

- Concentração implícita: 30 mg/mL
- Volume: aproximadamente 0,083 mL
- Quantidade: 8,33 UI
- Ocupação: 16,7% da seringa de 50 UI

O resultado foi coerente com a fórmula documentada:

```text
concentração = mg_do_frasco / ml_do_frasco
volume       = dose_mg / concentração
unidades     = volume * 100
ocupação     = unidades / capacidade_da_seringa * 100
```

### 5.2 Diário

O browser exibiu:

- última aplicação em 08/09/2026;
- 2 aplicações nos últimos 30 dias;
- Tirzepatida como medicamento mais registrado;
- dose registrada de 2,5 mg;
- quantidade calculada de 8,33 UI.

Também foi verificada a persistência da aplicação após o recarregamento da sessão.

### 5.3 Peso

O browser exibiu registros de origem distinta:

- `Registrado na aplicação`;
- `Registro diário`.

Foram observados registros de 92,5 kg, 85,6 kg e 72,5 kg, além do gráfico com indicadores de redução e evolução total.

### 5.4 Medidas e efeitos

Foram observados:

- Medidas: Abdômen 92,5 cm e Cintura 85 cm.
- Efeito relatado: anotação QA persistida e exibida com data.
- Ações de editar e excluir presentes nos cartões.

### 5.5 Meu Plano

Foi criado e depois cancelado um agendamento QA:

- Medicamento: Tirzepatida
- Dose: 2,5 mg
- Data futura: 10/09/2026
- Horário: 09:00
- Sugestão de rodízio: Abdômen esquerdo

O card de próxima aplicação foi exibido corretamente. O modal de cancelamento abriu e, após confirmação, a ocorrência deixou de aparecer entre as próximas aplicações.

O registro foi cancelado ao final para não deixar dados de teste ativos no plano.

---

## 6. Correções obrigatórias para execução do Codex

## COR-001 — Tornar a exportação do relatório verificável e resiliente

**Prioridade:** P1  
**Arquivos:** `js/report.js`, testes de relatório, eventualmente `index.html`  
**Status atual:** contrato automatizado PASS; validação manual do popup PENDENTE.

### Problema

O relatório usa `window.open('', '_blank')`. No browser de automação, o clique produziu instabilidade/page error e a janela não pôde ser capturada de forma confiável. Não foi possível confirmar manualmente o HTML final com as quatro seções:

- Evolução do peso;
- Histórico de aplicações;
- Medidas corporais;
- Efeitos relatados.

Isso não prova que o relatório esteja quebrado em browser real, mas deixa uma lacuna de verificação e uma UX frágil quando popup é bloqueado ou quando a abertura de nova janela falha.

### Implementação exigida

1. Preservar a abertura iniciada por ação explícita do usuário.
2. Detectar `window.open` nulo e apresentar mensagem clara para permitir popups.
3. Garantir que o botão seja liberado em todos os caminhos, inclusive erro de rede ou exceção, usando `try/finally`.
4. Escapar todo conteúdo inserido no HTML do relatório.
5. Adicionar uma alternativa verificável quando a nova janela falhar, por exemplo:
   - gerar uma página de relatório no mesmo contexto; ou
   - oferecer botão de retry; ou
   - mostrar uma mensagem de erro acionável sem deixar o botão travado.
6. Não incluir dados de outros usuários; todas as consultas devem continuar sob a sessão/RLS atual.
7. Não adicionar automaticamente dados clínicos fora das quatro coleções já previstas.

### Critérios de aceite

- Clique com popup permitido abre o relatório.
- Clique com popup bloqueado mostra mensagem em português e mantém o botão utilizável.
- Erro em qualquer consulta libera o botão e mostra erro amigável.
- O relatório contém título, data de geração e as quatro seções esperadas.
- O conteúdo de usuário com `<`, `>`, `&`, aspas e apóstrofos não vira HTML executável.
- O teste automatizado cobre sucesso, popup bloqueado, erro de consulta e liberação do botão.
- Teste manual em Chrome confirma impressão ou visualização imprimível.

### Validação recomendada

```powershell
npm test
npm run build
```

Depois, executar manualmente com popup permitido e bloqueado.

---

## COR-002 — Atualizar o README para refletir o checkout atual

**Prioridade:** P1  
**Arquivo:** `README.md`  
**Status atual:** documentação defasada em relação à implementação atual.

### Problema

O README descreve uma arquitetura reduzida com foco em simulador, Auth e Diário, mas o checkout atual também contém:

- onboarding e consentimentos;
- Peso e gráfico;
- Medidas corporais;
- Efeitos relatados;
- Meu Plano e recorrência;
- rodízio de local;
- frascos e saldo;
- Relatório;
- Google OAuth/Calendar;
- analytics e Edge Functions;
- build por allowlist;
- testes locais e integração.

Um operador que siga o README não terá um mapa confiável do sistema nem dos comandos atuais.

### Implementação exigida

Atualizar o README sem remover as regras de segurança existentes e incluir:

1. árvore atual de arquivos e módulos;
2. responsabilidades de `js/diary.js`, `weight.js`, `measurements.js`, `effects.js`, `plan.js`, `vials.js`, `report.js`, `google-calendar.js`, `onboarding.js` e `analytics.js`;
3. diferença entre fonte na raiz e artefato gerado em `public/`;
4. comandos reais do `package.json`;
5. contagem atual da suíte somente como resultado datado, não como garantia permanente;
6. separação entre PASS local e validação remota pendente;
7. instruções de `npm run build`, `npm test` e servidor local;
8. requisitos de variáveis para testes de integração;
9. limites do produto educativo e proibição de prescrição/diagnóstico;
10. estado das migrations: versão no repositório não significa aplicação no Supabase remoto.

### Critérios de aceite

- Nenhum módulo existente fica ausente da árvore ou da seção de arquitetura.
- Os comandos documentados executam sem divergência do `package.json`.
- O README não afirma publicação, migration ou Google end-to-end como fato sem evidência remota.
- `npm run build` continua funcionando após a atualização.

---

## COR-003 — Sincronizar o estado documental de release e QA

**Prioridade:** P1  
**Arquivos:** `QA Agent Guide.md`, `PLATFORM_RELEASE_AUDIT_2026-09-07.md` e logs relacionados  
**Status atual:** documentos possuem contagens e estados históricos diferentes da execução atual.

### Problema

Há divergências entre documentos históricos e o checkout atual, por exemplo:

- auditoria anterior registra 72 verificações e 21/21 arquivos;
- execução atual registra 97 testes e 22/22 arquivos;
- documentos antigos ainda descrevem ausência de credenciais ou funcionalidades em estado anterior;
- propostas de migration coexistem com migrations e implementações posteriores.

Isso pode induzir um agente a executar uma etapa já concluída ou declarar como remoto algo que só foi validado localmente.

### Implementação exigida

1. Adicionar uma seção de “Estado de QA em 09/09/2026” no guia principal.
2. Manter os resultados históricos, mas marcá-los como históricos.
3. Atualizar a contagem atual para 97 pass / 0 fail e build 22/22, com data e comando.
4. Listar explicitamente as pendências remotas:
   - schema/RLS remoto;
   - publicação Cloudflare;
   - OAuth Google ponta a ponta;
   - exclusão destrutiva de conta;
   - telemetria remota;
   - integração real com duas sessões independentes, quando ainda não executada.
5. Marcar propostas de migration como proposta e identificar a migration canônica correspondente quando existir.
6. Registrar a limitação do popup do relatório como “PENDENTE MANUAL”, não como PASS manual.

### Critérios de aceite

- Os documentos usam a mesma taxonomia de evidência.
- Nenhuma contagem histórica é apresentada como resultado atual.
- O estado remoto permanece explicitamente pendente quando não houver prova.
- Links e nomes de arquivos apontam para arquivos existentes.

---

## 7. Pendências remotas que não devem ser “corrigidas” no código sem evidência

Estas atividades são validações operacionais, não correções frontend automáticas:

### REM-001 — RLS com duas sessões QA

Executar com duas contas QA independentes, Publishable Key e alvo QA identificado. Testar SELECT, INSERT, UPDATE e DELETE com IDs próprios e cruzados para todas as tabelas pessoais.

**Aceite:** usuário A nunca lê ou altera dados do usuário B; cleanup remove somente UUIDs criados pelo teste.

### REM-002 — Migrations no Supabase remoto

Comparar migrations versionadas, catálogo remoto, tabelas, colunas, constraints, índices, funções e policies. Não aplicar SQL de produção automaticamente.

**Aceite:** catálogo remoto corresponde à migration canônica ou divergências ficam documentadas e aprovadas.

### REM-003 — Google Agenda ponta a ponta

Validar OAuth start, callback, conexão, criação, edição, cancelamento, retry, estados terminal e refresh em projeto Google/Supabase QA autorizado.

**Aceite:** nenhum token é exposto; event IDs são determinísticos; status local não é sobrescrito indevidamente; falha externa preserva o source of truth local.

### REM-004 — Exclusão permanente de conta

Executar somente com conta QA descartável e autorização explícita. Confirmar senha, exclusão de Auth e cascata dos dados pessoais.

**Aceite:** não restam registros do usuário nas tabelas previstas; nenhuma conta de produção é utilizada.

### REM-005 — Publicação

Validar que o conteúdo publicado corresponde ao build atual, com redirects Supabase, domínio e Worker autorizados.

**Aceite:** versão publicada reproduz o build local, não expõe segredos e todos os caminhos de Auth retornam ao domínio autorizado.

### REM-006 — Telemetria

Validar no ambiente remoto que eventos autenticados chegam à função, CORS allowlist funciona e payload não contém dados clínicos.

**Aceite:** OPTIONS e POST permitidos apenas nas origens configuradas; requisições sem JWT são rejeitadas; nenhum peso, dose, medida, anotação ou diagnóstico é enviado.

---

## 8. Matriz de regressão para o Codex

| Área | Teste | Resultado atual | Próxima ação |
|---|---|---|---|
| Simulador | Fórmula, 30/50/100 UI, SVG e validações | PASS local/automatizado | Manter regressão |
| Auth | Login QA e sessão | PASS browser | Revalidar em ambiente publicado |
| Onboarding | Perfil, consentimentos, peso inicial | PASS automatizado | Executar fluxo remoto destrutivo somente em QA |
| Diário | Criar, editar, excluir, confirmação futura | PASS local/browser | Revalidar atomicidade remota |
| Peso | Criar, gráfico, origem, CRUD | PASS browser/automatizado | Revalidar ownership remoto |
| Medidas | Criar, editar, excluir | PASS browser/automatizado | Revalidar RLS remoto |
| Efeitos | Criar, editar, excluir | PASS browser/automatizado | Revalidar RLS remoto |
| Plano | Criar, rodízio, cancelar | PASS browser/automatizado | Revalidar concorrência e RLS remoto |
| Google | Core/OAuth local | PASS automatizado | PENDENTE end-to-end remoto |
| Relatório | Contrato e RLS | PASS automatizado | COR-001 e teste manual |
| Frascos | Saldo, RPC e vínculo | PASS automatizado | Revalidar migration/RPC remoto |
| Analytics | Contrato, CORS e dados mínimos | PASS automatizado | PENDENTE operação remota |
| Build | allowlist, integridade e segredos | PASS | Manter no CI |
| Documentação | coerência entre README, guia e logs | PENDENTE | COR-002 e COR-003 |

---

## 9. Não alterar sem decisão de produto

O Codex não deve implementar estes itens como “correção” sem uma nova decisão:

- cobrança, paywall ou funcionalidades Premium;
- recomendação de dose, medicamento, local ou conduta clínica;
- interpretação médica de peso, medidas ou efeitos;
- leitura ampla de dados Google além do escopo autorizado;
- alteração de schema remoto sem preflight, revisão e autorização;
- limpeza de dados de produção;
- remoção de testes ou relaxamento de RLS para facilitar a execução.

---

## 10. Checklist de fechamento após as correções

- [x] COR-001 implementada e coberta por teste de sucesso, bloqueio de popup e erro.
- [x] COR-002 aplicada ao README.
- [x] COR-003 aplicada ao guia e auditoria de release.
- [x] `npm ci` executado.
- [x] `npm run build` retorna `BUILD: SUCCESS`.
- [x] `npm test` retorna 0 falhas.
- [x] `npm run test:civil-date` retorna 0 falhas.
- [x] Nenhum segredo privilegiado foi identificado pelo build no source ou em `public/`.
- [x] Relatório manual aberto e conferido em Chrome (evidência confirmada na instrução de continuação).
- [ ] Responsividade revisada em mobile e desktop.
- [ ] RLS remoto validado com duas contas QA, se o ambiente estiver autorizado.
- [ ] Google Agenda remoto validado, se o ambiente estiver autorizado.
- [ ] Exclusão de conta QA validada, se houver autorização destrutiva.
- [ ] Documentos atualizados com data, comando e evidência.
- [ ] Nenhuma alteração foi feita diretamente em `public/`.

---

## 11. Registro para preenchimento pelo Codex

### Correções executadas

| ID | Arquivo(s) | Alteração | Teste | Resultado | Data |
|---|---|---|---|---|---|
| COR-001 | `js/report.js`, `index.html`, `styles.css`, `tests/local/contracts/report-pdf-v1.test.mjs` | Pop-up bloqueado, falha de consulta, escape HTML, status acessível e liberação garantida do botão. | `node --test tests/local/contracts/report-pdf-v1.test.mjs`; `npm test` | PASS AUTOMATIZADO | 09/09/2026 |
| COR-002 | `README.md` | Arquitetura, módulos, funções, limites, build, testes e fronteiras local/remoto atualizados. | Revisão do checkout e `package.json` | PASS LOCAL | 09/09/2026 |
| COR-003 | `QA Agent Guide.md`, `PLATFORM_RELEASE_AUDIT_2026-09-07.md`, este registro | Taxonomia de evidências, histórico preservado e pendências remotas explicitadas. | Revisão documental | PASS LOCAL | 09/09/2026 |

### Pendências remotas após a execução

- REM-001 RLS: PENDENTE REMOTO — duas sessões QA e ownership ainda não foram executados nesta rodada.
- REM-002 Migrations: PENDENTE REMOTO — preflight/diff de catálogo remoto não executado.
- REM-003 Google: PENDENTE REMOTO — OAuth e ciclo de vida E2E não executados.
- REM-004 Exclusão de conta: PENDENTE REMOTO — requer conta descartável e autorização destrutiva específica.
- REM-005 Publicação: PENDENTE REMOTO — build local não foi comparado ao Worker/domínio publicado.
- REM-006 Telemetria: PENDENTE REMOTO — validação de JWT, CORS e payload no ambiente autorizado não executada.

### Resultado final

- Build: PASS AUTOMATIZADO — `npm run build`, 22/22 arquivos sincronizados, `BUILD: SUCCESS`.
- Testes locais: PASS AUTOMATIZADO — registro histórico anterior: `npm test`, 97 aprovados / 0 falhas; substituído pela execução pós-COR-004 de 98 aprovados / 0 falhas na seção 12.
- Teste manual do relatório: PASS MANUAL — popup permitido, popup bloqueado e impressão/visualização confirmados pela instrução de continuação.
- RLS remoto: PENDENTE REMOTO.
- Google Agenda remoto: PENDENTE REMOTO.
- Publicação: PENDENTE REMOTO.
- Responsável pela aprovação:
- Data da aprovação:

---

## 12. Atualização — COR-004 e pre-flight REM-001 (09/09/2026)

### COR-004 — Ajuste visual dos botões Editar/Excluir

- **Evidência inicial:** defeito visual confirmado manualmente.
- **Causa raiz confirmada no código:** `Editar` e `Excluir` usam a classe compartilhada `.weight-action`, cuja largura fixa de `36px` é adequada a ícones, mas insuficiente para botões textuais. O container compartilhado `.measurements-actions` também usava `gap: 7px` sem comportamento de quebra ou margem interna adicional.
- **Correção:** `.measurements-actions` agora alinha as ações à direita, usa `gap: 10px`, `flex-wrap`, `justify-self:end` e margem segura. Seus botões textuais usam `width:auto`, `min-width:76px`, `min-height:36px` e `white-space:nowrap`. Em até 620px, o container ocupa a largura disponível e pode quebrar sem overflow.
- **Escopo:** componente compartilhado pelas listas de Medidas corporais e Efeitos relatados. Diário, Peso, Plano e Frascos não usam `.measurements-actions` e não receberam alteração funcional ou visual nesta correção.
- **Resultado automatizado:** PASS AUTOMATIZADO — contrato de CSS adicionado sem remover ou relaxar testes.
- **Resultado manual:** PENDENTE MANUAL — inspeção autenticada em desktop, tablet e mobile continua necessária.

| ID | Arquivo(s) | Alteração | Teste | Resultado | Data |
|---|---|---|---|---|---|
| COR-004 | `styles.css`, `tests/local/contracts/body-measurements-v1.test.mjs`, este registro | Ações textuais responsivas e teste de contrato para espaçamento, dimensão e quebra. | `node --test tests/local/contracts/body-measurements-v1.test.mjs tests/local/contracts/effects-v1.test.mjs`; `npm test` | PASS AUTOMATIZADO | 09/09/2026 |

### Regressão local após COR-004

- `npm ci`: PASS LOCAL — 0 vulnerabilidades reportadas.
- `npm run build`: PASS AUTOMATIZADO — `BUILD: SUCCESS`, 22/22 arquivos sincronizados.
- `npm test`: PASS AUTOMATIZADO — 98 aprovados, 0 falhas.
- `npm run test:civil-date`: PASS AUTOMATIZADO — 8 aprovados, 0 falhas.
- `git diff --check`: PASS LOCAL — sem erros; apenas avisos informativos de normalização LF/CRLF.
- Build e varredura focada: Secret Key, `service_role`, JWT, refresh token, senha, credenciais Google e tokens Cloudflare privilegiados: nenhum valor encontrado no source/build. A presença de nomes de campos em testes ou módulos server-side não é tratada como segredo.

### PRE-FLIGHT REM-001 — RLS A/B

Este é um inventário de repositório, não uma leitura do Supabase remoto. As policies marcadas como propostas, históricas ou com DDL-base ausente exigem confirmação REM-002 antes de qualquer conclusão sobre o banco QA.

| Tabela | Ownership / relações | SELECT | INSERT | UPDATE | DELETE | Policy/RPC relacionada no repositório |
|---|---|---|---|---|---|---|
| `applications` | `user_id`; vínculos compostos são referenciados por frascos/locais/agendamentos | previsto A/B | previsto A/B | previsto A/B | previsto A/B | DDL-base/policy canônica ausente; `create_application_with_optional_vial`, `update_application_with_optional_vial`, `confirm_scheduled_application` usam `auth.uid()` e `SECURITY INVOKER` nas migrations versionadas. |
| `weight_records` | `user_id`; pode vincular aplicação | previsto A/B | previsto A/B | previsto A/B | previsto A/B | DDL-base/policy canônica ausente; usado por `rls.integration.mjs`. |
| `user_settings` | `user_id` | previsto A/B | UPSERT previsto A/B | previsto A/B | previsto A/B | DDL-base/policy ausente; cobertura existente em `rls.integration.mjs`. |
| `profiles` | `id` do titular | previsto A/B | N/A (criado por fluxo Auth) | previsto A/B | N/A | DDL-base/policy ausente; script existente não deve alterar perfil pré-existente sem isolamento. |
| `onboarding_profiles` | PK `user_id` → `auth.users` | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `onboarding_profiles_own_{select,insert,update,delete}`. |
| `user_consents` | PK `(user_id, consent_key)` → `auth.users` | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `user_consents_own_{select,insert,update,delete}`. |
| `application_plans` | `user_id`; PK composta `(id,user_id)` | previsto A/B | previsto A/B | previsto A/B | previsto A/B | Policies `application_plans_*_own` em `MEU_PLANO_V1_MIGRATION.sql`, fora da sequência canônica. |
| `scheduled_applications` | `user_id`; FKs compostas para plano e aplicação | previsto A/B | previsto A/B | prevista A/B | prevista A/B, exceto completed | Policies `scheduled_applications_*_own` em SQL fora da sequência canônica; `confirm_scheduled_application` é RPC invoker. |
| `application_site_records` | `user_id`; FKs compostas para aplicação/agendamento | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `application_site_records_own_{select,insert,update,delete}`. |
| `medication_vials` | `user_id`; `(id,user_id)` único | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `medication_vials_own_*`; RPCs de frasco invoker. |
| `vial_usages` | `user_id`; FKs compostas para frasco e aplicação | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `vial_usages_own_*`; criação/edição deve ser exercida somente pelas RPCs atômicas. |
| `body_measurements` | `user_id` → `auth.users` | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `body_measurements_own_*`. |
| `application_effect_notes` | `user_id`; FK composta opcional para aplicação | própria / cruzada | própria / forjada | própria / cruzada | própria / cruzada | `application_effect_notes_own_*`. |
| `google_calendar_connections` | `user_id` único | própria / cruzada | N/A no browser | N/A no browser | N/A no browser | Apenas select próprio na migration candidata Google; funções OAuth/sync são outro gate. |
| `product_events` | `user_id` → `auth.users` | N/A no browser | próprio / forjado | N/A no browser | N/A no browser | Apenas `product_events_own_insert`; validar em REM-006. |

`private.google_calendar_credentials` e `private.google_oauth_states` guardam dados sensíveis e não têm grant/policy para cliente; não serão consultadas por sessões A/B. Sua proteção será avaliada via REM-003 e REM-002, nunca por acesso direto do browser.

**Scripts a reutilizar:** `npm run test:integration:rls` para `applications`, `weight_records`, `user_settings` e `profiles`; `npm run test:integration:onboarding` para `onboarding_profiles` e `user_consents`. Novas matrizes A/B serão necessárias antes de declarar REM-001 para Plano, locais, frascos, medidas e efeitos.

**Pré-condições ausentes:** não há nesta sessão `TEST_TARGET`, URL/ref/key QA, nem credenciais A/B. Também não há prova de que exista Supabase QA separado da produção ou autorização para escrita remota.

**Dados e cleanup previstos:** cada teste futuro deve criar somente linhas com marcador de execução aleatório e UUIDs retornados, em contas QA descartáveis. O cleanup deve rodar em `finally`, restringir `DELETE` à lista desses IDs/UUIDs e confirmar remoção por leitura do próprio titular. Não serão usados filtros por medicamento/data genéricos, nem serão apagados dados pré-existentes. O atual `rls.integration.mjs` restaura temporariamente `profiles` e `user_settings` existentes; portanto não será executado sem revisão para esse isolamento ou sem contas QA comprovadamente descartáveis.

---

## 13. REM-001 — preparação local do harness (09/09/2026)

**Status:** PASS AUTOMATIZADO LOCAL. **Execução REM-001:** PENDENTE REMOTO.

- A URL/ref de produção conhecida `jxfjsleqwfjrkcxcqpvw` foi bloqueada explicitamente no guard de integração.
- O guard exige simultaneamente `TEST_TARGET=qa`, URL/ref coerentes, Publishable Key, `TEST_ALLOW_QA_WRITE=true` e `TEST_USERS_DISPOSABLE=true`; qualquer Secret Key, `service_role` ou JWT declarado como chave do teste aborta antes do cliente ser criado.
- Os dois runners continuam usando `signInWithPassword`, duas sessões independentes e Publishable Key. Não usam admin API, `service_role`, Secret Key, JWT manual ou impersonation.
- Cada execução gera `qaRunId` aleatório. Notas, nomes de profile, cidade, medicamento e versão de consentimento passam a carregar esse identificador quando o campo suporta marcador.
- Antes de mutações, o runner geral exige que `applications`, `weight_records` e `user_settings` estejam vazios para cada conta; o runner de onboarding exige `onboarding_profiles` e `user_consents` vazios. Nenhum dado pré-existente é apagado para liberar o teste.
- `profiles` é exceção estrutural: pode ser criado automaticamente pelo trigger do Auth. O registro não entra no cleanup e só pode receber marcador nas contas que confirmaram explicitamente ser descartáveis. O antigo mecanismo de restauração de profile/settings preexistentes foi removido.
- Cleanup mantém `finally` obrigatório e remove somente IDs retornados por INSERT. Para `user_settings`, a exceção documentada é a chave `user_id`: a guarda garante ausência anterior, a linha é criada pela execução e o cleanup usa somente o `user_id` da conta descartável rastreada.
- Nenhuma operação remota, migration, alteração de policy, banco, deploy, commit ou push foi realizada nesta etapa.

### Cobertura local do harness

| Caso | Resultado |
|---|---|
| target ausente/diferente de QA | PASS AUTOMATIZADO |
| URL/ref de produção e URL/ref divergentes | PASS AUTOMATIZADO |
| confirmação de escrita ausente | PASS AUTOMATIZADO |
| confirmação de contas descartáveis ausente | PASS AUTOMATIZADO |
| Secret Key/service role/JWT no ambiente do teste | PASS AUTOMATIZADO |
| configuração QA sintética coerente | PASS AUTOMATIZADO |
| dados preexistentes detectados | PASS AUTOMATIZADO |
| tracker de cleanup limitado a IDs/tabelas permitidos | PASS AUTOMATIZADO |
| identificador único por execução | PASS AUTOMATIZADO |

### Funções/RPCs encontradas para REM-001 futuro

| Função/RPC | Tabelas envolvidas | SECURITY DEFINER | Risco | Deve entrar no REM-001? |
|---|---|---|---|---|
| `create_application_with_optional_vial` | applications, medication_vials, vial_usages | Não; `SECURITY INVOKER` | Médio: cria dados e usa frasco por `auth.uid()`. | Sim, quando a matriz de frascos for adicionada. |
| `update_application_with_optional_vial` | applications, medication_vials, vial_usages | Não; `SECURITY INVOKER` | Médio: altera aplicação e retirada com locks. | Sim, quando a matriz de frascos for adicionada. |
| `confirm_scheduled_application` | scheduled_applications, applications, weight_records, medication_vials, vial_usages | Não; `SECURITY INVOKER` | Médio: confirmação transacional de ocorrência. | Sim, no escopo de Plano/Diário. |
| `set_updated_at` | triggers de tabelas pessoais | Não; `SECURITY INVOKER` na SQL de Plano | Baixo: trigger de timestamp, não RPC de cliente. | Não diretamente; verificar via REM-002. |

Nenhuma função `SECURITY DEFINER` relacionada a essas tabelas foi encontrada nas migrations SQL inspecionadas. Edge Functions com privilégios de servidor permanecem fora deste gate e serão verificadas nos gates específicos.

### Validação desta etapa

- `node --check` dos quatro módulos do harness: PASS LOCAL.
- Teste específico do harness/guards: 14 aprovados, 0 falhas.
- `npm ci`: PASS LOCAL, 0 vulnerabilidades reportadas.
- `npm run build`: PASS AUTOMATIZADO, 22/22 arquivos, `BUILD: SUCCESS`.
- `npm test`: PASS AUTOMATIZADO, 107 aprovados, 0 falhas.
- `npm run test:civil-date`: PASS AUTOMATIZADO, 8 aprovados, 0 falhas.
- `git diff --check`: PASS LOCAL; avisos LF/CRLF somente.
- Varredura de valores privilegiados no source/build/harness: sem achados.

---

## 14. REM-001 — modo `production-qa` autorizado (09/09/2026)

**Status:** PASS AUTOMATIZADO LOCAL. **Execução remota:** PENDENTE DE PRÉ-FLIGHT.

- A estratégia foi atualizada para permitir uso controlado do projeto de produção conhecido somente no modo explícito `TEST_TARGET=production-qa`.
- O modo padrão `qa` permanece protegido: URL ou ref de produção conhecido abortam imediatamente. O modo `production-qa` exige a URL/ref exatos, `TEST_ALLOW_PRODUCTION_QA_WRITE=true`, `TEST_ALLOW_QA_WRITE=true`, `TEST_USERS_DISPOSABLE=true`, Publishable Key e duas identidades distintas.
- Qualquer variável administrativa, Secret Key, service role, JWT manual, token de acesso ou senha de banco no ambiente do runner interrompe a execução antes da criação do cliente Supabase.
- Os runners continuam a exigir ausência de registros nas tabelas que tocarão; não removem dados preexistentes e o cleanup é restrito aos IDs retornados pela própria execução.
- A cobertura local inclui: opt-in de produção ausente, contas não descartáveis, ref de produção incorreta, configuração `production-qa` válida e usuários A/B iguais. Resultado: **20 aprovados, 0 falhas**.
- Regressão consolidada: `npm ci` sem vulnerabilidades; `npm run build` 22/22 com `BUILD: SUCCESS`; `npm test` 112 aprovados, 0 falhas; `npm run test:civil-date` 8 aprovados, 0 falhas; `git diff --check` aprovado; varredura de tokens/chaves sem valores encontrados.
- A inspeção de ambiente desta sessão confirmou que as onze variáveis necessárias ao pré-flight, inclusive as duas credenciais A/B, ainda não estão configuradas. Não houve login remoto, consulta ao Supabase, escrita, RPC, migration, policy, deploy, commit ou push.

### Tentativa de preflight posterior

- O guard foi invocado novamente em modo exclusivamente não destrutivo, mas a configuração obrigatória continuou ausente tanto do processo quanto do escopo de usuário do Windows.
- A execução foi interrompida antes de `signInWithPassword`; não houve conexão autenticada, leitura remota ou qualquer mutação.

### Preflight controlado posterior — autenticação

- Os guards de `production-qa`, projeto autorizado e Publishable Key passaram em memória para o preflight. USER A autenticou exclusivamente por `signInWithPassword`; USER B falhou na autenticação.
- O fluxo parou antes de comparar identidades ou realizar `SELECT` nas tabelas. Nenhum dado pessoal, segredo, token, UUID, conteúdo de registro ou detalhe de erro de autenticação foi registrado.
- Decisão: **NO-GO** até que a autenticação de ambas as contas descartáveis seja confirmada.

### Preflight remoto controlado — dados preexistentes

- Guards, autenticação independente A/B, identidades distintas, destino/ref de produção autorizado e credencial Publishable foram aprovados.
- As consultas somente-leitura detectaram dados preexistentes de USER A em `applications`, `weight_records`, `onboarding_profiles` e `user_consents`. USER B não apresentou registros nas áreas consultadas. `profiles` foi tratado como exceção estrutural criada pelo Auth para ambas as contas.
- Decisão: **NO-GO — CONTA QA CONTÉM DADOS PREEXISTENTES**. Nenhum cleanup foi tentado e nenhuma mutação ou RPC foi executada.

---

## 15. Análise local de dependências para limpeza de USER A (09/09/2026)

**Escopo:** somente migrations/schema versionados localmente. Não houve chamada remota, nem mutação.

### Relações FK confirmadas

| Parent | Child | FK | ON DELETE | Impacto documentado |
|---|---|---|---|---|
| `applications` | `application_site_records` | `(application_id, user_id) → applications(id, user_id)` | CASCADE | Excluir a aplicação apagaria o local corporal dela. |
| `applications` | `application_effect_notes` | `(application_id, user_id) → applications(id, user_id)` | CASCADE | Excluir a aplicação apagaria suas anotações de efeitos. |
| `applications` | `vial_usages` | `(application_id, user_id) → applications(id, user_id)` | CASCADE | Excluir a aplicação apagaria a retirada vinculada do frasco. |
| `applications` | `scheduled_applications` | `(completed_application_id, user_id) → applications(id, user_id)` | RESTRICT | Uma aplicação concluída vinculada não pode ser removida enquanto a ocorrência existir. |
| `application_plans` | `scheduled_applications` | `(plan_id, user_id) → application_plans(id, user_id)` | RESTRICT | Um plano não pode ser removido enquanto houver ocorrências. |
| `scheduled_applications` | `application_site_records` | `(scheduled_application_id, user_id) → scheduled_applications(id, user_id)` | CASCADE | Excluir uma ocorrência apagaria seu local corporal associado. |
| `medication_vials` | `vial_usages` | `(vial_id, user_id) → medication_vials(id, user_id)` | RESTRICT | Um frasco não pode ser removido enquanto houver retiradas. |
| `auth.users` | `onboarding_profiles` | `user_id → auth.users(id)` | CASCADE | Não relevante: a conta Auth não será removida. |
| `auth.users` | `user_consents` | `user_id → auth.users(id)` | CASCADE | Não relevante: a conta Auth não será removida. |

### Pontos não confirmados localmente

- A DDL/policy canônica de `applications`, `weight_records`, `user_settings` e `profiles` não existe no repositório. Há uso no cliente e em testes, mas não há evidência local suficiente para declarar FK ou `ON DELETE` dessas tabelas.
- `onboarding_profiles.initial_weight_record_id` é somente `uuid` na migration local; não há FK local confirmada para `weight_records`.
- `weight_records.application_id` é usado pelo Diário e pela RPC proposta, mas a FK e o comportamento de exclusão não estão confirmados no schema local.

### scheduled_applications

- Possui `completed_application_id` opcional, FK composta para `applications` com `ON DELETE RESTRICT` e check: apenas status `completed` pode possuir esse campo preenchido.
- Não há referência de `applications` para `scheduled_applications`; o vínculo é de ocorrência concluída para aplicação, não o inverso.
- Pode existir sem aplicação concluída (status diferente de `completed`).
- Possui ownership direto `user_id`; a policy local permite `DELETE` próprio somente com `status <> 'completed'`.
- Portanto, uma ocorrência existente sem sua classificação por status/vínculo é insuficiente para planejar exclusão segura; ocorrências concluídas exigem estratégia diferente e não podem ser apagadas pela sessão normal segundo a policy local.

### Ownership e RLS confirmados localmente

| Tabela | Ownership | Sessão normal do titular pode apagar? |
|---|---|---|
| `application_site_records` | `user_id` direto | Sim; policy `user_id = auth.uid()`. |
| `application_effect_notes` | `user_id` direto | Sim; policy `user_id = auth.uid()`. |
| `vial_usages` | `user_id` direto | Sim; policy `user_id = auth.uid()`, mas não foi autorizado no escopo inicial. |
| `scheduled_applications` | `user_id` direto | Apenas se próprio e `status <> 'completed'`. |
| `application_plans` | `user_id` direto | Sim; policy `auth.uid() = user_id`, mas não foi autorizado no escopo inicial. |
| `onboarding_profiles` | `user_id` direto | Sim; policy `user_id = auth.uid()`. |
| `user_consents` | `user_id` direto | Sim; policy `user_id = auth.uid()`. |
| `applications`, `weight_records` | `user_id` usado no cliente/testes | NÃO CONFIRMADO localmente; DDL/policy canônica ausente. |

### Ordem condicional que seria segura após confirmação adicional

1. Classificar as ocorrências existentes por status e por `completed_application_id` (leitura remota específica, ainda não feita nesta análise).
2. Para ocorrências não concluídas: remover explicitamente `application_site_records` de origem agendada, depois as ocorrências, depois o plano — somente sob autorização ampliada.
3. Para ocorrências concluídas: **não excluir** sem uma estratégia autorizada que preserve ou desfaça o vínculo `completed_application_id`; a policy local impede apagar a ocorrência concluída.
4. Remover explicitamente filhos de aplicações (`application_site_records`, `application_effect_notes`, `vial_usages`) somente se autorizados e após ownership confirmado.
5. Remover aplicações quando nenhuma ocorrência concluída as referenciar; confirmar antes a semântica local de `weight_records.application_id`.
6. Remover `weight_records`, `onboarding_profiles` e `user_consents` do titular, por filtros de chave/ownership específicos.

**Decisão:** **NO-GO — DEPENDÊNCIAS AINDA NÃO RESOLVIDAS**. A limpeza não deve iniciar até haver autorização explícita para o escopo adicional e confirmação do estado das ocorrências/DDL ausente.

### Preflight após limpeza parcial declarada

- O novo preflight somente-leitura confirmou que `applications`, `application_effect_notes` e `vial_usages` de USER A estão vazios.
- Permanecem dados preexistentes de USER A em `weight_records`, `onboarding_profiles`, `user_consents`, `application_site_records`, `application_plans` e `scheduled_applications`.
- USER B continua vazio nas áreas consultadas; profiles de ambas as contas permanecem como exceção estrutural do Auth.
- Decisão: **NO-GO — CONTA QA CONTÉM DADOS PREEXISTENTES**. Nenhuma mutação foi executada.

### Exclusão autorizada de USER A

- A conta descartável USER A foi excluída permanentemente após confirmação explícita, pela função publicada `delete-account` e sessão normal do titular; o endpoint confirmou sucesso.
- A autenticação posterior de USER A falhou como esperado, confirmando a exclusão. USER B não foi acessado nem alterado.
- Não houve alteração de migration, schema, policy, RLS, trigger, deploy, commit ou push.

### Preflight REM-001 após recriação de USER A

- Guards de produção controlada, autenticação A/B, identidades distintas, destino/ref e credencial Publishable: aprovados.
- USER A e USER B estão vazios em todas as áreas consultadas: aplicações, pesos, configurações, onboarding, consentimentos, locais, efeitos, retiradas de frasco, planos e ocorrências. `profiles` permanece apenas como exceção estrutural de Auth.
- Decisão: **GO — REM-001 PODE SER EXECUTADO**. Nenhuma mutação da matriz RLS foi iniciada nesta etapa.
