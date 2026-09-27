import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  addMinutesCivil,
  buildGoogleEvent,
  createCalendarSyncHandler,
  deleteGoogleCalendarEvent,
  decryptRefreshToken,
  deterministicEventId,
  googleReminders,
  requestGoogleAccessToken,
  syncTerminalGoogleCalendarEvent,
  upsertGoogleCalendarEvent
} from '../../../supabase/functions/google-calendar-sync/core.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OCCURRENCE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_OCCURRENCE_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const ENCODED_KEY = btoa(String.fromCharCode(...KEY_BYTES));
const REFRESH_TOKEN = 'refresh-test-value-never-log';
const ACCESS_TOKEN = 'access-test-value-never-log';
const CLIENT_SECRET = 'client-secret-test-value-never-log';

const baseOccurrence = Object.freeze({
  id: OCCURRENCE_ID,
  status: 'scheduled',
  scheduledDate: '2026-08-12',
  scheduledTime: '09:00:00',
  timezone: 'America/Sao_Paulo',
  reminderMinutes: [1440, 120, 0],
  medicine: 'Tirzepatida',
  doseMg: '2.500000',
  googleEventId: null
});

function encodeBytes(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function encryptedCredential(plaintext = REFRESH_TOKEN) {
  const nonce = Uint8Array.from({ length: 12 }, (_, index) => 20 + index);
  const key = await crypto.subtle.importKey('raw', KEY_BYTES, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(plaintext)
  ));
  return { ciphertext, nonce, encryptionKeyVersion: 1 };
}

function request(body = { occurrence_id: OCCURRENCE_ID }, token = 'valid-jwt', options = {}) {
  return new Request('https://project.supabase.co/functions/v1/google-calendar-sync', {
    method: options.method || 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: options.origin || 'http://localhost:8000'
    },
    body: options.method === 'OPTIONS' ? undefined : JSON.stringify(body)
  });
}

async function responseBody(response) {
  return JSON.parse(await response.text());
}

async function fixture(overrides = {}) {
  const occurrence = overrides.occurrence === undefined ? { ...baseOccurrence } : overrides.occurrence;
  const state = {
    googleCalls: 0,
    refreshCalls: 0,
    updates: [],
    finalizations: [],
    expired: [],
    connectionSynced: [],
    logs: [],
    refreshPlaintext: null,
    googleInput: null,
    googleInputs: [],
    currentStatus: occurrence?.status ?? null
  };
  const credential = overrides.credential === undefined
    ? await encryptedCredential()
    : overrides.credential;
  const connection = overrides.connection === undefined
    ? { id: CONNECTION_ID, connectionStatus: 'connected', calendarId: 'primary' }
    : overrides.connection;

  const dependencies = {
    authenticate: async (jwt) => {
      if (jwt === 'invalid-jwt') throw new Error('invalid_jwt');
      return USER_ID;
    },
    validateSchema: async () => {},
    loadOccurrence: async () => occurrence,
    loadConnection: async () => connection,
    loadCredential: async () => credential,
    setOccurrenceSync: async (update) => {
      state.updates.push({ ...update });
      return true;
    },
    finalizeOccurrenceSync: async (input) => {
      state.finalizations.push({ ...input });
      const result = overrides.finalizationResult === undefined
        ? { result: 'synced' }
        : overrides.finalizationResult;
      if (result?.result === 'synced') {
        state.updates.push({ ...input, syncStatus: 'synced' });
      } else if (result?.result === 'occurrence_changed') {
        state.currentStatus = result.currentStatus;
        state.updates.push({ ...input, syncStatus: 'error' });
      }
      return result;
    },
    expireConnection: async (update) => state.expired.push({ ...update }),
    markConnectionSynced: async (update) => state.connectionSynced.push({ ...update }),
    refreshAccessToken: async (input) => {
      state.refreshCalls += 1;
      state.refreshPlaintext = input.refreshToken;
      if (overrides.refreshError) throw overrides.refreshError;
      return ACCESS_TOKEN;
    },
    upsertGoogleEvent: async (input) => {
      state.googleCalls += 1;
      state.googleInput = input;
      state.googleInputs.push(input);
      if (overrides.googleError) throw overrides.googleError;
      return overrides.operation || 'created';
    },
    syncTerminalGoogleEvent: async (input) => {
      state.googleCalls += 1;
      state.googleInput = input;
      state.googleInputs.push(input);
      if (overrides.googleError) throw overrides.googleError;
      return overrides.operation || (input.eventWasPersisted ? 'patched' : 'created');
    },
    deleteGoogleEvent: async (input) => {
      state.googleCalls += 1;
      state.googleInput = input;
      state.googleInputs.push(input);
      if (overrides.googleError) throw overrides.googleError;
      return overrides.operation || 'deleted';
    },
    getEnv: (name) => ({
      GOOGLE_TOKEN_ENCRYPTION_KEY: overrides.encodedKey ?? ENCODED_KEY,
      GOOGLE_CLIENT_ID: 'client-id-test',
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET
    })[name],
    logger: { error: (entry) => state.logs.push(structuredClone(entry)) },
    ...overrides.dependencies
  };
  return { handler: createCalendarSyncHandler(dependencies), state };
}

