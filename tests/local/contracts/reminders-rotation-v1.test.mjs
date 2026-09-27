import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../../../js/plan.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260907000300_application_site_records_v1.sql', import.meta.url), 'utf8');

test('lembrete de 15 minutos e horário exato ficam disponíveis no plano', () => {
  assert.match(html, /value="15" checked[^>]*\/>\s*<span>15 min antes · retire da geladeira/);
  assert.match(html, /value="0" checked[^>]*\/>\s*<span>No horário/);
  assert.match(plan, /setSelectedReminders\(\[1440, 120, 15, 0\]\)/);
});

test('rodízio usa uma sequência fixa e persiste somente por ocorrência agendada', () => {
  for (const site of ['abdomen_left', 'abdomen_right', 'thigh_left', 'thigh_right', 'arm_left', 'arm_right']) assert.ok(plan.includes(site));
  assert.match(plan, /scheduled_application_id: record\.id/);
  assert.match(plan, /Sugestão de rodízio/);
  assert.match(migration, /num_nonnulls\(application_id, scheduled_application_id\) = 1/);
  assert.match(migration, /foreign key \(scheduled_application_id, user_id\)/);
});

test('migration aplica ownership no banco e RLS em todas as operações', () => {
  assert.match(migration, /enable row level security/);
  for (const operation of ['select', 'insert', 'update', 'delete']) assert.match(migration, new RegExp(`for ${operation} to authenticated`));
  assert.match(migration, /user_id = auth\.uid\(\)/);
});
