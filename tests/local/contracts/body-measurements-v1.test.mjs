import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../../js/measurements.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../supabase/migrations/20260907000500_body_measurements_v1.sql', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../../styles.css', import.meta.url), 'utf8');

test('a tela registra as oito medidas sem duplicar o peso', () => {
  for (const field of ['abdominal_cm', 'waist_cm', 'upper_arm_left_cm', 'upper_arm_right_cm', 'thigh_left_cm', 'thigh_right_cm', 'calf_left_cm', 'calf_right_cm']) assert.match(html, new RegExp(`name="${field}"`));
  assert.doesNotMatch(migration, /weight_kg/);
  assert.match(source, /total === 0/);
});

test('medidas usam sessão e RLS por ownership', () => {
  assert.match(source, /user_id: userData\.user\.id/);
  assert.match(migration, /enable row level security/);
  for (const operation of ['select', 'insert', 'update', 'delete']) assert.match(migration, new RegExp(`for ${operation} to authenticated`));
});

test('ações de medidas e efeitos preservam espaço, dimensão e quebra responsiva', () => {
  assert.match(styles, /\.measurements-actions\{align-items:center;justify-content:flex-end;justify-self:end;gap:10px;flex-wrap:wrap;padding-right:4px;min-width:0\}/);
  assert.match(styles, /\.measurements-actions \.weight-action\{width:auto;min-width:76px;min-height:36px;padding:7px 12px;white-space:nowrap\}/);
  assert.match(styles, /@media\(max-width:620px\)\{\.measurements-actions\{justify-self:stretch;padding-right:0\}\}/);
});