test('A: sem JWT bloqueia antes de qualquer acesso', async () => {
  const { handler, state } = await fixture();
  const response = await handler(new Request('https://project.supabase.co/functions/v1/google-calendar-sync', { method: 'POST' }));
  assert.equal(response.status, 401);
  assert.equal(state.googleCalls, 0);
});

test('B: JWT inválido bloqueia', async () => {
  const { handler, state } = await fixture();
  const response = await handler(request(undefined, 'invalid-jwt'));
  assert.equal(response.status, 401);
  assert.equal(state.googleCalls, 0);
});

test('C e D: ausente ou de outro usuário produz o mesmo 404', async () => {
  for (const label of ['ausente', 'outro usuário']) {
    const { handler, state } = await fixture({ occurrence: null });
    const response = await handler(request());
    assert.equal(response.status, 404, label);
    assert.equal((await responseBody(response)).error, 'NOT_FOUND');
    assert.equal(state.googleCalls, 0);
  }
});

test('payload aceita somente occurrence_id UUID', async () => {
  for (const body of [
    { occurrence_id: OCCURRENCE_ID, user_id: USER_ID },
    { occurrence_id: OCCURRENCE_ID, calendar_id: 'primary' },
    { occurrence_id: 'inválido' }
  ]) {
    const { handler, state } = await fixture();
    const response = await handler(request(body));
    assert.equal(response.status, 400);
    assert.equal(state.googleCalls, 0);
  }
});

test('E: scheduled é sincronizado e confirmado', async () => {
  const { handler, state } = await fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await responseBody(response), {
    success: true,
    occurrence_id: OCCURRENCE_ID,
    sync_status: 'synced'
  });
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'synced']);
  assert.equal(state.connectionSynced.length, 1);
});

test('F, G e H: completed, cancelled e missed usam o ciclo de vida sem alterar status', async () => {
  for (const status of ['completed', 'cancelled', 'missed']) {
    const { handler, state } = await fixture({ occurrence: { ...baseOccurrence, status } });
    const response = await handler(request());
    assert.equal(response.status, 200, status);
    assert.equal((await responseBody(response)).sync_status, 'synced');
    assert.equal(state.googleCalls, 1);
    assert.equal(state.currentStatus, status);
    assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'synced']);
  }
});

test('I e J: connection ausente ou expirada marca not_connected e não chama Google', async () => {
  for (const connection of [null, { id: CONNECTION_ID, connectionStatus: 'expired', calendarId: 'primary' }]) {
    const { handler, state } = await fixture({ connection });
    const response = await handler(request());
    assert.equal(response.status, 409);
    assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['not_connected']);
    assert.equal(state.refreshCalls, 0);
    assert.equal(state.googleCalls, 0);
  }
});

test('K: credential ausente retorna erro seguro', async () => {
  const { handler, state } = await fixture({ credential: null });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal((await responseBody(response)).error, 'GOOGLE_CREDENTIAL_UNAVAILABLE');
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['error']);
  assert.equal(state.googleCalls, 0);
});

test('L: chave AES inválida bloqueia e marca error', async () => {
  const { handler, state } = await fixture({ encodedKey: encodeBytes(new Uint8Array(31)) });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'error']);
  assert.equal(state.refreshCalls, 0);
});

test('M: nonce inválido bloqueia e marca error', async () => {
  const good = await encryptedCredential();
  const { handler, state } = await fixture({ credential: { ...good, nonce: new Uint8Array(11) } });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'error']);
  assert.equal(state.refreshCalls, 0);
});

test('N: refresh token é descriptografado corretamente', async () => {
  const credential = await encryptedCredential('token-em-memoria');
  assert.equal(await decryptRefreshToken(credential, ENCODED_KEY), 'token-em-memoria');
  const { handler, state } = await fixture({ credential });
  await handler(request());
  assert.equal(state.refreshPlaintext, 'token-em-memoria');
});

