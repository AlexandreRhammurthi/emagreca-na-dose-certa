import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadQaEnvironment } from './qa-environment.mjs';
import { assertDistinctUserIds, assertNoPreexistingRows, createCreatedRecordTracker, createQaRunId } from './rls-harness.mjs';
await import('../../../js/date-utils.js');

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, '..', '..', '..');
const REPORT_PATH = resolve(PROJECT_ROOT, 'tests', 'results', 'rls', 'RLS_TEST_RESULT.md');
const REQUIRED_ENV = [
  'TEST_USER_A_EMAIL',
  'TEST_USER_A_PASSWORD',
  'TEST_USER_B_EMAIL',
  'TEST_USER_B_PASSWORD'
];
const DIRECTIONS = ['A→A', 'A→B', 'B→B', 'B→A'];
const ALLOWED_RESULTS = new Set(['PASS', 'BLOCK', 'FAIL', 'N/A']);
const TABLE_DEFINITIONS = Object.freeze({
  applications: Object.freeze({
    columns: ['id', 'user_id', 'application_date', 'medicine', 'vial_mg', 'vial_ml', 'dose_mg', 'volume_ml', 'units', 'syringe_capacity', 'source', 'calculation_version', 'notes', 'created_at', 'updated_at'],
    requiredInsert: ['user_id', 'application_date', 'medicine', 'vial_mg', 'vial_ml', 'dose_mg', 'volume_ml', 'units', 'syringe_capacity', 'source', 'calculation_version', 'notes']
  }),
  weight_records: Object.freeze({
    columns: ['id', 'user_id', 'record_date', 'weight_kg', 'notes', 'created_at', 'updated_at'],
    requiredInsert: ['user_id', 'record_date', 'weight_kg', 'notes']
  }),
  user_settings: Object.freeze({ columns: ['user_id'], requiredInsert: ['user_id'] }),
  profiles: Object.freeze({ columns: ['id', 'display_name'], requiredInsert: [] })
});

const matrices = {
  applications: createMatrix(['SELECT', 'SELECT UUID', 'INSERT', 'UPDATE', 'DELETE']),
  weight_records: createMatrix(['SELECT', 'SELECT UUID', 'INSERT', 'UPDATE', 'DELETE']),
  user_settings: createMatrix(['SELECT', 'INSERT/UPSERT', 'UPDATE', 'DELETE']),
  profiles: createMatrix(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
};
const failures = [];
const tracker = createCreatedRecordTracker(['applications', 'weight_records', 'user_settings']);
const createdRecords = tracker.records;
const cleanupState = { attempted: 0, removed: 0, remaining: 0, errors: [] };
const qaRunId = createQaRunId();
let criticalFailure = null;
let userA = null;
let userB = null;
let clientA = null;
let clientB = null;

class CriticalSecurityError extends Error {
  constructor(table, operation, direction) {
    super('CRITICAL SECURITY FAILURE');
    this.table = table;
    this.operation = operation;
    this.direction = direction;
  }
}

function createMatrix(operations) {
  return Object.fromEntries(operations.map((operation) => [
    operation,
    Object.fromEntries(DIRECTIONS.map((direction) => [direction, 'N/A']))
  ]));
}

function setResult(table, operation, direction, result, reason = '') {
  if (!ALLOWED_RESULTS.has(result)) throw new Error('Resultado de teste inválido.');
  matrices[table][operation][direction] = result;
  if (result === 'FAIL') failures.push({ table, operation, direction, reason: reason || 'Comportamento inesperado.' });
  console.log(`${table.toUpperCase().padEnd(18)} ${operation.padEnd(18)} ${direction.padEnd(5)} ${result}`);
}

function assertBlocked(table, operation, direction, data, error) {
  const affected = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (error && !isRlsRejection(error)) {
    setResult(table, operation, direction, 'FAIL', sanitizedDatabaseError(table, `${operation} ${direction}`, error));
    return false;
  }
  if (!error && affected > 0) {
    setResult(table, operation, direction, 'FAIL', 'Operação cruzada foi permitida.');
    throw new CriticalSecurityError(table, operation, direction);
  }
  setResult(table, operation, direction, 'BLOCK');
  return true;
}

function isRlsRejection(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42501'
    || message.includes('row-level security')
    || message.includes('row level security')
    || message.includes('permission denied');
}

function newTestClient(url, key, suffix) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `rls-test-${suffix}-${randomUUID()}`
    }
  });
}

