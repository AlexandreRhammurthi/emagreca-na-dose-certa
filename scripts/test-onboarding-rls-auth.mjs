import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_IDS = Object.freeze({
  A: '354be9da-7a8d-4101-b1a5-b42d1f1e2fbb',
  B: '3514e09f-016c-4076-9f35-20b786b218ff'
});
const REQUIRED_ENV = ['ONBOARDING_RLS_A_EMAIL', 'ONBOARDING_RLS_A_PASSWORD', 'ONBOARDING_RLS_B_EMAIL', 'ONBOARDING_RLS_B_PASSWORD'];
const configPath = resolve('js', 'supabase-config.js');
const created = [];
let clientA;
let clientB;
let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function pass(label) {
  console.log(`PASS: ${label}`);
}

function parsePublicConfig(source) {
  const url = source.match(/const\s+SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  const key = source.match(/const\s+SUPABASE_PUBLISHABLE_KEY\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  if (!url || !key) throw new Error('Configuração pública do Supabase não encontrada.');
  return { url, key };
}

function testClient(url, key, label) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `onboarding-rls-${label}-${randomUUID()}` }
  });
}

async function authenticate(client, email, password, expectedId, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user || data.user.id !== expectedId) throw new Error(`Autenticação QA ${label} não pôde ser confirmada.`);
  pass(`sessão ${label} autenticada`);
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
    city: `QA ${label}`,
    height_cm: 170,
    journey_goal: 'weight_loss',
    medicine: 'QA Test',
    application_interval_days: 7,
    reminder_time: '09:00'
  };
}

function consentRow(userId, key = 'terms') {
  return { user_id: userId, consent_key: key, consent_version: 'qa-rls-v1', granted_at: new Date().toISOString(), revoked_at: null };
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
  await expectCrossInsertBlocked(clientA, 'onboarding_profiles', profileRow(EXPECTED_IDS.B, 'B'), 'A', 'B');
  await expectCrossInsertBlocked(clientB, 'onboarding_profiles', profileRow(EXPECTED_IDS.A, 'A'), 'B', 'A');
  await expectOwnInsert(clientA, 'onboarding_profiles', profileRow(EXPECTED_IDS.A, 'A'), { user_id: EXPECTED_IDS.A }, 'A');
  await expectOwnInsert(clientB, 'onboarding_profiles', profileRow(EXPECTED_IDS.B, 'B'), { user_id: EXPECTED_IDS.B }, 'B');
  await expectSelect(clientA, 'onboarding_profiles', { user_id: EXPECTED_IDS.A }, 1, 'A→A');
  await expectSelect(clientB, 'onboarding_profiles', { user_id: EXPECTED_IDS.B }, 1, 'B→B');
  await expectSelect(clientA, 'onboarding_profiles', { user_id: EXPECTED_IDS.B }, 0, 'A→B BLOCK');
  await expectSelect(clientB, 'onboarding_profiles', { user_id: EXPECTED_IDS.A }, 0, 'B→A BLOCK');
  await expectUpdate(clientA, 'onboarding_profiles', { user_id: EXPECTED_IDS.A }, { city: 'QA A updated' }, 1, 'A→A');
  await expectUpdate(clientB, 'onboarding_profiles', { user_id: EXPECTED_IDS.B }, { city: 'QA B updated' }, 1, 'B→B');
  await expectUpdate(clientA, 'onboarding_profiles', { user_id: EXPECTED_IDS.B }, { city: 'BLOCKED' }, 0, 'A→B BLOCK');
  await expectUpdate(clientB, 'onboarding_profiles', { user_id: EXPECTED_IDS.A }, { city: 'BLOCKED' }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'onboarding_profiles', { user_id: EXPECTED_IDS.B }, 0, 'A→B BLOCK');
  await expectDelete(clientB, 'onboarding_profiles', { user_id: EXPECTED_IDS.A }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'onboarding_profiles', { user_id: EXPECTED_IDS.A }, 1, 'A→A');
  markCleaned('onboarding_profiles', { user_id: EXPECTED_IDS.A });
  await expectDelete(clientB, 'onboarding_profiles', { user_id: EXPECTED_IDS.B }, 1, 'B→B');
  markCleaned('onboarding_profiles', { user_id: EXPECTED_IDS.B });
}

async function runConsents() {
  await expectCrossInsertBlocked(clientA, 'user_consents', consentRow(EXPECTED_IDS.B), 'A', 'B');
  await expectCrossInsertBlocked(clientB, 'user_consents', consentRow(EXPECTED_IDS.A), 'B', 'A');
  await expectOwnInsert(clientA, 'user_consents', consentRow(EXPECTED_IDS.A), { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, 'A');
  await expectOwnInsert(clientB, 'user_consents', consentRow(EXPECTED_IDS.B), { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, 'B');
  await expectSelect(clientA, 'user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, 1, 'A→A');
  await expectSelect(clientB, 'user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, 1, 'B→B');
  await expectSelect(clientA, 'user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, 0, 'A→B BLOCK');
  await expectSelect(clientB, 'user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, 0, 'B→A BLOCK');
  await expectUpdate(clientA, 'user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, { consent_version: 'qa-rls-v1-updated' }, 1, 'A→A');
  await expectUpdate(clientB, 'user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, { consent_version: 'qa-rls-v1-updated' }, 1, 'B→B');
  await expectUpdate(clientA, 'user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, { consent_version: 'blocked' }, 0, 'A→B BLOCK');
  await expectUpdate(clientB, 'user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, { consent_version: 'blocked' }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, 0, 'A→B BLOCK');
  await expectDelete(clientB, 'user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, 0, 'B→A BLOCK');
  await expectDelete(clientA, 'user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' }, 1, 'A→A');
  markCleaned('user_consents', { user_id: EXPECTED_IDS.A, consent_key: 'terms' });
  await expectDelete(clientB, 'user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' }, 1, 'B→B');
  markCleaned('user_consents', { user_id: EXPECTED_IDS.B, consent_key: 'terms' });
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
  const { url, key } = parsePublicConfig(await readFile(configPath, 'utf8'));
  clientA = testClient(url, key, 'A');
  clientB = testClient(url, key, 'B');
  try {
    await authenticate(clientA, process.env.ONBOARDING_RLS_A_EMAIL, process.env.ONBOARDING_RLS_A_PASSWORD, EXPECTED_IDS.A, 'A');
    await authenticate(clientB, process.env.ONBOARDING_RLS_B_EMAIL, process.env.ONBOARDING_RLS_B_PASSWORD, EXPECTED_IDS.B, 'B');
    await runProfiles();
    await runConsents();
  } finally {
    await cleanup();
    await Promise.allSettled([clientA?.auth.signOut(), clientB?.auth.signOut()].filter(Boolean));
  }
  if (failures) process.exitCode = 1;
  else console.log('ONBOARDING_RLS_V1_APPROVED');
}

await main();
