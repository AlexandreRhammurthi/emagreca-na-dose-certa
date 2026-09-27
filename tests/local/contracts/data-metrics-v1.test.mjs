import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../supabase/migrations/20260907000600_product_events_v1.sql', import.meta.url), 'utf8');
const functionSource = readFileSync(new URL('../../../supabase/functions/record-product-event/index.ts', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../../../js/analytics.js', import.meta.url), 'utf8');

test('migration usa eventos mínimos, RLS e cascade', () => {
  assert.match(migration, /references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for insert to authenticated/);
  assert.doesNotMatch(migration, /jsonb|metadata|notes|medicine|dose_mg|weight_kg|height_cm|gender/i);
});

test('função aceita somente campos e valores permitidos', () => {
  assert.match(functionSource, /const allowedFields = new Set/);
  assert.match(functionSource, /Object\.keys\(body\)\.some/);
  assert.match(functionSource, /const ACTION_SOURCES/);
  assert.match(functionSource, /ACTION_SOURCES\[actionKind\] !== source/);
  assert.doesNotMatch(functionSource, /SERVICE_ROLE|service_role/i);
});

test('função de métricas aceita preflight do browser e responde CORS para localhost', () => {
  assert.match(functionSource, /ALLOWED_ORIGINS/);
  assert.match(functionSource, /Access-Control-Allow-Origin/);
  assert.match(functionSource, /request\.method === 'OPTIONS'/);
  assert.match(functionSource, /Access-Control-Allow-Methods.*POST, OPTIONS/);
});

test('cliente envia somente o contrato de eventos e não lê dados de saúde', () => {
  assert.match(analytics, /record-product-event/);
  assert.match(analytics, /event_name: eventName/);
  assert.match(analytics, /source,/);
  assert.match(analytics, /action_kind: actionKind/);
  assert.match(analytics, /simulated_in_session: Boolean\(simulated\)/);
  assert.doesNotMatch(analytics, /detail\.|form\.elements|user\.email|metadata|notes|weight_kg|dose_mg|height_cm|gender/i);
});