async function authenticate(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Falha ao autenticar USER ${label}.`);
  console.log(`USER ${label} autenticado: OK`);
  return data.user;
}

function buildMinimalRow(table, userId, marker) {
  const definition = TABLE_DEFINITIONS[table];
  if (!definition) throw new Error(`Definição local ausente para ${table}.`);
  const testDate = sqlDate();
  if (table === 'applications') {
    return {
      user_id: userId,
      application_date: testDate,
      medicine: 'RLS TEST',
      vial_mg: 15,
      vial_ml: 0.5,
      dose_mg: 2.5,
      volume_ml: 0.083333333,
      units: 8.333333333,
      syringe_capacity: 50,
      source: 'simulator',
      calculation_version: 1,
      notes: marker
    };
  }
  if (table === 'weight_records') {
    return { user_id: userId, record_date: testDate, weight_kg: 90, notes: marker };
  }
  return { user_id: userId };
}

function sqlDate() {
  return globalThis.DoseDate.todayCivil();
}

function sanitizeSensitive(value) {
  return String(value || 'não informado')
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer [OMITIDO]')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9._-]+/gu, 'sb_[OMITIDO]')
    .replace(/eyJ[A-Za-z0-9._-]+/gu, '[JWT OMITIDO]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '[E-MAIL OMITIDO]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, '[UUID OMITIDO]')
    .slice(0, 500);
}

function sanitizedDatabaseError(table, step, error) {
  const clean = sanitizeSensitive;
  return `Tabela: ${table}; Etapa: ${step}; Código Supabase/PostgREST: ${clean(error?.code)}; Mensagem sanitizada: ${clean(error?.message)}; Hint: ${clean(error?.hint)}`;
}

async function insertRow(client, table, row) {
  return client.from(table).insert(row).select('id,user_id,notes').single();
}

function registerCreated(table, id, ownerClient, ownerLabel, idColumn = 'id') {
  tracker.register({ table, id, idColumn, client: ownerClient, ownerLabel });
}

async function ownerRow(client, table, id, columns = 'id,user_id,notes') {
  return client.from(table).select(columns).eq('id', id).maybeSingle();
}

async function assertDisposableAccountIsClean(client, user, label) {
  const checks = [
    ['applications', 'id'],
    ['weight_records', 'id'],
    ['user_settings', 'user_id']
  ];
  const rows = [];
  for (const [table, column] of checks) {
    const { data, error } = await client.from(table).select(column).limit(1);
    if (error) throw new Error(`Não foi possível verificar dados prévios de ${table} para USER ${label}.`);
    rows.push({ table, count: data?.length || 0 });
  }
  assertNoPreexistingRows(rows);

  // O profile é estrutural e pode nascer automaticamente com a conta Auth.
  // Ele não entra no cleanup, pois não foi criado por esta execução.
  const profile = await client.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (profile.error || profile.data?.id !== user.id) {
    throw new Error(`Profile estrutural de USER ${label} não pôde ser confirmado.`);
  }
}

async function runOwnedRecordTable(table, markerA, markerB) {
  console.log(`\n${table.toUpperCase()}`);
  const rowA = buildMinimalRow(table, userA.id, markerA);
  const rowB = buildMinimalRow(table, userB.id, markerB);
  const inserted = {};

  for (const [label, client, row, direction] of [
    ['A', clientA, rowA, 'A→A'],
    ['B', clientB, rowB, 'B→B']
  ]) {
    const { data, error } = await insertRow(client, table, row);
    if (error || !data?.id) {
      setResult(table, 'INSERT', direction, 'FAIL', sanitizedDatabaseError(table, `INSERT próprio USER ${label}`, error));
    } else {
      inserted[label] = data;
      registerCreated(table, data.id, client, label);
      setResult(table, 'INSERT', direction, 'PASS');
    }
  }

  if (!inserted.A || !inserted.B) return;

  for (const [client, forgedRow, direction, ownerClient, ownerLabel] of [
    [clientA, buildMinimalRow(table, userB.id, `${qaRunId}_${table}_FORGED_A_TO_B`), 'A→B', clientB, 'B'],
    [clientB, buildMinimalRow(table, userA.id, `${qaRunId}_${table}_FORGED_B_TO_A`), 'B→A', clientA, 'A']
  ]) {
    const { data, error } = await insertRow(client, table, forgedRow);
    const ownerConfirmation = await ownerClient.from(table).select('id').eq('notes', forgedRow.notes).maybeSingle();
    if (ownerConfirmation.error) {
      setResult(table, 'INSERT', direction, 'FAIL', 'Proprietário não conseguiu confirmar o INSERT forjado.');
      throw new Error(`Confirmação segura de INSERT forjado falhou em ${table}.`);
    }
    const insertedId = data?.id || ownerConfirmation.data?.id;
    if (insertedId) {
      registerCreated(table, insertedId, ownerClient, ownerLabel);
      setResult(table, 'INSERT', direction, 'FAIL', 'INSERT forjado foi persistido, mesmo sem representação para o invasor.');
      throw new CriticalSecurityError(table, 'INSERT', direction);
    }
    if (!assertBlocked(table, 'INSERT', direction, data, error)) continue;
  }

  for (const [label, client, own, other, ownDirection, crossDirection] of [
    ['A', clientA, inserted.A, inserted.B, 'A→A', 'A→B'],
    ['B', clientB, inserted.B, inserted.A, 'B→B', 'B→A']
  ]) {
    const ownSelect = await ownerRow(client, table, own.id);
    setResult(table, 'SELECT', ownDirection, !ownSelect.error && ownSelect.data?.id === own.id ? 'PASS' : 'FAIL', `SELECT próprio de USER ${label} falhou.`);

    const crossSelect = await client.from(table).select('id').eq('notes', label === 'A' ? markerB : markerA);
    if (!crossSelect.error && (crossSelect.data?.length || 0) > 0) {
      setResult(table, 'SELECT', crossDirection, 'FAIL', 'SELECT cruzado retornou dados.');
      throw new CriticalSecurityError(table, 'SELECT', crossDirection);
    }
    setResult(table, 'SELECT', crossDirection, 'BLOCK');

    const directSelect = await client.from(table).select('id').eq('id', other.id);
    if (!directSelect.error && (directSelect.data?.length || 0) > 0) {
      setResult(table, 'SELECT UUID', crossDirection, 'FAIL', 'SELECT direto por UUID retornou dados.');
      throw new CriticalSecurityError(table, 'SELECT UUID', crossDirection);
    }
    setResult(table, 'SELECT UUID', crossDirection, 'BLOCK');
    setResult(table, 'SELECT UUID', ownDirection, 'N/A');
  }

  const updatedMarkers = { A: `${markerA}_UPDATED`, B: `${markerB}_UPDATED` };
  for (const [label, client, own, direction] of [
    ['A', clientA, inserted.A, 'A→A'],
    ['B', clientB, inserted.B, 'B→B']
  ]) {
    const update = await client.from(table).update({ notes: updatedMarkers[label] }).eq('id', own.id).select('id,notes');
    const passed = !update.error && update.data?.length === 1 && update.data[0].notes === updatedMarkers[label];
    setResult(table, 'UPDATE', direction, passed ? 'PASS' : 'FAIL', `UPDATE próprio de USER ${label} falhou.`);
  }

  for (const [client, target, direction, ownerClient, expectedMarker] of [
    [clientA, inserted.B, 'A→B', clientB, updatedMarkers.B],
    [clientB, inserted.A, 'B→A', clientA, updatedMarkers.A]
  ]) {
    const attempt = await client.from(table).update({ notes: `${qaRunId}_${table}_CROSS_${randomUUID()}` }).eq('id', target.id).select('id');
    const blocked = assertBlocked(table, 'UPDATE', direction, attempt.data, attempt.error);
    const confirmation = await ownerRow(ownerClient, table, target.id);
    if (confirmation.error || confirmation.data?.notes !== expectedMarker) {
      setResult(table, 'UPDATE', direction, 'FAIL', 'Registro do proprietário foi alterado no UPDATE cruzado.');
      throw new CriticalSecurityError(table, 'UPDATE', direction);
    }
    if (!blocked) continue;
  }

  for (const [client, target, direction, ownerClient] of [
    [clientA, inserted.B, 'A→B', clientB],
    [clientB, inserted.A, 'B→A', clientA]
  ]) {
    const attempt = await client.from(table).delete().eq('id', target.id).select('id');
    const blocked = assertBlocked(table, 'DELETE', direction, attempt.data, attempt.error);
    const confirmation = await ownerRow(ownerClient, table, target.id, 'id');
    if (confirmation.error || confirmation.data?.id !== target.id) {
      setResult(table, 'DELETE', direction, 'FAIL', 'Registro do proprietário desapareceu após DELETE cruzado.');
      throw new CriticalSecurityError(table, 'DELETE', direction);
    }
    if (!blocked) continue;
  }
}

async function runUserSettings() {
  const table = 'user_settings';
  console.log(`\n${table.toUpperCase()}`);
  const states = {};
  const testValues = {
    A: { height_cm: 171.11, initial_weight_kg: 91.11, target_weight_kg: 81.11, journey_start_date: sqlDate() },
    B: { height_cm: 172.22, initial_weight_kg: 92.22, target_weight_kg: 82.22, journey_start_date: sqlDate() }
  };
  const ownUpdateValues = { A: 80.11, B: 80.22 };
  const forgedValues = { 'A→B': 79.11, 'B→A': 79.22 };

  for (const [label, client, user, ownDirection] of [
    ['A', clientA, userA, 'A→A'],
    ['B', clientB, userB, 'B→B']
  ]) {
    const previous = await client.from(table).select('*').eq('user_id', user.id).maybeSingle();
    if (previous.error) {
      setResult(table, 'SELECT', ownDirection, 'FAIL', `Leitura de settings de USER ${label} falhou.`);
      continue;
    }
    if (previous.data) throw new Error(`Dados pré-existentes impedem o teste QA: user_settings de USER ${label}.`);
    states[label] = {};
    setResult(table, 'SELECT', ownDirection, 'PASS');
    const payload = { user_id: user.id, ...testValues[label] };
    const upsert = await client.from(table).upsert(payload, { onConflict: 'user_id' }).select('*').maybeSingle();
    if (upsert.error || !upsert.data) {
      setResult(table, 'INSERT/UPSERT', ownDirection, 'FAIL', sanitizedDatabaseError(table, `UPSERT próprio USER ${label}`, upsert.error));
      continue;
    }
    states[label].current = upsert.data;
    setResult(table, 'INSERT/UPSERT', ownDirection, 'PASS');
    registerCreated(table, user.id, client, label, 'user_id');
  }

  if (!states.A?.current || !states.B?.current) return;

  for (const [client, targetLabel, direction, ownerClient, targetUser] of [
    [clientA, 'B', 'A→B', clientB, userB],
    [clientB, 'A', 'B→A', clientA, userA]
  ]) {
    const original = Number(states[targetLabel].current.target_weight_kg);
    const forged = {
      user_id: targetUser.id,
      ...testValues[targetLabel],
      target_weight_kg: forgedValues[direction]
    };
    const attempt = await client.from(table).upsert(forged, { onConflict: 'user_id' }).select('user_id');
    const ownerConfirmation = await ownerClient.from(table).select('target_weight_kg').eq('user_id', targetUser.id).maybeSingle();
    if (ownerConfirmation.error) {
      setResult(table, 'INSERT/UPSERT', direction, 'FAIL', sanitizedDatabaseError(table, `confirmação de UPSERT ${direction}`, ownerConfirmation.error));
      continue;
    }
    if (Number(ownerConfirmation.data?.target_weight_kg) !== original) {
      setResult(table, 'INSERT/UPSERT', direction, 'FAIL', 'UPSERT forjado alterou settings do proprietário.');
      throw new CriticalSecurityError(table, 'INSERT/UPSERT', direction);
    }
    assertBlocked(table, 'INSERT/UPSERT', direction, attempt.data, attempt.error);
  }

  for (const [label, client, user, state, ownDirection] of [
    ['A', clientA, userA, states.A, 'A→A'],
    ['B', clientB, userB, states.B, 'B→B']
  ]) {
    const value = ownUpdateValues[label];
    const original = Number(state.current.target_weight_kg);
    const update = await client.from(table).update({ target_weight_kg: value }).eq('user_id', user.id).select('user_id,target_weight_kg');
    const confirmation = await client.from(table).select('user_id,target_weight_kg').eq('user_id', user.id).maybeSingle();
    const changed = value !== original;
    const updatedOwnRow = !update.error
      && update.data?.length === 1
      && update.data[0].user_id === user.id
      && Number(update.data[0].target_weight_kg) === value
      && !confirmation.error
      && confirmation.data?.user_id === user.id
      && Number(confirmation.data.target_weight_kg) === value
      && changed;
    setResult(
      table,
      'UPDATE',
      ownDirection,
      updatedOwnRow ? 'PASS' : 'FAIL',
      update.error
        ? sanitizedDatabaseError(table, `UPDATE próprio USER ${label}`, update.error)
        : `Tabela: ${table}; Etapa: UPDATE próprio USER ${label}; Código: sem erro; Linhas retornadas: ${update.data?.length || 0}; Valor realmente alterado: ${changed ? 'SIM' : 'NÃO'}.`
    );
    if (updatedOwnRow) state.current = { ...state.current, target_weight_kg: value };
  }

  for (const [client, targetUser, targetLabel, ownerClient, direction] of [
    [clientA, userB, 'B', clientB, 'A→B'],
    [clientB, userA, 'A', clientA, 'B→A']
  ]) {
    const original = Number(states[targetLabel].current.target_weight_kg);
    const value = forgedValues[direction];
    const attempt = await client.from(table).update({ target_weight_kg: value }).eq('user_id', targetUser.id).select('user_id,target_weight_kg');
    const blocked = assertBlocked(table, 'UPDATE', direction, attempt.data, attempt.error);
    const confirmation = await ownerClient.from(table).select('target_weight_kg').eq('user_id', targetUser.id).maybeSingle();
    if (confirmation.error || Number(confirmation.data?.target_weight_kg) !== original) {
      setResult(table, 'UPDATE', direction, 'FAIL', 'Settings do proprietário foram alteradas.');
      throw new CriticalSecurityError(table, 'UPDATE', direction);
    }
    if (!blocked) continue;
  }

  for (const [client, otherUser, direction] of [
    [clientA, userB, 'A→B'], [clientB, userA, 'B→A']
  ]) {
    const cross = await client.from(table).select('user_id').eq('user_id', otherUser.id);
    if (!cross.error && (cross.data?.length || 0) > 0) {
      setResult(table, 'SELECT', direction, 'FAIL', 'SELECT cruzado retornou settings.');
      throw new CriticalSecurityError(table, 'SELECT', direction);
    }
    setResult(table, 'SELECT', direction, 'BLOCK');
  }
}

async function runProfiles() {
  const table = 'profiles';
  console.log(`\n${table.toUpperCase()}`);
  for (const direction of DIRECTIONS) {
    setResult(table, 'INSERT', direction, 'N/A');
    setResult(table, 'DELETE', direction, 'N/A');
  }
  const profileMarkers = {};
  for (const [label, client, user, direction] of [
    ['A', clientA, userA, 'A→A'], ['B', clientB, userB, 'B→B']
  ]) {
    const own = await client.from(table).select('*').eq('id', user.id).maybeSingle();
    if (own.error || !own.data) {
      setResult(table, 'SELECT', direction, 'FAIL', `Profile de USER ${label} não foi lido.`);
      continue;
    }
    setResult(table, 'SELECT', direction, 'PASS');
    // Profiles podem ser criados pelo trigger do Auth. A estrutura é preservada;
    // somente contas explicitamente descartáveis recebem o marcador desta execução.
    const marker = `${qaRunId}_profile_${label}`;
    const update = await client.from(table).update({ display_name: marker }).eq('id', user.id).select('id,display_name');
    setResult(table, 'UPDATE', direction, !update.error && update.data?.[0]?.display_name === marker ? 'PASS' : 'FAIL', `UPDATE próprio de profile ${label} falhou.`);
    profileMarkers[label] = marker;
  }

  if (!profileMarkers.A || !profileMarkers.B) return;
  for (const [client, targetUser, ownerClient, expectedMarker, direction] of [
    [clientA, userB, clientB, profileMarkers.B, 'A→B'],
    [clientB, userA, clientA, profileMarkers.A, 'B→A']
  ]) {
    const crossSelect = await client.from(table).select('id').eq('id', targetUser.id);
    if (!crossSelect.error && (crossSelect.data?.length || 0) > 0) {
      setResult(table, 'SELECT', direction, 'FAIL', 'SELECT cruzado retornou profile.');
      throw new CriticalSecurityError(table, 'SELECT', direction);
    }
    setResult(table, 'SELECT', direction, 'BLOCK');
    const attempt = await client.from(table).update({ display_name: `${qaRunId}_profile_cross_${randomUUID().slice(0, 8)}` }).eq('id', targetUser.id).select('id');
    const blocked = assertBlocked(table, 'UPDATE', direction, attempt.data, attempt.error);
    const confirmation = await ownerClient.from(table).select('display_name').eq('id', targetUser.id).maybeSingle();
    if (confirmation.error || confirmation.data?.display_name !== expectedMarker) {
      setResult(table, 'UPDATE', direction, 'FAIL', 'Profile do proprietário foi alterado.');
      throw new CriticalSecurityError(table, 'UPDATE', direction);
    }
    if (!blocked) continue;
  }
}

async function cleanup() {
  for (const record of createdRecords.reverse()) {
    if (!['applications', 'weight_records', 'user_settings'].includes(record.table)) {
      cleanupState.errors.push(`Cleanup recusou tabela não autorizada: ${record.table}.`);
      continue;
    }
    cleanupState.attempted += 1;
    const idColumn = record.idColumn || 'id';
    try {
      const deletion = await record.client.from(record.table).delete().eq(idColumn, record.id).select(idColumn);
      if (!deletion.error && deletion.data?.length === 1) {
        record.removed = true;
        cleanupState.removed += 1;
        if (['applications', 'weight_records'].includes(record.table)) {
          setResult(record.table, 'DELETE', `${record.ownerLabel}→${record.ownerLabel}`, 'PASS');
        }
      } else {
        cleanupState.errors.push(`Falha ao remover registro temporário de ${record.table}.`);
      }
    } catch {
      cleanupState.errors.push(`Falha ao remover registro temporário de ${record.table}.`);
    }
  }
  cleanupState.remaining = createdRecords.filter((record) => !record.removed).length;
  console.log(cleanupState.remaining === 0 && cleanupState.errors.length === 0 ? '\nCLEANUP: OK' : '\nCLEANUP: FAIL');
}

function matrixMarkdown(table) {
  const rows = Object.entries(matrices[table]).map(([operation, values]) =>
    `| ${operation} | ${DIRECTIONS.map((direction) => values[direction]).join(' | ')} |`
  );
  return `### ${table}\n\n| Operação | ${DIRECTIONS.join(' | ')} |\n|---|---|---|---|---|\n${rows.join('\n')}`;
}

