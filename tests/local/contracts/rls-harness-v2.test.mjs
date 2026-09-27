import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertDistinctUserIds, assertNoPreexistingRows, createCreatedRecordTracker, createQaRunId } from '../../integration/supabase/rls-harness.mjs';

test('harness recusa dados preexistentes antes de qualquer mutação', () => {
  assert.throws(
    () => assertNoPreexistingRows([{ table: 'applications', count: 1 }, { table: 'weight_records', count: 0 }]),
    /Dados pré-existentes.*applications/u
  );
  assert.doesNotThrow(() => assertNoPreexistingRows([{ table: 'applications', count: 0 }, { table: 'weight_records', count: 0 }]));
});

test('harness rastreia somente IDs retornados e tabelas permitidas', () => {
  const tracker = createCreatedRecordTracker(['applications', 'weight_records']);
  const client = Object.freeze({});
  tracker.register({ table: 'applications', id: 'created-id', client, ownerLabel: 'A' });
  assert.deepEqual(tracker.records.map(({ table, id, idColumn }) => ({ table, id, idColumn })), [{ table: 'applications', id: 'created-id', idColumn: 'id' }]);
  assert.throws(() => tracker.register({ table: 'profiles', id: 'not-created', client, ownerLabel: 'A' }), /não autorizada/u);
});

test('harness gera identificador único por execução', () => {
  const first = createQaRunId({ now: () => 1, uuid: () => '11111111-1111-1111-1111-111111111111' });
  const second = createQaRunId({ now: () => 1, uuid: () => '22222222-2222-2222-2222-222222222222' });
  assert.match(first, /^qa-/u);
  assert.notEqual(first, second);
});

test('harness recusa identidades A/B iguais antes de mutações', () => {
  assert.throws(() => assertDistinctUserIds('same-user', 'same-user'), /identidades distintas/u);
  assert.doesNotThrow(() => assertDistinctUserIds('user-a', 'user-b'));
});

test('runners verificam contas limpas e não restauram dados preexistentes', () => {
  const rlsRunner = readFileSync(new URL('../../integration/supabase/rls.integration.mjs', import.meta.url), 'utf8');
  const onboardingRunner = readFileSync(new URL('../../integration/supabase/onboarding-rls.integration.mjs', import.meta.url), 'utf8');
  assert.match(rlsRunner, /assertDisposableAccountIsClean\(clientA, userA, 'A'\)/u);
  assert.match(onboardingRunner, /assertDisposableAccountIsClean\(clientA, 'A'\)/u);
  assert.doesNotMatch(rlsRunner, /restoreTasks/u);
});
