import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../../../js/onboarding.js', import.meta.url), 'utf8');
const diary = readFileSync(new URL('../../../js/diary.js', import.meta.url), 'utf8');
const weight = readFileSync(new URL('../../../js/weight.js', import.meta.url), 'utf8');
const measurements = readFileSync(new URL('../../../js/measurements.js', import.meta.url), 'utf8');
const effects = readFileSync(new URL('../../../js/effects.js', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../../../js/plan.js', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../../../js/google-calendar.js', import.meta.url), 'utf8');
const report = readFileSync(new URL('../../../js/report.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../../../js/auth.js', import.meta.url), 'utf8');

test('todos os botões principais autenticados possuem um fluxo de ação e sessão defensiva', () => {
  for (const id of [
    'register-application', 'weight-register', 'measurements-register', 'effects-register',
    'plan-register', 'google-calendar-action', 'google-calendar-disconnect', 'report-export'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(diary, /registerButton\.addEventListener\('click'/);
  assert.match(weight, /registerButton\.addEventListener\('click'/);
  assert.match(measurements, /register\.addEventListener\('click', async/);
  assert.match(effects, /button\.addEventListener\('click', async/);
  assert.match(plan, /registerButton\.addEventListener\('click'/);
  assert.match(calendar, /elements\.action\.addEventListener\('click'/);
  assert.match(calendar, /elements\.disconnect\.addEventListener\('click'/);
  assert.match(report, /button\.addEventListener\('click', async/);
  assert.match(auth, /client\.auth\.getSession\(\)\.then/);
});

test('ações protegidas sobrevivem ao retorno de serviços externos e não são descartadas pelo onboarding', () => {
  assert.match(onboarding, /if \(state\.profileStatus === 'loading' \|\| state\.profileStatus === 'unknown'\)/);
  assert.match(onboarding, /if \(profile\?\.completed_at\) control\.click\(\);/);
  assert.match(onboarding, /if \(nextUser\?\.id !== state\.user\?\.id\)/);
  assert.match(plan, /if \(!currentUserId \|\| requestInFlight\) return;/);
  assert.match(measurements, /async function ensureCurrentUser\(\)/);
  assert.match(effects, /async function ensureCurrentUser\(\)/);
});

test('ações assíncronas críticas recuperam seus controles ao finalizar', () => {
  assert.match(calendar, /finally \{[\s\S]*?requestInFlight = false;/);
  assert.match(report, /finally \{[\s\S]*?button\.disabled = false;/);
  assert.match(weight, /finally \{[\s\S]*?submit\.disabled = false;/);
  assert.match(measurements, /finally \{ requestInFlight = false; submit\.disabled = false; \}/);
  assert.match(effects, /finally \{ requestInFlight = false; submit\.disabled = false; \}/);
});