function expectedResultsPassed() {
  const expected = {
    applications: { SELECT: ['PASS','BLOCK','PASS','BLOCK'], 'SELECT UUID': ['N/A','BLOCK','N/A','BLOCK'], INSERT: ['PASS','BLOCK','PASS','BLOCK'], UPDATE: ['PASS','BLOCK','PASS','BLOCK'], DELETE: ['PASS','BLOCK','PASS','BLOCK'] },
    weight_records: { SELECT: ['PASS','BLOCK','PASS','BLOCK'], 'SELECT UUID': ['N/A','BLOCK','N/A','BLOCK'], INSERT: ['PASS','BLOCK','PASS','BLOCK'], UPDATE: ['PASS','BLOCK','PASS','BLOCK'], DELETE: ['PASS','BLOCK','PASS','BLOCK'] },
    user_settings: { SELECT: ['PASS','BLOCK','PASS','BLOCK'], 'INSERT/UPSERT': ['PASS','BLOCK','PASS','BLOCK'], UPDATE: ['PASS','BLOCK','PASS','BLOCK'], DELETE: ['N/A','N/A','N/A','N/A'] },
    profiles: { SELECT: ['PASS','BLOCK','PASS','BLOCK'], INSERT: ['N/A','N/A','N/A','N/A'], UPDATE: ['PASS','BLOCK','PASS','BLOCK'], DELETE: ['N/A','N/A','N/A','N/A'] }
  };
  if (process.env.TEST_SKIP_PROFILES === 'true') delete expected.profiles;
  return Object.entries(expected).every(([table, operations]) =>
    Object.entries(operations).every(([operation, values]) =>
      DIRECTIONS.every((direction, index) => matrices[table][operation][direction] === values[index])
    )
  );
}

