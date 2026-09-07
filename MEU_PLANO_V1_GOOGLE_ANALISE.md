# Meu Plano V1 — Etapa 5 — arquitetura Google Agenda / OAuth

Status: **PROPOSTA — NÃO IMPLEMENTADA**
Data: 2026-08-09

## 1. Conclusão executiva

Arquitetura recomendada:

```text
Browser autenticado no Dose Certa
        ↓ JWT Supabase
Supabase Edge Functions
        ↓ OAuth 2.0 / HTTPS
Google Authorization Server + Calendar API
        ↓ metadata de sincronização
PostgreSQL/Supabase
```

O Google OAuth é uma autorização separada do Supabase Auth. O browser nunca recebe `client_secret` ou `refresh_token` Google e não grava tokens Google em localStorage/sessionStorage.

Recomenda-se três funções separadas:

1. `google-oauth-start`: autenticada pelo JWT Supabase; cria state e PKCE e devolve a URL de autorização.
2. `google-oauth-callback`: endpoint chamado pelo Google; valida state/PKCE, troca code por tokens e conclui a conexão.
3. `google-calendar-sync`: autenticada pelo JWT Supabase para ações do usuário e, futuramente, por segredo interno dedicado para jobs; cria, atualiza, cancela e reconcilia eventos.

A separação reduz o risco de configurar o callback público com a mesma política das rotas autenticadas. Uma única função com rotas internas seria possível, mas misturaria perfis de autenticação e aumentaria a chance de erro.

## 2. Estado atual do projeto

- Frontend estático publicado a partir de `public/`; `scripts/build.mjs` impede a publicação de padrões privilegiados.
- `window.supabaseClient` usa URL e Publishable Key públicas, com sessão Supabase persistida.
- `application_plans` é a regra local e `scheduled_applications` contém as ocorrências.
- A fonte de verdade continua sendo o banco local; Google é somente um canal externo de lembrete.
- `scheduled_applications` já possui `google_calendar_id`, `google_event_id` e `google_sync_status` (`not_connected`, `pending`, `synced`, `error`).
- A confirmação de aplicação é transacional e mantém `scheduled_date` como data planejada.
- Não existem Edge Functions, Supabase CLI ou dependências Google no projeto atual.

## 3. Google Cloud

Configuração futura:

1. Criar projeto Google Cloud dedicado por ambiente ou, no mínimo, credenciais OAuth separadas para desenvolvimento e produção.
2. Habilitar Google Calendar API.
3. Configurar OAuth consent screen, nome, suporte, domínio e política de privacidade.
4. Criar OAuth Client ID do tipo **Web application**.
5. Registrar redirect URIs exatas, sem curingas:
   - local: URL da Edge Function local/callback;
   - produção: `https://<project-ref>.supabase.co/functions/v1/google-oauth-callback` ou domínio customizado equivalente.
6. Enquanto o consent screen estiver em Testing, cadastrar apenas contas QA como test users.
7. Antes de produção pública, avaliar a verificação exigida pelo Google para o scope de Calendar.

O Google alerta que projetos externos em status Testing podem emitir refresh tokens com duração limitada; isso precisa entrar nos testes de reconexão. Referência: [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2).

## 4. Scopes

### Recomendado

```text
openid
email
https://www.googleapis.com/auth/calendar.events.owned
```

- `calendar.events.owned`: cria, consulta, altera e exclui eventos em calendários pertencentes ao usuário; é mais estreito do que `calendar` e `calendar.events`.
- `openid email`: obtém identificador estável e e-mail para mostrar a conta conectada de forma mascarada. Se a UI aceitar não exibir conta, esses dois scopes podem ser removidos.