test('P e BE: invalid_grant expira conexão sem apagar credencial', async () => {
  const refreshError = Object.assign(new Error('google_reconnection_required'), {
    category: 'google_reconnection_required', httpStatus: 400
  });
  const { handler, state } = await fixture({ refreshError });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal((await responseBody(response)).error, 'GOOGLE_RECONNECTION_REQUIRED');
  assert.equal(state.expired.length, 1);
  assert.equal(state.expired[0].errorCode, 'invalid_grant');
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'error']);
  assert.equal(state.googleCalls, 0);
});

test('Q, R, S e T: eventId é determinístico, base32hex e distingue UUIDs', async () => {
  const first = await deterministicEventId(OCCURRENCE_ID);
  const retry = await deterministicEventId(OCCURRENCE_ID.toUpperCase());
  const different = await deterministicEventId(OTHER_OCCURRENCE_ID);
  assert.equal(first, retry);
  assert.notEqual(first, different);
  assert.match(first, /^dc[0-9a-v]+$/u);
  assert.equal(first.length, 54);
  assert.ok(!first.includes('-'));
});

test('U, V e W: civil time soma 15 minutos, atravessa o dia e preserva timezone', () => {
  assert.deepEqual(addMinutesCivil('2026-08-12', '09:00:00', 15), {
    date: '2026-08-12', time: '09:15:00', dateTime: '2026-08-12T09:15:00'
  });
  const event = buildGoogleEvent({ ...baseOccurrence, scheduledTime: '23:55:00' });
  assert.equal(event.start.dateTime, '2026-08-12T23:55:00');
  assert.equal(event.end.dateTime, '2026-08-13T00:10:00');
  assert.equal(event.start.timeZone, 'America/Sao_Paulo');
  assert.equal(event.end.timeZone, 'America/Sao_Paulo');
});

test('payload Google é canônico e não inclui dados clínicos desnecessários', () => {
  const event = buildGoogleEvent({
    ...baseOccurrence,
    notes: 'não enviar', weight: 90, units: 8.33, syringe: 50, userId: USER_ID
  });
  assert.equal(event.summary, 'Aplicação — Tirzepatida 2,5 mg');
  const serialized = JSON.stringify(event);
  for (const forbidden of ['não enviar', USER_ID, 'weight', 'units', 'syringe']) {
    assert.ok(!serialized.includes(forbidden));
  }
});

test('X: reminders 1440/120/0 viram popup sem default', () => {
  assert.deepEqual(googleReminders([1440, 120, 0]), [
    { method: 'popup', minutes: 1440 },
    { method: 'popup', minutes: 120 },
    { method: 'popup', minutes: 0 }
  ]);
  assert.deepEqual(buildGoogleEvent(baseOccurrence).reminders, {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 1440 },
      { method: 'popup', minutes: 120 },
      { method: 'popup', minutes: 0 }
    ]
  });
});

test('Y e Z: reminders acima da quantidade ou do limite bloqueiam e marcam error', async () => {
  for (const reminderMinutes of [[0, 1, 2, 3, 4, 5], [40321]]) {
    const { handler, state } = await fixture({ occurrence: { ...baseOccurrence, reminderMinutes } });
    const response = await handler(request());
    assert.equal(response.status, 422);
    assert.equal((await responseBody(response)).error, 'INVALID_GOOGLE_REMINDER');
    assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['error']);
    assert.equal(state.googleCalls, 0);
  }
});

test('AA: INSERT Google bem-sucedido salva os identificadores somente no banco', async () => {
  const { handler, state } = await fixture({ operation: 'created' });
  const response = await handler(request());
  assert.equal(response.status, 200);
  const synced = state.updates.at(-1);
  assert.equal(synced.syncStatus, 'synced');
  assert.equal(synced.calendarId, 'primary');
  assert.match(synced.eventId, /^dc[0-9a-v]+$/u);
  assert.ok(!JSON.stringify(await responseBody(response)).includes(synced.eventId));
});

test('AB e AC: conflito no INSERT atualiza o mesmo eventId sem criar outro', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(null, { status: calls.length === 1 ? 409 : 200 });
  };
  const event = buildGoogleEvent(baseOccurrence);
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const operation = await upsertGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN, calendarId: 'primary', eventId, event, fetchImpl
  });
  assert.equal(operation, 'updated');
  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'PUT']);
  assert.equal(calls[0].body.id, eventId);
  assert.ok(!Object.hasOwn(calls[1].body, 'id'));
  assert.ok(calls[1].url.endsWith(`/events/${eventId}`));
});

