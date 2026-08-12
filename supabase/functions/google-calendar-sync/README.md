# google-calendar-sync

Edge Function autenticada que sincroniza uma única ocorrência futura de `public.scheduled_applications` com o Google Agenda.

## Contrato V1

- Métodos: `POST` e `OPTIONS`.
- JWT: obrigatório (`verify_jwt = true`) e novamente validado por `auth.getUser(jwt)`.
- Corpo aceito, sem campos adicionais:

```json
{
  "occurrence_id": "00000000-0000-4000-8000-000000000000"
}
```

Resposta de sucesso:

```json
{
  "success": true,
  "occurrence_id": "00000000-0000-4000-8000-000000000000",
  "sync_status": "synced"
}
```

## Segurança e ownership

O `user_id` vem exclusivamente do JWT. A ocorrência e seu plano são carregados por `occurrence_id` e pelo mesmo usuário autenticado. Registro ausente ou pertencente a outro usuário retorna o mesmo `404 NOT_FOUND`.

A credencial é lida do schema `private`, descriptografada em memória com AES-256-GCM e usada para obter um access token de curta duração. Refresh token, access token, segredo do cliente e respostas brutas do Google não são devolvidos nem registrados.

## Idempotência

O ID do evento é `dc` seguido do SHA-256 do UUID da ocorrência codificado em base32hex minúsculo. A primeira sincronização tenta `events.insert`. Um conflito `409` atualiza o mesmo evento com `events.update`, evitando duplicidade em retries.

Depois que o Google confirma a operação, uma finalização local atômica sempre tenta preservar `google_calendar_id` e `google_event_id`. Ela consulta o status atual na própria atualização: se ainda for `scheduled`, conclui como `synced`; se tiver mudado durante a chamada, preserva os IDs, mantém o novo status e grava `google_sync_status = error` com a categoria pública `OCCURRENCE_CHANGED_DURING_SYNC`.

Uma falha da persistência pós-Google é distinguida de falha externa por `POST_GOOGLE_PERSISTENCE_FAILED`. Como o ID remoto é determinístico, o retry reencontra e atualiza o mesmo evento. A atualização de `last_sync_at` acontece somente após a ocorrência ser confirmada como `synced` e é best-effort: sua falha gera apenas telemetria sanitizada e não converte o sucesso principal em erro.

## Estados V1

- Somente ocorrências com `status = scheduled` podem ser sincronizadas.
- Sem conexão válida: `google_sync_status = not_connected`.
- Durante a chamada externa: `pending`.
- Sucesso confirmado no banco: `synced`.
- Erro de credencial, payload, lembrete, token ou Google: `error`.

Nesta etapa, `completed`, `cancelled` e `missed` retornam `UNSUPPORTED_OCCURRENCE_STATUS` sem alterar o registro e sem chamar o Google.

## Variáveis server-side

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` ou `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_DB_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY` (Base64 de 32 bytes)

## Limites deliberados

Não há sincronização automática pelo frontend, sincronização de plano inteiro, exclusão/cancelamento no Google ou tratamento externo de ocorrências concluídas nesta versão.
