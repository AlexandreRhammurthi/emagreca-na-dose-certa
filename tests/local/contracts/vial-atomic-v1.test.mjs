import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../supabase/migrations/20260907000200_application_vial_atomic_v1.sql', import.meta.url), 'utf8');
const diary = readFileSync(new URL('../../../js/diary.js', import.meta.url), 'utf8');
const vials = readFileSync(new URL('../../../js/vials.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

test('retirada e aplicação usam RPC invoker e são protegidas pelo saldo em mg e mL', () => {
  assert.match(migration, /create_application_with_optional_vial/);
  assert.match(migration, /update_application_with_optional_vial/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_used_mg \+ p_dose_mg > v_inventory\.initial_mg/);
  assert.match(migration, /v_used_ml \+ v_volume_ml > v_inventory\.initial_ml/);
  assert.match(migration, /insert into public\.vial_usages/);
  assert.doesNotMatch(migration, /security definer|service_role/i);
});

test('Diário seleciona frasco opcional e não grava retirada em duas etapas no cliente', () => {
  assert.match(diary, /create_application_with_optional_vial/);
  assert.match(diary, /update_application_with_optional_vial/);
  assert.match(diary, /p_medication_vial_id/);
  assert.doesNotMatch(diary, /from\('vial_usages'\)\.insert/);
});

test('cadastro exige volume inicial em mL e pergunta sobre novo frasco sem saldo', () => {
  assert.match(html, /name="initial_ml"[^>]*required/);
  assert.match(html, /Este frasco terminou\?/);
  assert.match(vials, /offerReplacement/);
  assert.match(vials, /saldo/);
});