test('AD e AE: erro Google marca error sem alterar os dados fonte', async () => {
  const source = { ...baseOccurrence, reminderMinutes: [...baseOccurrence.reminderMinutes] };
  const snapshot = structuredClone(source);
  const { handler, state } = await fixture({
    occurrence: source,
    googleError: Object.assign(new Error('external'), { httpStatus: 503 })
  });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'error']);
  assert.deepEqual(source, snapshot);
  assert.ok(state.updates.every((update) => !Object.hasOwn(update, 'scheduledDate')));
});

test('O, AF e AG: tokens e secrets ficam fora da resposta e dos logs', async () => {
  const { handler, state } = await fixture({
    googleError: Object.assign(new Error('external'), { httpStatus: 500 })
  });
  const response = await handler(request());
  const responseText = await response.text();
  const logText = JSON.stringify(state.logs);
  for (const secret of [REFRESH_TOKEN, ACCESS_TOKEN, CLIENT_SECRET]) {
    assert.ok(!responseText.includes(secret));
    assert.ok(!logText.includes(secret));
  }
  assert.ok(!Object.hasOwn(state.googleInput.event, 'description'));
});

test('refresh endpoint classifica invalid_grant sem expor corpo bruto', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: 'invalid_grant', error_description: REFRESH_TOKEN
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    requestGoogleAccessToken({
      refreshToken: REFRESH_TOKEN, clientId: 'id', clientSecret: CLIENT_SECRET, fetchImpl
    }),
    (error) => error.category === 'google_reconnection_required' && error.httpStatus === 400
  );
});

test('OPTIONS respeita CORS allowlist e origem não permitida é bloqueada', async () => {
  const { handler } = await fixture();
  const preflight = await handler(request(undefined, 'valid-jwt', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
  const denied = await handler(request(undefined, 'valid-jwt', { origin: 'https://evil.example' }));
  assert.equal(denied.status, 403);
});

test('AH: Google CREATE e occurrence ainda scheduled finalizam como synced', async () => {
  const { handler, state } = await fixture({ operation: 'created' });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).sync_status, 'synced');
  assert.equal(state.finalizations.length, 1);
  assert.equal(state.finalizations[0].operation, 'created');
  assert.equal(state.updates.at(-1).syncStatus, 'synced');
});

test('AI e AJ: mudança concorrente para cancelled/completed preserva identidade e marca error', async () => {
  for (const currentStatus of ['cancelled', 'completed']) {
    const { handler, state } = await fixture({
      finalizationResult: { result: 'occurrence_changed', currentStatus }
    });
    const response = await handler(request());
    const body = await responseBody(response);
    assert.equal(response.status, 409, currentStatus);
    assert.equal(body.error, 'OCCURRENCE_CHANGED_DURING_SYNC');
    assert.equal(body.sync_status, undefined);
    assert.equal(state.finalizations.length, 1);
    assert.equal(state.finalizations[0].calendarId, 'primary');
    assert.match(state.finalizations[0].eventId, /^dc[0-9a-v]+$/u);
    assert.equal(state.updates.at(-1).syncStatus, 'error');
    assert.equal(state.currentStatus, currentStatus);
    assert.equal(state.connectionSynced.length, 0);
  }
});

test('AK: falha da persistência final não declara sucesso falso', async () => {
  const { handler, state } = await fixture({ finalizationResult: null });
  const response = await handler(request());
  const body = await responseBody(response);
  assert.equal(response.status, 500);
  assert.equal(body.success, false);
  assert.equal(body.error, 'POST_GOOGLE_PERSISTENCE_FAILED');
  assert.equal(body.sync_status, undefined);
  assert.equal(state.googleCalls, 1);
  assert.equal(state.connectionSynced.length, 0);
});

test('AL: retry pós-falha local reutiliza o eventId e atualiza sem duplicidade', async () => {
  const eventIds = [];
  const googleMethods = [];
  let remoteEventExists = false;
  let finalizationAttempt = 0;
  const { handler } = await fixture({
    dependencies: {
      upsertGoogleEvent: async (input) => {
        const fetchImpl = async (_url, options) => {
          googleMethods.push(options.method);
          if (options.method === 'POST' && remoteEventExists) {
            return new Response(null, { status: 409 });
          }
          remoteEventExists = true;
          return new Response(null, { status: 200 });
        };
        const { eventId } = input;
        eventIds.push(eventId);
        return upsertGoogleCalendarEvent({ ...input, fetchImpl });
      },
      finalizeOccurrenceSync: async () => {
        finalizationAttempt += 1;
        return finalizationAttempt === 1 ? null : { result: 'synced' };
      }
    }
  });
  const first = await handler(request());
  const retry = await handler(request());
  assert.equal(first.status, 500);
  assert.equal(retry.status, 200);
  assert.deepEqual(googleMethods, ['POST', 'POST', 'PUT']);
  assert.equal(eventIds[0], eventIds[1]);
  assert.equal(new Set(eventIds).size, 1);
});

