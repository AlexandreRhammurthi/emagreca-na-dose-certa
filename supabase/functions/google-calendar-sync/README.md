# google-calendar-sync

Edge Function autenticada que sincroniza o ciclo de vida de uma única ocorrência de `public.scheduled_applications` com o Google Agenda.

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

## Matriz de ciclo de vida

| Status local | Estado remoto desejado | Operação |
|---|---|---|
| `scheduled` | Evento ativo, título “Aplicação”, 15 minutos e reminders da ocorrência | CREATE; retry 409 faz UPDATE canônico |
| `completed` | Evento histórico “Aplicação realizada”, no horário planejado e sem reminders | PATCH controlado; se ausente, CREATE; conflito faz PATCH |
| `missed` | Evento histórico “Aplicação não realizada”, no horário planejado e sem reminders | PATCH controlado; se ausente, CREATE; conflito faz PATCH |
| `cancelled` | Evento ausente | DELETE; 404/410 são sucesso idempotente |

Completed e missed enviam somente `summary`, `start`, `end` e `reminders`, preservando no Google propriedades externas como descrição, localização e cor. Nenhum status envia notes, peso, volume, UI, seringa ou IDs clínicos. Cancelled nunca limpa os IDs locais de auditoria.

`google_sync_status = synced` significa que o estado remoto está alinhado ao estado local. Para `cancelled`, isso significa que o evento remoto não existe.

## Identidade e idempotência

O ID do evento é `dc` seguido do SHA-256 do UUID da ocorrência codificado em base32hex minúsculo. A primeira sincronização tenta `events.insert`. Um conflito `409` atualiza o mesmo evento com `events.update`, evitando duplicidade em retries.

Se houver `google_event_id` persistido diferente do valor determinístico, a função bloqueia antes do Google com `GOOGLE_EVENT_ID_MISMATCH`, marca o sync como `error` e não substitui o ID silenciosamente.

Depois que o Google confirma a operação, uma finalização local atômica sempre preserva `google_calendar_id` e `google_event_id`. Ela compara o status atual ao status esperado na própria atualização: se forem iguais, conclui como `synced`; se tiver mudado durante a chamada, preserva os IDs e o novo status, grava `google_sync_status = error` e responde `OCCURRENCE_CHANGED_DURING_SYNC`.

Uma falha da persistência pós-Google é distinguida de falha externa por `POST_GOOGLE_PERSISTENCE_FAILED`. Como o ID remoto é determinístico, o retry reencontra e atualiza o mesmo evento. A atualização de `last_sync_at` acontece somente após a ocorrência ser confirmada como `synced` e é best-effort: sua falha gera apenas telemetria sanitizada e não converte o sucesso principal em erro.

## Estados de sincronização

- Sem conexão válida: `google_sync_status = not_connected`.
- Durante a chamada externa: `pending`.
- Estado remoto alinhado e confirmado no banco: `synced`.
- Erro de credencial, payload, lembrete, token ou Google: `error`.

O `pending` usa `occurrence_id + user_id + status esperado`; uma requisição antiga não marca uma ocorrência cujo status já mudou. A finalização nunca altera o status clínico.

## Variáveis server-side

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` ou `SUPABASE_PUBLISHABLE_KEYS`
- `SUPABASE_DB_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY` (Base64 de 32 bytes)

## Limites deliberados

Não há integração automática com o frontend, sincronização de plano inteiro, trigger, cron ou job em background nesta versão. A função só age quando chamada explicitamente para uma ocorrência.
