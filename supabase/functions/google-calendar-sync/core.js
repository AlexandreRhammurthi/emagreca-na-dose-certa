const GOOGLE_REMINDER_MAX = 40320;
const GOOGLE_REMINDER_COUNT_MAX = 5;
const EVENT_DURATION_MINUTES = 15;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE32HEX_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

export const ALLOWED_ORIGINS = Object.freeze(new Set([
  'http://localhost:8000',
  'https://emagrecanadosecerta.com.br',
  'https://emagreca-na-dose-certa.arbandeira.workers.dev'
]));

export class SyncError extends Error {
  constructor(code, status, message, category = code.toLowerCase()) {
    super(message);
    this.code = code;
    this.status = status;
    this.category = category;
  }
}

function base32Hex(bytes) {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32HEX_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32HEX_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

export async function deterministicEventId(occurrenceId) {
  if (!UUID_PATTERN.test(String(occurrenceId || ''))) throw new Error('invalid_occurrence_id');
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(occurrenceId.toLowerCase())
  ));
  return `dc${base32Hex(digest)}`;
}

function validCivilDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function validCivilTime(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/u.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  return hour <= 23 && minute <= 59 && second <= 59 ? { hour, minute, second } : null;
}

export function addMinutesCivil(dateValue, timeValue, minutes) {
  const date = validCivilDate(dateValue);
  const time = validCivilTime(timeValue);
  if (!date || !time || !Number.isInteger(minutes) || minutes < 0) throw new Error('invalid_civil_datetime');
  const instant = new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second));
  instant.setUTCMinutes(instant.getUTCMinutes() + minutes);
  const datePart = `${instant.getUTCFullYear()}-${String(instant.getUTCMonth() + 1).padStart(2, '0')}-${String(instant.getUTCDate()).padStart(2, '0')}`;
  const timePart = `${String(instant.getUTCHours()).padStart(2, '0')}:${String(instant.getUTCMinutes()).padStart(2, '0')}:${String(instant.getUTCSeconds()).padStart(2, '0')}`;
  return { date: datePart, time: timePart, dateTime: `${datePart}T${timePart}` };
}

export function googleReminders(values) {
  if (!Array.isArray(values) || values.length > GOOGLE_REMINDER_COUNT_MAX) {
    throw new SyncError('INVALID_GOOGLE_REMINDER', 422, 'Os lembretes desta aplicação não são compatíveis com o Google Agenda.', 'invalid_google_reminder');
  }
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > GOOGLE_REMINDER_MAX)) {
    throw new SyncError('INVALID_GOOGLE_REMINDER', 422, 'Os lembretes desta aplicação não são compatíveis com o Google Agenda.', 'invalid_google_reminder');
  }
  return values.map((minutes) => ({ method: 'popup', minutes }));
}

function formatDose(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('invalid_dose');
  return numeric.toLocaleString('pt-BR', { maximumFractionDigits: 6, useGrouping: false });
}

export function buildGoogleEvent(occurrence) {
  if (!occurrence?.medicine || !String(occurrence.medicine).trim()) throw new Error('invalid_medicine');
  if (!/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/u.test(String(occurrence.timezone || ''))) {
    throw new Error('invalid_timezone');
  }
  const start = addMinutesCivil(occurrence.scheduledDate, occurrence.scheduledTime, 0);
  const end = addMinutesCivil(occurrence.scheduledDate, occurrence.scheduledTime, EVENT_DURATION_MINUTES);
  const summaries = {
    scheduled: 'Aplicação',
    completed: 'Aplicação realizada',
    missed: 'Aplicação não realizada'
  };
  const summaryPrefix = summaries[occurrence.status];
  if (!summaryPrefix) throw new Error('invalid_event_status');
  const reminders = occurrence.status === 'scheduled'
    ? googleReminders(occurrence.reminderMinutes)
    : [];
  return {
    summary: `${summaryPrefix} — ${String(occurrence.medicine).trim()} ${formatDose(occurrence.doseMg)} mg`,
    start: { dateTime: start.dateTime, timeZone: occurrence.timezone },
    end: { dateTime: end.dateTime, timeZone: occurrence.timezone },
    reminders: { useDefault: false, overrides: reminders }
  };
}

function decodeBase64(value) {
  const normalized = String(value || '').trim().replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function decryptRefreshToken(credential, encodedKey) {
  if (credential?.encryptionKeyVersion !== 1) throw new Error('unsupported_encryption_key_version');
  if (!(credential?.nonce instanceof Uint8Array) || credential.nonce.byteLength !== 12) throw new Error('invalid_refresh_token_nonce');
  let keyBytes;
  try {
    keyBytes = decodeBase64(encodedKey);
  } catch {
    throw new Error('invalid_encryption_key');
  }
  if (keyBytes.byteLength !== 32) throw new Error('invalid_encryption_key');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: credential.nonce },
      key,
      credential.ciphertext
    );
    const refreshToken = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (!refreshToken) throw new Error('empty_refresh_token');
    return refreshToken;
  } catch (error) {
    if (error instanceof Error && error.message === 'empty_refresh_token') throw error;
    throw new Error('refresh_token_decryption_failed');
  }
}