test('AM e BF: falha de markConnectionSynced é best-effort após occurrence synced', async () => {
  const { handler, state } = await fixture({
    dependencies: {
      markConnectionSynced: async () => {
        throw new Error(`${ACCESS_TOKEN}:${REFRESH_TOKEN}:${CLIENT_SECRET}`);
      }
    }
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await responseBody(response)).sync_status, 'synced');
  assert.equal(state.updates.at(-1).syncStatus, 'synced');
  assert.equal(state.logs.at(-1).category, 'connection_sync_metadata_failed');
});

test('AN: novos erros e logs não expõem tokens, secrets, calendar ID ou event ID', async () => {
  const scenarios = [
    { finalizationResult: null },
    { finalizationResult: { result: 'occurrence_changed', currentStatus: 'cancelled' } },
    {
      dependencies: {
        markConnectionSynced: async () => {
          throw new Error(`${ACCESS_TOKEN}:${REFRESH_TOKEN}:${CLIENT_SECRET}:primary`);
        }
      }
    }
  ];
  for (const scenario of scenarios) {
    const { handler, state } = await fixture(scenario);
    const response = await handler(request());
    const output = `${await response.text()}${JSON.stringify(state.logs)}`;
    const eventId = state.finalizations[0]?.eventId || await deterministicEventId(OCCURRENCE_ID);
    for (const forbidden of [ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, 'primary', eventId]) {
      assert.ok(!output.includes(forbidden));
    }
  }
});

test('finalização de produção é atômica, preserva IDs e não filtra status antigo', async () => {
  const indexSource = await readFile(new URL(
    '../../../supabase/functions/google-calendar-sync/index.ts',
    import.meta.url
  ), 'utf8');
  const start = indexSource.indexOf('async function finalizeOccurrenceSync');
  const end = indexSource.indexOf('async function expireConnection', start);
  assert.ok(start >= 0 && end > start);
  const block = indexSource.slice(start, end);
  assert.match(block, /google_calendar_id\s*=\s*\$\{input\.calendarId\}/u);
  assert.match(block, /google_event_id\s*=\s*\$\{input\.eventId\}/u);
  assert.match(block, /case when status = \$\{input\.expectedStatus\} then 'synced' else 'error' end/u);
  assert.match(block, /where id = \$\{input\.occurrenceId\}::uuid[\s\S]+user_id = \$\{input\.userId\}::uuid/u);
  assert.doesNotMatch(block, /and status = 'scheduled'/u);
  assert.match(block, /returning status, google_sync_status/u);
});

test('AO: scheduled preserva título, reminders, duração e fluxo idempotente', async () => {
  const { handler, state } = await fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(state.googleInput.event.summary, 'Aplicação — Tirzepatida 2,5 mg');
  assert.equal(state.googleInput.event.start.dateTime, '2026-08-12T09:00:00');
  assert.equal(state.googleInput.event.end.dateTime, '2026-08-12T09:15:00');
  assert.deepEqual(state.googleInput.event.reminders.overrides.map(({ minutes }) => minutes), [1440, 120, 0]);
  assert.equal(state.finalizations[0].expectedStatus, 'scheduled');
});

test('AP, AQ e BI: completed existente usa PATCH controlado, título histórico e reminders vazios', async () => {
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const event = buildGoogleEvent({ ...baseOccurrence, status: 'completed' });
  const calls = [];
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event,
    eventWasPersisted: true,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) });
      return new Response(null, { status: 200 });
    }
  });
  assert.equal(operation, 'patched');
  assert.deepEqual(calls.map(({ method }) => method), ['PATCH']);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['end', 'reminders', 'start', 'summary']);
  assert.equal(calls[0].body.summary, 'Aplicação realizada — Tirzepatida 2,5 mg');
  assert.deepEqual(calls[0].body.reminders, { useDefault: false, overrides: [] });
  assert.equal(calls[0].body.start.dateTime, '2026-08-12T09:00:00');
  assert.equal(calls[0].body.end.dateTime, '2026-08-12T09:15:00');
  for (const key of ['description', 'location', 'colorId']) assert.ok(!Object.hasOwn(calls[0].body, key));
});