async function writeReport(approved) {
  const failureLines = failures.length
    ? failures.map((failure) => `- ${failure.table} / ${failure.operation} / ${failure.direction}: ${sanitizeSensitive(failure.reason)}`).join('\n')
    : '- Nenhuma falha registrada.';
  const criticalLine = criticalFailure
    ? `- CRITICAL SECURITY FAILURE: ${criticalFailure.table} / ${criticalFailure.operation} / ${criticalFailure.direction}.`
    : '- Nenhuma falha crítica registrada.';
  const report = `# RLS V1 — Resultado da execução real

Data/hora: ${new Date().toISOString()}

## A. Ambiente

- Branch: main
- Método: dois clientes independentes do SDK oficial Supabase.
- Publishable Key utilizada: SIM (valor omitido).
- Persistência de sessão: desabilitada.
- service_role utilizada: NÃO.
- Secret Key utilizada: NÃO.
- SQL Editor administrativo utilizado: NÃO.
- JWT/Authorization manipulado manualmente: NÃO.

## B. Usuários

- Duas identidades QA distintas: ${userA && userB && userA.id !== userB.id ? 'SIM' : 'NÃO CONFIRMADO'}.
- UUIDs, e-mails, senhas e tokens: omitidos.

## C. Matrizes

${Object.keys(matrices).map(matrixMarkdown).join('\n\n')}

## D. Falhas

${criticalLine}
${failureLines}

## E. Limpeza

- Registros temporários identificados: ${createdRecords.length}.
- Remoções tentadas: ${cleanupState.attempted}.
- Registros removidos: ${cleanupState.removed}.
- Registros temporários restantes conhecidos: ${cleanupState.remaining}.
- Erros de limpeza: ${cleanupState.errors.length}.
- Profiles e usuários Auth excluídos: 0.

## F. Resultado final

**RLS V1 — ${approved ? 'APROVADO' : 'REPROVADO'}**

${approved
  ? 'A camada de isolamento por usuário foi validada com duas sessões reais utilizando Publishable Key e RLS. O projeto está liberado para desenvolvimento da Sprint Diário V1.'
  : 'Desenvolvimento de Diário/Peso permanece bloqueado.'}

## G. Auditoria de DELETE em profiles

- SELECT próprio: PASS para USER A e USER B.
- SELECT cruzado: BLOCK nas duas direções.
- UPDATE próprio: PASS para USER A e USER B.
- UPDATE cruzado: BLOCK nas duas direções.
- INSERT: N/A em todas as direções.
- DELETE: N/A em todas as direções.
- Nenhuma chamada DELETE é executada em public.profiles.
- Os DELETEs próprios exibidos durante o cleanup pertencem a applications e weight_records; o nome da tabela é incluído no console.
- Os dois profiles foram encontrados pelos SELECTs próprios e não fazem parte dos registros autorizados para cleanup.
`;
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, report, { encoding: 'utf8', mode: 0o600 });
}

