import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const weight = read('js/weight.js');
const diary = read('js/diary.js');
const plan = read('js/plan.js');
const measurements = read('js/measurements.js');
const vials = read('js/vials.js');
const effects = read('js/effects.js');
const onboarding = read('js/onboarding.js');

test('todos os pop-ups possuem rota explícita de fechamento', () => {
  for (const id of ['application-form-modal', 'application-future-modal', 'application-details-modal', 'application-delete-modal', 'weight-form-modal', 'weight-delete-modal', 'plan-form-modal', 'plan-cancel-modal', 'medication-vial-modal', 'medication-vial-replacement-modal', 'measurements-form-modal', 'effects-form-modal', 'onboarding-modal', 'account-delete-modal']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const selector of ['data-diary-close', 'data-weight-close', 'data-weight-delete-close', 'data-plan-close', 'data-vial-close', 'data-vial-replacement-close', 'data-measurements-close', 'data-effects-close', 'data-account-delete-close']) assert.match(html, new RegExp(selector));
});

test('fechamento não é bloqueado por envio em andamento e Esc está coberto', () => {
  assert.doesNotMatch(weight, /function closeModal\(restoreFocus = true\) \{\s*if \(/);
  assert.doesNotMatch(diary, /function closeModal\(modal, restoreFocus = true\) \{\s*if \(/);
  assert.doesNotMatch(measurements, /function close\(\) \{ if \(requestInFlight\) return/);
  for (const source of [weight, diary, plan, measurements, vials, effects, onboarding]) assert.match(source, /event\.key.*'Escape'/);
});

test('diary modal mantém o diálogo acima do backdrop e o clique no botão permanece acionável', () => {
  assert.match(read('styles.css'), /\.diary-modal\{[^}]*z-index:\s*1100;[^}]*\}/s);
  assert.match(read('styles.css'), /\.diary-backdrop\{[^}]*position:\s*absolute;[^}]*z-index:\s*0;[^}]*pointer-events:\s*auto;[^}]*\}/s);
  assert.match(read('styles.css'), /\.diary-dialog\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*\}/s);
});

test('ações assíncronas críticas preservam o controle acionado e liberam o estado', () => {
  assert.match(weight, /document\.getElementById\('weight-delete-confirm'\)\.addEventListener\('click', async \(event\) => \{\s*const button = event\.currentTarget;/);
  assert.match(weight, /let formRequestInFlight = false;/);
  assert.match(weight, /let deleteRequestInFlight = false;/);
  assert.match(diary, /let formRequestInFlight = false;/);
  assert.match(diary, /let deleteRequestInFlight = false;/);
  assert.match(measurements, /try \{ result = updating \?/);
  assert.match(vials, /finally \{\s*submit\.disabled = false;/);
});