test('AR: completed sem evento persistido cria histórico com eventId determinístico', async () => {
  const calls = [];
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event: buildGoogleEvent({ ...baseOccurrence, status: 'completed' }),
    eventWasPersisted: false,
    fetchImpl: async (_url, options) => {
      calls.push({ method: options.method, body: JSON.parse(options.body) });
      return new Response(null, { status: 200 });
    }
  });
  assert.equal(operation, 'created');
  assert.deepEqual(calls.map(({ method }) => method), ['POST']);
  assert.equal(calls[0].body.id, eventId);
});

test('AS: completed CREATE 409 executa PATCH no mesmo eventId', async () => {
  const calls = [];
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event: buildGoogleEvent({ ...baseOccurrence, status: 'completed' }),
    eventWasPersisted: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) });
      return new Response(null, { status: calls.length === 1 ? 409 : 200 });
    }
  });
  assert.equal(operation, 'patched');
  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'PATCH']);
  assert.equal(calls[0].body.id, eventId);
  assert.ok(calls[1].url.endsWith(`/events/${eventId}`));
});

test('AT e BI: missed existente usa PATCH, título não realizado e reminders vazios', async () => {
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const event = buildGoogleEvent({ ...baseOccurrence, status: 'missed' });
  const calls = [];
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event,
    eventWasPersisted: true,
    fetchImpl: async (_url, options) => {
      calls.push({ method: options.method, body: JSON.parse(options.body) });
      return new Response(null, { status: 200 });
    }
  });
  assert.equal(operation, 'patched');
  assert.deepEqual(calls.map(({ method }) => method), ['PATCH']);
  assert.equal(calls[0].body.summary, 'Aplicação não realizada — Tirzepatida 2,5 mg');
  assert.deepEqual(calls[0].body.reminders, { useDefault: false, overrides: [] });
});

test('AU: missed sem evento persistido cria histórico determinístico', async () => {
  const calls = [];
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event: buildGoogleEvent({ ...baseOccurrence, status: 'missed' }),
    eventWasPersisted: false,
    fetchImpl: async (_url, options) => {
      calls.push({ method: options.method, body: JSON.parse(options.body) });
      return new Response(null, { status: 200 });
    }
  });
  assert.equal(operation, 'created');
  assert.deepEqual(calls.map(({ method }) => method), ['POST']);
  assert.equal(calls[0].body.id, eventId);
});

test('AV, AW e AX: cancelled DELETE aceita 2xx, 404 e 410 como estado alinhado', async () => {
  for (const status of [204, 404, 410]) {
    const eventId = await deterministicEventId(OCCURRENCE_ID);
    const calls = [];
    const operation = await deleteGoogleCalendarEvent({
      accessToken: ACCESS_TOKEN,
      calendarId: 'primary',
      eventId,
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method });
        return new Response(null, { status });
      }
    });
    assert.equal(operation, status === 204 ? 'deleted' : 'already_absent');
    assert.equal(calls[0].method, 'DELETE');
    assert.ok(calls[0].url.endsWith(`/events/${eventId}`));
  }
});

test('AY: cancelled sem google_event_id usa o ID determinístico e finaliza synced', async () => {
  const { handler, state } = await fixture({ occurrence: { ...baseOccurrence, status: 'cancelled', googleEventId: null } });
  const response = await handler(request());
  const expected = await deterministicEventId(OCCURRENCE_ID);
  assert.equal(response.status, 200);
  assert.equal(state.googleInput.eventId, expected);
  assert.equal(state.finalizations[0].eventId, expected);
  assert.equal(state.finalizations[0].expectedStatus, 'cancelled');
});

test('AZ: google_event_id divergente bloqueia antes do Google e não é substituído', async () => {
  const persisted = await deterministicEventId(OTHER_OCCURRENCE_ID);
  const { handler, state } = await fixture({
    occurrence: { ...baseOccurrence, googleEventId: persisted }
  });
  const response = await handler(request());
  const body = await responseBody(response);
  assert.equal(response.status, 409);
  assert.equal(body.error, 'GOOGLE_EVENT_ID_MISMATCH');
  assert.equal(state.googleCalls, 0);
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['error']);
  assert.ok(state.updates.every((update) => !Object.hasOwn(update, 'eventId')));
});

