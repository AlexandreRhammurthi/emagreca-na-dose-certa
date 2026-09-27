import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadQaEnvironment } from './qa-environment.mjs';
import { assertDistinctUserIds, assertNoPreexistingRows, createQaRunId } from './rls-harness.mjs';

const REQUIRED_ENV = ['TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD', 'TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD'];
const created = [];
let clientA;
let clientB;
let userA;
let userB;
let failures = 0;
const qaRunId = createQaRunId();

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function pass(label) {
  console.log(`PASS: ${label}`);
}

function testClient(url, key, label) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `onboarding-rls-${label}-${randomUUID()}` }
  });
}

async function authenticate(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Autenticação QA ${label} não pôde ser confirmada.`);
  pass(`sessão ${label} autenticada`);
  return data.user;
}

function isBlocked(error, data) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42501'
    || message.includes('row-level security')
    || message.includes('permission denied')
    || (!error && Array.isArray(data) && data.length === 0);
}

function profileRow(userId, label) {
  return {
    user_id: userId,
    date_of_birth: '1990-01-01',
    gender: 'prefer_not_to_answer',
    country_code: 'BR',
    state: 'SP',
    city: `QA ${qaRunId} ${label}`,
    height_cm: 170,
    journey_goal: 'weight_loss',
    medicine: `QA ${qaRunId}`,
    application_interval_days: 7,
    reminder_time: '09:00'
  };
}

function consentRow(userId, key = 'terms') {
  return { user_id: userId, consent_key: key, consent_version: `qa-${qaRunId}`.slice(0, 40), granted_at: new Date().toISOString(), revoked_at: null };
}

async function assertDisposableAccountIsClean(client, label) {
  const checks = [
    ['onboarding_profiles', 'user_id'],
    ['user_consents', 'user_id']
  ];
  const rows = [];
  for (const [table, column] of checks) {
    const { data, error } = await client.from(table).select(column).limit(1);
    if (error) throw new Error(`Não foi possível verificar dados prévios de ${table} para USER ${label}.`);
    rows.push({ table, count: data?.length || 0 });
  }
  assertNoPreexistingRows(rows);
}

async function expectOwnInsert(client, table, row, key, label) {
  const { data, error } = await client.from(table).insert(row).select().single();
  if (error || !data) return fail(`${table} INSERT ${label}→${label}`);
  created.push({ client, table, key, label });
  pass(`${table} INSERT ${label}→${label}`);
}

async function expectCrossInsertBlocked(client, table, row, label, target) {
  const { data, error } = await client.from(table).insert(row).select();
  if (!isBlocked(error, data)) return fail(`${table} INSERT ${label}→${target} deveria ser BLOCK`);
  pass(`${table} INSERT ${label}→${target} BLOCK`);
}

async function expectSelect(client, table, filter, expected, label) {
  const { data, error } = await client.from(table).select('*').match(filter);
  if (error || data.length !== expected) return fail(`${table} SELECT ${label}`);
  pass(`${table} SELECT ${label}`);
}

async function expectUpdate(client, table, filter, patch, expected, label) {
  const { data, error } = await client.from(table).update(patch).match(filter).select();
  if (error || data.length !== expected) return fail(`${table} UPDATE ${label}`);
  pass(`${table} UPDATE ${label}`);
}

async function expectDelete(client, table, filter, expected, label) {
  const { data, error } = await client.from(table).delete().match(filter).select();
  if (error || data.length !== expected) return fail(`${table} DELETE ${label}`);
  pass(`${table} DELETE ${label}`);
}

function markCleaned(table, key) {
  const index = created.findIndex((record) => record.table === table && Object.entries(key).every(([field, value]) => record.key[field] === value));
  if (index >= 0) created.splice(index, 1);
}

async function runProfiles() {
  await expectCrossInsertBlocked(clientA, 'onboarding_profiles', profileRow(userB.id, 'B'), 'A', 'B');
  await expectCrossInsertBlocked(clientB, 'onboarding_profiles', profileRow(userA.id, 'A'), 'B', 'A');
  await expectOwnInsert(clientA, 'onboarding_profiles', profileRow(userA.id, 'A'), { user_id: userA.id }, 'A');
  await expectOwnInsert(clientB, 'onboarding_profiles', profileRow(userB.id, 'B'), { user_id: userB.id }, 'B');
  await expectSelect(clientA, 'onboarding_profiles', { user_id: userA.id }, 1, 'A→A');
  await expectSelect(clientB, 'onboarding_profiles', { user_id: userB.id }, 1, 'B→B');
  await expectSelect(clientA, 'onboarding_profiles', { user_id: userB.id }, 0, 'A→B BLOCK');
  await expectSelect(clientB, 'onboarding_profiles', { user_id: userA.id }, 0, 'B→A BLOCK');
  await expectUpdate(clientA, 'onboarding_profiles', { user_id: userA.id }, { city: `QA ${qaRunId} A updated` }, 1, 'A→A');
  await expectUpdate(clientB, 'onboarding_profiles', { user_id: userB.id }, { city: `QA ${qaRunId} B updated` }, 1, 'B→B');
  await expectUpdate(clientA, 'onboarding_profiles', { user_id: userB.id }, { city: 'BLOCKED' }, 0, 'A→B BLOCK');
  await expectUpdate(clientB, 'onboarding_profiles', { user_id: userA.id }, { city: 'BLOCKED' }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'onboarding_profiles', { user_id: userB.id }, 0, 'A→B BLOCK');
  await expectDelete(clientB, 'onboarding_profiles', { user_id: userA.id }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'onboarding_profiles', { user_id: userA.id }, 1, 'A→A');
  markCleaned('onboarding_profiles', { user_id: userA.id });
  await expectDelete(clientB, 'onboarding_profiles', { user_id: userB.id }, 1, 'B→B');
  markCleaned('onboarding_profiles', { user_id: userB.id });
}

async function runConsents() {
  await expectCrossInsertBlocked(clientA, 'user_consents', consentRow(userB.id), 'A', 'B');
  await expectCrossInsertBlocked(clientB, 'user_consents', consentRow(userA.id), 'B', 'A');
  await expectOwnInsert(clientA, 'user_consents', consentRow(userA.id), { user_id: userA.id, consent_key: 'terms' }, 'A');
  await expectOwnInsert(clientB, 'user_consents', consentRow(userB.id), { user_id: userB.id, consent_key: 'terms' }, 'B');
  await expectSelect(clientA, 'user_consents', { user_id: userA.id, consent_key: 'terms' }, 1, 'A→A');
  await expectSelect(clientB, 'user_consents', { user_id: userB.id, consent_key: 'terms' }, 1, 'B→B');
  await expectSelect(clientA, 'user_consents', { user_id: userB.id, consent_key: 'terms' }, 0, 'A→B BLOCK');
  await expectSelect(clientB, 'user_consents', { user_id: userA.id, consent_key: 'terms' }, 0, 'B→A BLOCK');
  await expectUpdate(clientA, 'user_consents', { user_id: userA.id, consent_key: 'terms' }, { consent_version: `qa-${qaRunId}-a`.slice(0, 40) }, 1, 'A→A');
  await expectUpdate(clientB, 'user_consents', { user_id: userB.id, consent_key: 'terms' }, { consent_version: `qa-${qaRunId}-b`.slice(0, 40) }, 1, 'B→B');
  await expectUpdate(clientA, 'user_consents', { user_id: userB.id, consent_key: 'terms' }, { consent_version: 'blocked' }, 0, 'A→B BLOCK');
  await expectUpdate(clientB, 'user_consents', { user_id: userA.id, consent_key: 'terms' }, { consent_version: 'blocked' }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'user_consents', { user_id: userB.id, consent_key: 'terms' }, 0, 'A→B BLOCK');
  await expectDelete(clientB, 'user_consents', { user_id: userA.id, consent_key: 'terms' }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'user_consents', { user_id: userA.id, consent_key: 'terms' }, 1, 'A→A');
  markCleaned('user_consents', { user_id: userA.id, consent_key: 'terms' });
  await expectDelete(clientB, 'user_consents', { user_id: userB.id, consent_key: 'terms' }, 1, 'B→B');
  markCleaned('user_consents', { user_id: userB.id, consent_key: 'terms' });
}

async function cleanup() {
  for (const record of created.reverse()) {
    const { error } = await record.client.from(record.table).delete().match(record.key);
    if (error) fail(`cleanup ${record.table} ${record.label}`);
    else pass(`cleanup ${record.table} ${record.label}`);
  }
}

async function main() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Variáveis QA ausentes: ${missing.join(', ')}`);
  const { url, key } = await loadQaEnvironment();
  clientA = testClient(url, key, 'A');
  clientB = testClient(url, key, 'B');
  try {
    userA = await authenticate(clientA, process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD, 'A');
    userB = await authenticate(clientB, process.env.TEST_USER_B_EMAIL, process.env.TEST_USER_B_PASSWORD, 'B');
    assertDistinctUserIds(userA.id, userB.id);
    await assertDisposableAccountIsClean(clientA, 'A');
    await assertDisposableAccountIsClean(clientB, 'B');
    await runProfiles();
    await runConsents();
  } finally {
    await cleanup();
    await Promise.allSettled([clientA?.auth.signOut(), clientB?.auth.signOut()].filter(Boolean));
  }
  if (failures) process.exitCode = 1;
  else console.log('ONBOARDING_RLS_V1_APPROVED');
}

try {
  await main();
} catch (error) {
  console.error(`ONBOARDING_RLS_ABORTED: ${error?.message || 'falha segura'}`);
  process.exitCode = 1;
}