export async function requestGoogleAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  fetchImpl = fetch
}) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A resposta bruta do Google nunca é registrada ou devolvida.
  }

  if (!response.ok) {
    const error = new Error(payload?.error === 'invalid_grant'
      ? 'google_reconnection_required'
      : 'google_token_refresh_failed');
    error.category = error.message;
    error.httpStatus = response.status;
    throw error;
  }
  if (typeof payload?.access_token !== 'string' || !payload.access_token) {
    const error = new Error('google_token_refresh_failed');
    error.category = error.message;
    error.httpStatus = response.status;
    throw error;
  }
  return payload.access_token;
}

export async function upsertGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventId,
  event,
  fetchImpl = fetch
}) {
  const calendarPath = encodeURIComponent(calendarId);
  const collectionUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarPath}/events`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8'
  };
  const insertResponse = await fetchImpl(collectionUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: eventId, ...event })
  });
  if (insertResponse.ok) return 'created';

  if (insertResponse.status === 409) {
    const updateResponse = await fetchImpl(`${collectionUrl}/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(event)
    });
    if (updateResponse.ok) return 'updated';
    const error = new Error('google_calendar_request_failed');
    error.category = error.message;
    error.httpStatus = updateResponse.status;
    throw error;
  }

  const error = new Error('google_calendar_request_failed');
  error.category = error.message;
  error.httpStatus = insertResponse.status;
  throw error;
}

function googleCalendarRequestError(status) {
  const error = new Error('google_calendar_request_failed');
  error.category = error.message;
  error.httpStatus = status;
  return error;
}