test('BA, BB e BC: mudança de status durante operação terminal preserva novo status e retorna erro seguro', async () => {
  for (const [expectedStatus, currentStatus] of [
    ['completed', 'cancelled'],
    ['cancelled', 'completed'],
    ['missed', 'completed']
  ]) {
    const { handler, state } = await fixture({
      occurrence: { ...baseOccurrence, status: expectedStatus },
      finalizationResult: { result: 'occurrence_changed', currentStatus }
    });
    const response = await handler(request());
    assert.equal(response.status, 409, expectedStatus);
    assert.equal((await responseBody(response)).error, 'OCCURRENCE_CHANGED_DURING_SYNC');
    assert.equal(state.currentStatus, currentStatus);
    assert.equal(state.updates.at(-1).syncStatus, 'error');
    assert.equal(state.finalizations[0].expectedStatus, expectedStatus);
  }
});

test('BD: falha Google terminal preserva o source-of-truth local', async () => {
  const source = { ...baseOccurrence, status: 'missed', reminderMinutes: [...baseOccurrence.reminderMinutes] };
  const snapshot = structuredClone(source);
  const { handler, state } = await fixture({
    occurrence: source,
    googleError: Object.assign(new Error('external'), { httpStatus: 503 })
  });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'error']);
});

test('BG: statuses terminais não enviam dados fora do payload controlado', () => {
  for (const status of ['completed', 'missed']) {
    const event = buildGoogleEvent({
      ...baseOccurrence,
      status,
      notes: 'privado',
      weight: 90,
      volume: 0.083,
      units: 8.33,
      syringe: 50,
      applicationId: OTHER_OCCURRENCE_ID,
      userId: USER_ID
    });
    assert.deepEqual(Object.keys(event).sort(), ['end', 'reminders', 'start', 'summary']);
    const serialized = JSON.stringify(event);
    for (const forbidden of ['privado', USER_ID, OTHER_OCCURRENCE_ID, 'weight', 'volume', 'units', 'syringe']) {
      assert.ok(!serialized.includes(forbidden));
    }
  }
});

test('BH: lifecycle não expõe tokens, secrets, calendar ID ou event ID em resposta/log', async () => {
  for (const status of ['completed', 'cancelled', 'missed']) {
    const { handler, state } = await fixture({
      occurrence: { ...baseOccurrence, status },
      finalizationResult: { result: 'occurrence_changed', currentStatus: 'scheduled' }
    });
    const response = await handler(request());
    const output = `${await response.text()}${JSON.stringify(state.logs)}`;
    const eventId = await deterministicEventId(OCCURRENCE_ID);
    for (const forbidden of [ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, 'primary', eventId]) {
      assert.ok(!output.includes(forbidden));
    }
  }
});

test('BJ: retry de cancelled já ausente continua synced', async () => {
  const operations = [];
  const { handler } = await fixture({
    occurrence: { ...baseOccurrence, status: 'cancelled' },
    dependencies: {
      deleteGoogleEvent: async () => {
        operations.push('already_absent');
        return 'already_absent';
      }
    }
  });
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(operations, ['already_absent', 'already_absent']);
});

test('BK e BL: retries completed/missed usam o mesmo ID e nunca duplicam', async () => {
  for (const status of ['completed', 'missed']) {
    let remoteExists = false;
    const methods = [];
    const eventIds = [];
    const { handler } = await fixture({
      occurrence: { ...baseOccurrence, status, googleEventId: null },
      dependencies: {
        syncTerminalGoogleEvent: async (input) => {
          eventIds.push(input.eventId);
          return syncTerminalGoogleCalendarEvent({
            ...input,
            fetchImpl: async (_url, options) => {
              methods.push(options.method);
              if (options.method === 'POST' && remoteExists) return new Response(null, { status: 409 });
              remoteExists = true;
              return new Response(null, { status: 200 });
            }
          });
        }
      }
    });
    assert.equal((await handler(request())).status, 200);
    assert.equal((await handler(request())).status, 200);
    assert.deepEqual(methods, ['POST', 'POST', 'PATCH']);
    assert.equal(eventIds[0], eventIds[1]);
    assert.equal(new Set(eventIds).size, 1);
  }
});

test('BM: completed persistido recupera PATCH 404 com POST no mesmo eventId', async () => {
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const event = buildGoogleEvent({ ...baseOccurrence, status: 'completed' });
  const calls = [];
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event,
    eventWasPersisted: true,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, method: options.method, body });
      return new Response(null, { status: calls.length === 1 ? 404 : 200 });
    }
  });
  assert.equal(operation, 'created');
  assert.deepEqual(calls.map(({ method }) => method), ['PATCH', 'POST']);
  assert.ok(calls[0].url.endsWith(`/events/${eventId}`));
  assert.equal(calls[1].body.id, eventId);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['end', 'reminders', 'start', 'summary']);
  assert.deepEqual(Object.keys(calls[1].body).filter((key) => key !== 'id').sort(), [
    'end', 'reminders', 'start', 'summary'
  ]);
});