Não solicitar `calendar`, `calendar.readonly`, `calendarlist` ou leitura ampla nesta V1. Usar o calendário primário (`calendarId = primary`) e validar em QA que o scope owned cobre todo o fluxo. Referência: [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

Impacto: o scope de Calendar acessa dados do usuário e pode exigir verificação para publicação. O consentimento deve explicar que o app cria e mantém apenas lembretes originados no Meu Plano.

## 5. OAuth flow, state e PKCE

### Start

1. Browser invoca `google-oauth-start` com JWT Supabase.
2. Function valida JWT e deriva `user_id`; não aceita user_id como autoridade do body.
3. Gera:
   - state aleatório criptograficamente forte (mínimo 256 bits);
   - hash SHA-256 do state para persistência;
   - PKCE `code_verifier` e `code_challenge` S256;
   - expiração curta, por exemplo 10 minutos.
4. Persiste state hash, user_id, verifier protegido, redirect pós-callback e `used_at = NULL` em schema privado.
5. Retorna somente a authorization URL.

Parâmetros Google:

```text
response_type=code
access_type=offline
include_granted_scopes=true
prompt=consent apenas quando necessário obter/reobter refresh_token
state=<valor opaco>
code_challenge=<S256>
code_challenge_method=S256
```

### Callback

1. Google chama o callback com `code` e `state`.
2. A function calcula o hash do state e localiza uma linha não expirada/não usada.
3. Bloqueia e marca o state como usado atomicamente para impedir replay.
4. Troca code usando client ID, client secret server-side, redirect URI exata e code verifier.
5. Associa a conexão ao `user_id` guardado no state, nunca a um user_id da URL.
6. Preserva refresh token anterior se uma autorização posterior não devolver um novo.
7. Redireciona para uma allowlist fixa do app, nunca para URL arbitrária recebida do cliente.

### PKCE

Recomendação: **SIM**, S256, mesmo usando cliente web confidencial. O client secret continua protegido na Edge Function e PKCE adiciona defesa contra interceptação do authorization code. O verifier fica somente no registro privado de state. State continua obrigatório e separado: PKCE não substitui proteção CSRF. Referências: [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) e [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## 6. Tokens

### Não armazenar no browser

- client secret;
- authorization code;
- access token;
- refresh token;
- chave de criptografia.

### Estratégia recomendada

- Não persistir access token: obtê-lo com refresh token durante a function e mantê-lo apenas em memória até terminar a chamada.
- Persistir refresh token criptografado em tabela de schema `private`, sem grants ao browser.
- Criptografar com AES-256-GCM (nonce único, authentication tag e key version), usando chave configurada em Supabase Edge Function Secrets.
- Rotacionar chave por `key_version`; desenhar job de recriptografia antes da rotação.
- Guardar `expires_at`, `scope` e `token_type` apenas se úteis; access token expirado não precisa ser persistido.
- Nunca retornar refresh token ao frontend ou incluí-lo em logs/exceptions.

Supabase project secrets são adequados para client secret e chave mestra, mas não para milhares de tokens dinâmicos por usuário. Supabase Vault pode ser usado como mecanismo de criptografia, desde que `vault.decrypted_secrets` nunca seja exposto por PostgREST/RLS e somente uma rotina server-side controlada faça a leitura. Para esta arquitetura, tabela privada + criptografia na Edge Function dá modelo explícito e auditável. Referência: [Supabase Edge Functions](https://supabase.com/docs/guides/functions).

## 7. Modelo de dados

### `public.google_calendar_connections`

Somente metadata segura:

- `id`, `user_id`;
- `google_subject_hash` ou identificador opaco;
- `google_account_hint` já mascarado;
- `calendar_id` (`primary` na V1);
- `granted_scopes`;
- `connection_status`: connected, expired, revoked, disconnected, error;
- `last_sync_at`, `last_error_code` sanitizado;
- timestamps.

RLS permite apenas SELECT próprio. Browser não recebe INSERT/UPDATE/DELETE; mutações são feitas pelas Edge Functions após validar JWT/state.

### `private.google_calendar_credentials`

- `connection_id`, `user_id`;
- refresh token ciphertext, nonce e key version;
- token type e timestamps.

Sem grants para `anon` ou `authenticated`; não exposta no schema público da API. A migration não fixa antecipadamente se as Edge Functions usarão cliente administrativo, RPC protegida ou conexão PostgreSQL: essa escolha será validada na implementação server-side. Qualquer opção deverá manter o schema e os tokens inacessíveis ao browser.

### `private.google_oauth_states`

- hash do state, user_id, verifier protegido;
- redirect target enumerado;
- expires_at, used_at e created_at.

Sem RLS/browser access. Estados expirados devem ser removidos periodicamente.

Os três campos já existentes em `scheduled_applications` são suficientes para o vínculo V1. Um índice de fila em `google_sync_status` e `updated_at` só deverá ser adicionado quando o padrão real de sincronização ou job demonstrar essa necessidade; a migration de conexão não altera essa tabela.

## 8. Edge Functions e autenticação

### `google-oauth-start`

- `verify_jwt = true`;
- requer JWT de usuário Supabase;
- deriva user ID do JWT;
- rate limit por usuário/IP;
- somente gera state/PKCE/URL.

### `google-oauth-callback`

- callback externo não terá JWT Supabase; `verify_jwt = false`;
- a autenticação da operação é o state forte, de uso único, previamente associado ao usuário autenticado;
- aceita apenas GET, parâmetros esperados e redirect URI fixa;
- usa credenciais administrativas somente para state/credenciais/metadata após validação completa.

### `google-calendar-sync`

- chamadas do browser: `verify_jwt = true`, usuário derivado do JWT;
- consulta occurrence por UUID + usuário;
- para jobs futuros: segredo interno separado, sem confiar em user_id isolado;
- o mecanismo de acesso server-side às tabelas privadas será escolhido na implementação entre cliente administrativo, RPC protegida ou conexão PostgreSQL. Em qualquer opção, capacidade administrativa nunca substitui a validação de ownership: o handler primeiro valida JWT/state, fixa user_id e restringe todos os comandos por esse ID.

Supabase recomenda JWT de usuário em `Authorization` e Publishable Key em `apikey` para functions chamadas pelo cliente. Referências: [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth) e [Authorization headers](https://supabase.com/docs/guides/functions/auth-headers).

## 9. Sincronização V1 — unidirecional

```text
Meu Plano (fonte de verdade) → Google Agenda
```

Sem importação, webhooks, syncToken ou reconciliação Google→Meu Plano.

### Estados

| Origem | Evento | Próximo estado |
|---|---|---|
| sem conexão | occurrence criada | `not_connected` |
| conectado | criar/editar/cancelar local | `pending` |
| Google success | ID/calendário persistidos | `synced` |
| Google/rede/token error | dado local preservado | `error` |
| reconectar/retry | nova tentativa | `pending → synced/error` |

As transições para pending e a alteração local devem ser gravadas antes da chamada externa. Falha Google nunca desfaz uma criação, edição, cancelamento ou confirmação local.

## 10. Mapeamento de evento

```json
{
  "summary": "Aplicação — {medicine} {dose} mg",
  "description": "Lembrete criado pelo Dose Certa a partir do Meu Plano.",
  "start": {
    "dateTime": "{scheduled_date}T{scheduled_time}",
    "timeZone": "{timezone}"
  },
  "end": {
    "dateTime": "{start + 15 minutos}",
    "timeZone": "{timezone}"
  },
  "reminders": {
    "useDefault": false,
    "overrides": [
      { "method": "popup", "minutes": 1440 },
      { "method": "popup", "minutes": 120 },
      { "method": "popup", "minutes": 0 }
    ]
  }
}
```

Evitar peso, apresentação do frasco, UI calculada, observações livres e informação clínica adicional. A API aceita até 5 overrides e minutos entre 0 e 40320, portanto 1440/120/0 são válidos. Fallback: filtrar valores fora do intervalo, registrar erro sanitizado e usar os overrides válidos; nunca bloquear o agendamento local. Referência: [Events: insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## 11. Create, update, cancel e completed

### Create

1. Commit local da occurrence.
2. Se conectado, marcar `pending`.
3. Invocar sync.
4. `events.insert` com ID determinístico.
5. Success: salvar calendar ID/event ID e `synced`; failure: `error`.

### Update

1. Salvar data/horário/lembretes localmente.
2. Marcar pending.
3. `events.patch` usando calendar ID/event ID.
4. 404 remoto: tentar create reconciliado com ID determinístico; demais falhas: error.

### Cancel

1. Atualizar status local para cancelled.
2. Se houver event ID, marcar pending e chamar `events.delete`.
3. 404 significa estado remoto já ausente e pode ser tratado como sucesso idempotente.
4. Falha não reverte cancelamento local; status sync vira error.

### Completed

Recomendação: **Opção B**, manter o evento como histórico e alterar o título para `Aplicação realizada`, removendo lembretes ainda futuros. Isso reduz exposição de medicamento/dose no histórico e evita alertas após confirmação antecipada. Falha desse patch nunca reverte a confirmação local.

## 12. Idempotência

- Derivar Google event ID determinístico do UUID da occurrence usando SHA-256 + base32hex compatível com o formato aceito pelo Google.
- Nunca usar UUID bruto sem conversão, pois o formato de IDs Google possui conjunto de caracteres específico.
- Persistir o ID determinístico antes/ao marcar pending.
- `events.insert`:
  - success: synced;
  - conflito/timeout: executar `events.get` pelo ID determinístico;
  - encontrado: reconciliar como success;
  - ausente: repetir com backoff.
- Usar lock/claim local por occurrence e ignorar chamadas simultâneas quando já houver operação em andamento.
- Update/delete sempre usam o ID persistido.

O Google recomenda IDs próprios para reduzir duplicidade quando a resposta se perde após a criação. Referência: [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events).

## 13. UX mobile-first

Estado desconectado:

```text
Google Agenda
Não conectado
[Conectar]
```

Estado conectado:

```text
Google Agenda
ar***@gmail.com
Sincronização ativa
[Desconectar]
```

Erro:

```text
Não foi possível sincronizar algumas aplicações.
[Tentar novamente]
```

Google é um card secundário de integração, não o CTA principal. Meu Plano funciona integralmente desconectado.

## 14. Desconexão

1. Confirmar a decisão em modal.
2. Explicar que os eventos já criados permanecerão por padrão.
3. Opcionalmente oferecer, com consentimento explícito, remover eventos futuros criados pelo app antes de revogar.
4. Chamar o endpoint de revogação Google quando houver token.
5. Apagar credencial privada irrecuperável.
6. Manter metadata mínima como disconnected e IDs históricos nas occurrences para auditoria/reconexão.
7. Nunca prometer remoção dos eventos se a revogação aconteceu antes da limpeza remota.

## 15. Erros e UX

| Erro | Estado local | UX |
|---|---|---|
| consent denied | intacto | “Conexão cancelada.” |
| refresh revoked/invalid_grant | intacto, connection expired | “Reconecte o Google Agenda.” |
| Google indisponível/5xx | sync error | “Tentaremos novamente.” |
| quota/rate limit | sync error + retry_after | “Sincronização temporariamente indisponível.” |
| evento inválido | sync error sem loop infinito | “Revise data e horário.” |
| 404 em update/delete | reconciliar create ou considerar delete concluído | sem corromper local |

Retry automático somente para falhas transitórias (429/5xx/network), com exponential backoff e jitter. Erros permanentes exigem reconexão ou correção de dados.

## 16. Observabilidade

Logar somente:

- timestamp/correlation ID;
- user UUID quando necessário;
- operation (`oauth_start`, `oauth_callback`, `create`, `patch`, `delete`, `refresh`);
- scheduled_application_id;
- HTTP status/código Google sanitizado;
- resultado e duração.

Nunca logar token, code, client secret, state bruto, verifier, payload Authorization, e-mail completo ou descrição do evento.

## 17. Riscos

- refresh token ausente em reconexão: preservar o anterior até troca confirmada;
- refresh tokens limitados/expirados em consent screen Testing;
- vazamento por logs ou tabela pública;
- callback/replay sem state de uso único;
- concorrência criando evento duplicado;
- timezone inválida/DST;
- quota e indisponibilidade Google;
- uso interno incorreto de service role sem fixar ownership;
- desconexão deixando eventos órfãos;
- scope exigir verificação antes do lançamento público.

## 18. Ordem de implementação

1. Configurar Google Cloud e ambientes.
2. Revisar/aplicar migration de conexão privada e metadata.
3. Implementar testes de criptografia/rotação.
4. Implementar OAuth start.
5. Implementar callback + state + PKCE.
6. Implementar connect/disconnect UX.
7. Implementar create event idempotente.
8. Implementar update.
9. Implementar cancel.
10. Implementar retry manual e automático.
11. Implementar comportamento completed.
12. QA local/testing users, RLS, CSRF/replay, concorrência, token revogado e quota.
13. Revisão de consentimento/verificação.
14. Produção gradual com observabilidade.

## 19. Resultado final

- Arquitetura: browser → Edge Functions → Google, com PostgreSQL como fonte de verdade.
- OAuth: authorization code web-server, offline access, state de uso único e callback separado.
- Scope: `calendar.events.owned` + `openid email` opcional para identificação da conta.
- Tokens: refresh token criptografado server-side; access token somente em memória.
- State: hash persistido em schema privado, TTL curto, consumo atômico e proteção contra replay.
- PKCE: SIM, S256.
- Modelo: metadata pública segura + credenciais/state em schema privado.
- Edge Functions: start, callback e sync separadas.
- Sync V1: unidirecional Meu Plano → Google Agenda.
- Completed: manter histórico, título genérico e sem lembretes futuros.
- Próximo passo: revisar a migration proposta e validar capacidades do Google Client em ambiente Testing antes de escrever Edge Functions.