export async function syncTerminalGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventId,
  event,
  eventWasPersisted,
  fetchImpl = fetch
}) {
  const collectionUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const itemUrl = `${collectionUrl}/${encodeURIComponent(eventId)}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8'
  };
  const patchExisting = async () => fetchImpl(itemUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(event)
  });
  const create = async () => fetchImpl(collectionUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: eventId, ...event })
  });

  if (eventWasPersisted) {
    const patchResponse = await patchExisting();
    if (patchResponse.ok) return 'patched';
    if (patchResponse.status !== 404 && patchResponse.status !== 410) {
      throw googleCalendarRequestError(patchResponse.status);
    }
  }

  const createResponse = await create();
  if (createResponse.ok) return 'created';
  if (createResponse.status === 409) {
    const patchResponse = await patchExisting();
    if (patchResponse.ok) return 'patched';
    throw googleCalendarRequestError(patchResponse.status);
  }
  throw googleCalendarRequestError(createResponse.status);
}

export async function deleteGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventId,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (response.ok) return 'deleted';
  if (response.status === 404 || response.status === 410) return 'already_absent';
  throw googleCalendarRequestError(response.status);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function bearerToken(request) {
  const match = /^Bearer\s+([^\s]+)$/iu.exec(request.headers.get('Authorization') || '');
  return match?.[1] || null;
}

async function occurrenceIdFromRequest(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new SyncError('INVALID_REQUEST', 400, 'Informe uma aplicação agendada válida.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SyncError('INVALID_REQUEST', 400, 'Informe uma aplicação agendada válida.');
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'occurrence_id' || !UUID_PATTERN.test(String(payload.occurrence_id || ''))) {
    throw new SyncError('INVALID_REQUEST', 400, 'Informe uma aplicação agendada válida.');
  }
  return payload.occurrence_id.toLowerCase();
}

function safeCategory(error) {
  const allowed = new Set([
    'invalid_request', 'not_found', 'unsupported_occurrence_status', 'google_connection_required',
    'google_credential_unavailable', 'invalid_google_reminder', 'invalid_encryption_key',
    'unsupported_encryption_key_version', 'invalid_refresh_token_nonce', 'refresh_token_decryption_failed',
    'empty_refresh_token', 'google_reconnection_required', 'google_token_refresh_failed',
    'google_calendar_request_failed', 'invalid_event_data', 'schema_mismatch', 'missing_configuration',
    'sync_persistence_failed', 'post_google_persistence_failed', 'occurrence_changed_during_sync',
    'google_event_id_mismatch',
    'connection_sync_metadata_failed'
  ]);
  const candidate = error?.category || error?.message || '';
  return allowed.has(candidate) ? candidate : 'internal_error';
}

function googleStatus(error) {
  const status = Number(error?.httpStatus);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function createCalendarSyncHandler(dependencies) {
  const {
    authenticate,
    validateSchema,
    loadOccurrence,
    loadConnection,
    loadCredential,
    setOccurrenceSync,
    finalizeOccurrenceSync,
    expireConnection,
    markConnectionSynced,
    refreshAccessToken,
    upsertGoogleEvent,
    syncTerminalGoogleEvent,
    deleteGoogleEvent,
    getEnv,
    logger = console
  } = dependencies;

  return async function handleCalendarSync(request) {
    const correlationId = crypto.randomUUID();
    const origin = request.headers.get('Origin');
    let userId = null;
    let occurrenceId = null;
    let occurrenceStatus = null;
    let googleOperation = null;

    if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse(403, { success: false, error: 'ORIGIN_NOT_ALLOWED' }, null);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'POST') return jsonResponse(405, { success: false, error: 'METHOD_NOT_ALLOWED' }, origin);
    const jwt = bearerToken(request);
    if (!jwt) return jsonResponse(401, { success: false, error: 'AUTHENTICATION_REQUIRED' }, origin);

    try {
      userId = await authenticate(jwt);
      if (!userId) throw new SyncError('AUTHENTICATION_REQUIRED', 401, 'Entre na sua conta para sincronizar esta aplicação.');
      occurrenceId = await occurrenceIdFromRequest(request);
      await validateSchema();
      const occurrence = await loadOccurrence(userId, occurrenceId);
      if (!occurrence) throw new SyncError('NOT_FOUND', 404, 'Aplicação agendada não encontrada.', 'not_found');
      occurrenceStatus = occurrence.status;
      if (!['scheduled', 'completed', 'cancelled', 'missed'].includes(occurrenceStatus)) {
        throw new SyncError('UNSUPPORTED_OCCURRENCE_STATUS', 409, 'Esta aplicação não pode ser sincronizada.', 'unsupported_occurrence_status');
      }

      const eventId = await deterministicEventId(occurrenceId);
      if (occurrence.googleEventId && occurrence.googleEventId !== eventId) {
        await setOccurrenceSync({
          userId,
          occurrenceId,
          expectedStatus: occurrenceStatus,
          syncStatus: 'error'
        });
        throw new SyncError(
          'GOOGLE_EVENT_ID_MISMATCH',
          409,
          'A identidade do evento Google não corresponde à aplicação.',
          'google_event_id_mismatch'
        );
      }

      const connection = await loadConnection(userId);
      if (!connection || connection.connectionStatus !== 'connected' || !connection.calendarId) {
        await setOccurrenceSync({ userId, occurrenceId, expectedStatus: occurrenceStatus, syncStatus: 'not_connected' });
        throw new SyncError('GOOGLE_CONNECTION_REQUIRED', 409, 'Conecte novamente o Google Agenda.', 'google_connection_required');
      }

      const credential = await loadCredential(connection.id, userId);
      if (!credential) {
        await setOccurrenceSync({ userId, occurrenceId, expectedStatus: occurrenceStatus, syncStatus: 'error' });
        throw new SyncError('GOOGLE_CREDENTIAL_UNAVAILABLE', 409, 'Reconecte o Google Agenda para continuar.', 'google_credential_unavailable');
      }

      let event = null;
      if (occurrenceStatus !== 'cancelled') {
        try {
          event = buildGoogleEvent(occurrence);
        } catch (error) {
          await setOccurrenceSync({ userId, occurrenceId, expectedStatus: occurrenceStatus, syncStatus: 'error' });
          if (error instanceof SyncError) throw error;
          throw new SyncError('INVALID_EVENT_DATA', 422, 'Os dados desta aplicação não podem ser sincronizados.', 'invalid_event_data');
        }
      }
      const pending = await setOccurrenceSync({
        userId,
        occurrenceId,
        expectedStatus: occurrenceStatus,
        syncStatus: 'pending'
      });
      if (!pending) {
        throw new SyncError(
          'OCCURRENCE_CHANGED_DURING_SYNC',
          409,
          'A aplicação mudou antes do início da sincronização.',
          'occurrence_changed_during_sync'
        );
      }

      let refreshToken;
      let clientId;
      let clientSecret;
      try {
        const encodedKey = getEnv('GOOGLE_TOKEN_ENCRYPTION_KEY');
        clientId = getEnv('GOOGLE_CLIENT_ID');
        clientSecret = getEnv('GOOGLE_CLIENT_SECRET');
        if (!encodedKey || !clientId || !clientSecret) throw new Error('missing_configuration');
        refreshToken = await decryptRefreshToken(credential, encodedKey);
      } catch (error) {
        await setOccurrenceSync({ userId, occurrenceId, expectedStatus: occurrenceStatus, syncStatus: 'error' });
        throw error;
      }
      let accessToken;
      try {
        accessToken = await refreshAccessToken({ refreshToken, clientId, clientSecret });
      } catch (error) {
        await setOccurrenceSync({ userId, occurrenceId, expectedStatus: occurrenceStatus, syncStatus: 'error' });
        if (error?.category === 'google_reconnection_required') {
          await expireConnection({ connectionId: connection.id, userId, errorCode: 'invalid_grant' });
          throw new SyncError('GOOGLE_RECONNECTION_REQUIRED', 409, 'Reconecte o Google Agenda para continuar.', 'google_reconnection_required');
        }
        throw new SyncError('GOOGLE_TOKEN_REFRESH_FAILED', 502, 'Não foi possível acessar o Google Agenda agora.', 'google_token_refresh_failed');
      }

      try {
        const googleInput = { accessToken, calendarId: connection.calendarId, eventId };
        if (occurrenceStatus === 'scheduled') {
          googleOperation = await upsertGoogleEvent({ ...googleInput, event });
        } else if (occurrenceStatus === 'cancelled') {
          googleOperation = await deleteGoogleEvent(googleInput);
        } else {
          googleOperation = await syncTerminalGoogleEvent({
            ...googleInput,
            event,
            eventWasPersisted: Boolean(occurrence.googleEventId)
          });
        }
      } catch (error) {
        await setOccurrenceSync({ userId, occurrenceId, expectedStatus: occurrenceStatus, syncStatus: 'error' });
        const wrapped = new SyncError('GOOGLE_CALENDAR_REQUEST_FAILED', 502, 'Não foi possível sincronizar com o Google Agenda.', 'google_calendar_request_failed');
        wrapped.httpStatus = googleStatus(error);
        throw wrapped;
      }

      let finalization;
      try {
        finalization = await finalizeOccurrenceSync({
          userId,
          occurrenceId,
          expectedStatus: occurrenceStatus,
          calendarId: connection.calendarId,
          eventId,
          operation: googleOperation
        });
      } catch {
        throw new SyncError(
          'POST_GOOGLE_PERSISTENCE_FAILED',
          500,
          'O Google processou o evento, mas a confirmação local falhou.',
          'post_google_persistence_failed'
        );
      }
      if (!finalization) {
        throw new SyncError(
          'POST_GOOGLE_PERSISTENCE_FAILED',
          500,
          'O Google processou o evento, mas a confirmação local falhou.',
          'post_google_persistence_failed'
        );
      }
      if (finalization.result === 'occurrence_changed') {
        throw new SyncError(
          'OCCURRENCE_CHANGED_DURING_SYNC',
          409,
          'A aplicação mudou enquanto o Google Agenda era atualizado.',
          'occurrence_changed_during_sync'
        );
      }
      if (finalization.result !== 'synced') {
        throw new SyncError(
          'POST_GOOGLE_PERSISTENCE_FAILED',
          500,
          'O Google processou o evento, mas a confirmação local falhou.',
          'post_google_persistence_failed'
        );
      }

      try {
        await markConnectionSynced({ connectionId: connection.id, userId });
      } catch {
        try {
          logger.error({
            operation: 'google_calendar_sync_metadata',
            correlation_id: correlationId,
            user_id: userId,
            occurrence_id: occurrenceId,
            occurrence_status: occurrenceStatus,
            category: 'connection_sync_metadata_failed',
            google_operation: ['created', 'updated', 'patched', 'deleted', 'already_absent'].includes(googleOperation)
              ? googleOperation
              : null
          });
        } catch {
          // A telemetria é best-effort e não invalida uma sincronização confirmada.
        }
      }

      return jsonResponse(200, {
        success: true,
        occurrence_id: occurrenceId,
        sync_status: 'synced'
      }, origin);
    } catch (error) {
      if (error?.message === 'invalid_jwt') return jsonResponse(401, { success: false, error: 'AUTHENTICATION_REQUIRED' }, origin);
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const code = typeof error?.code === 'string' ? error.code : 'SYNC_FAILED';
      logger.error({
        operation: 'google_calendar_sync',
        correlation_id: correlationId,
        user_id: userId,
        occurrence_id: occurrenceId,
        occurrence_status: occurrenceStatus,
        category: safeCategory(error),
        google_http_status: googleStatus(error),
        google_operation: ['created', 'updated', 'patched', 'deleted', 'already_absent'].includes(googleOperation)
          ? googleOperation
          : null
      });
      return jsonResponse(status, { success: false, error: code, message: error?.message && status < 500 ? error.message : 'Não foi possível sincronizar com o Google Agenda.' }, origin);
    }
  };
}

export const calendarSyncInternals = Object.freeze({
  BASE32HEX_ALPHABET,
  GOOGLE_REMINDER_MAX,
  GOOGLE_REMINDER_COUNT_MAX,
  EVENT_DURATION_MINUTES,
  UUID_PATTERN
});