test('BN: missed persistido recupera PATCH 410 com POST no mesmo eventId', async () => {
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const event = buildGoogleEvent({ ...baseOccurrence, status: 'missed' });
  const calls = [];
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event,
    eventWasPersisted: true,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, method: options.method, body });
      return new Response(null, { status: calls.length === 1 ? 410 : 200 });
    }
  });
  assert.equal(operation, 'created');
  assert.deepEqual(calls.map(({ method }) => method), ['PATCH', 'POST']);
  assert.ok(calls[0].url.endsWith(`/events/${eventId}`));
  assert.equal(calls[1].body.id, eventId);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['end', 'reminders', 'start', 'summary']);
  assert.deepEqual(Object.keys(calls[1].body).filter((key) => key !== 'id').sort(), [
    'end', 'reminders', 'start', 'summary'
  ]);
});

test('BO: recovery PATCH 404, POST 409 e PATCH reutiliza exatamente o mesmo eventId', async () => {
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const calls = [];
  const statuses = [404, 409, 200];
  const operation = await syncTerminalGoogleCalendarEvent({
    accessToken: ACCESS_TOKEN,
    calendarId: 'primary',
    eventId,
    event: buildGoogleEvent({ ...baseOccurrence, status: 'completed' }),
    eventWasPersisted: true,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, method: options.method, body });
      return new Response(null, { status: statuses[calls.length - 1] });
    }
  });
  assert.equal(operation, 'patched');
  assert.deepEqual(calls.map(({ method }) => method), ['PATCH', 'POST', 'PATCH']);
  assert.ok(calls[0].url.endsWith(`/events/${eventId}`));
  assert.equal(calls[1].body.id, eventId);
  assert.ok(calls[2].url.endsWith(`/events/${eventId}`));
  assert.equal(new Set([
    calls[0].url.split('/').at(-1),
    calls[1].body.id,
    calls[2].url.split('/').at(-1)
  ]).size, 1);
});

test('BP: PATCH 404 e POST 503 retorna erro seguro preservando occurrence local', async () => {
  const eventId = await deterministicEventId(OCCURRENCE_ID);
  const source = {
    ...baseOccurrence,
    status: 'completed',
    googleEventId: eventId,
    reminderMinutes: [...baseOccurrence.reminderMinutes]
  };
  const snapshot = structuredClone(source);
  const calls = [];
  const { handler, state } = await fixture({
    occurrence: source,
    dependencies: {
      syncTerminalGoogleEvent: (input) => syncTerminalGoogleCalendarEvent({
        ...input,
        fetchImpl: async (url, options) => {
          calls.push({ url, method: options.method });
          return new Response(null, { status: calls.length === 1 ? 404 : 503 });
        }
      })
    }
  });
  const response = await handler(request());
  const responseText = await response.text();
  assert.equal(response.status, 502);
  assert.equal(JSON.parse(responseText).error, 'GOOGLE_CALENDAR_REQUEST_FAILED');
  assert.deepEqual(calls.map(({ method }) => method), ['PATCH', 'POST']);
  assert.deepEqual(state.updates.map(({ syncStatus }) => syncStatus), ['pending', 'error']);
  assert.equal(state.currentStatus, 'completed');
  assert.deepEqual(source, snapshot);
  assert.equal(state.finalizations.length, 0);
  const output = `${responseText}${JSON.stringify(state.logs)}`;
  for (const forbidden of [ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, 'primary', eventId]) {
    assert.ok(!output.includes(forbidden));
  }
});

test('pending e finalização de produção usam expectedStatus sem sobrescrever lifecycle', async () => {
  const indexSource = await readFile(new URL(
    '../../../supabase/functions/google-calendar-sync/index.ts',
    import.meta.url
  ), 'utf8');
  const pendingStart = indexSource.indexOf('async function setOccurrenceSync');
  const pendingEnd = indexSource.indexOf('type FinalizeSyncInput', pendingStart);
  const pendingBlock = indexSource.slice(pendingStart, pendingEnd);
  assert.match(pendingBlock, /and status = \$\{update\.expectedStatus\}/u);
  const finalizeStart = indexSource.indexOf('async function finalizeOccurrenceSync');
  const finalizeEnd = indexSource.indexOf('async function expireConnection', finalizeStart);
  const finalizeBlock = indexSource.slice(finalizeStart, finalizeEnd);
  assert.match(finalizeBlock, /case when status = \$\{input\.expectedStatus\}/u);
  assert.doesNotMatch(finalizeBlock, /set\s+status\s*=/u);
});