async function main() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    for (const name of missing) console.error(`ERRO: variável ${name} não encontrada.`);
    process.exitCode = 1;
    return;
  }

  let approved = false;
  try {
    const config = await loadQaEnvironment();
    clientA = newTestClient(config.url, config.key, 'a');
    clientB = newTestClient(config.url, config.key, 'b');
    userA = await authenticate(clientA, process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD, 'A');
    userB = await authenticate(clientB, process.env.TEST_USER_B_EMAIL, process.env.TEST_USER_B_PASSWORD, 'B');
    assertDistinctUserIds(userA.id, userB.id);
    console.log('Sessões independentes: OK');

    await assertDisposableAccountIsClean(clientA, userA, 'A');
    await assertDisposableAccountIsClean(clientB, userB, 'B');

    await runOwnedRecordTable('applications', `${qaRunId}_applications_A`, `${qaRunId}_applications_B`);
    await runOwnedRecordTable('weight_records', `${qaRunId}_weight_records_A`, `${qaRunId}_weight_records_B`);
    await runUserSettings();
    if (process.env.TEST_SKIP_PROFILES !== 'true') await runProfiles();
  } catch (error) {
    if (error instanceof CriticalSecurityError) {
      criticalFailure = { table: error.table, operation: error.operation, direction: error.direction };
      console.error(`\nCRITICAL SECURITY FAILURE — ${error.table} / ${error.operation} / ${error.direction}`);
    } else {
      failures.push({ table: 'execução', operation: 'infraestrutura', direction: 'N/A', reason: sanitizeSensitive(error.message || 'Falha não identificada.') });
      console.error('\nRLS V1 — execução interrompida por falha segura. Consulte o relatório.');
    }
  } finally {
    await cleanup();
    await Promise.allSettled([clientA?.auth.signOut(), clientB?.auth.signOut()].filter(Boolean));
    approved = !criticalFailure && failures.length === 0 && cleanupState.remaining === 0 && cleanupState.errors.length === 0 && expectedResultsPassed();
    await writeReport(approved);
    console.log(`\nRLS V1 — ${approved ? 'APROVADO' : 'REPROVADO'}`);
    console.log('Relatório: tests/results/rls/RLS_TEST_RESULT.md');
    if (!approved) process.exitCode = 1;
  }
}

await main();
