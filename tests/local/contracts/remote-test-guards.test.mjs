import assert from 'node:assert/strict';
import test from 'node:test';
import { KNOWN_PRODUCTION_PROJECT_REF, validateQaEnvironment } from '../../integration/supabase/qa-environment.mjs';

const productionUrl = 'https://production-project.supabase.co';
const valid = Object.freeze({
  TEST_TARGET: 'qa',
  TEST_SUPABASE_URL: 'https://qa-project.supabase.co',
  TEST_SUPABASE_PROJECT_REF: 'qa-project',
  TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_value',
  TEST_ALLOW_QA_WRITE: 'true',
  TEST_USERS_DISPOSABLE: 'true'
});

test('trava remota exige confirmação explícita de QA', () => {
  assert.throws(() => validateQaEnvironment({ ...valid, TEST_TARGET: 'production' }, { productionUrl }), /TEST_TARGET/u);
});

test('trava remota exige confirmação explícita de escrita QA', () => {
  const { TEST_ALLOW_QA_WRITE: _omitted, ...withoutWrite } = valid;
  assert.throws(() => validateQaEnvironment(withoutWrite, { productionUrl }), /TEST_ALLOW_QA_WRITE/u);
});

test('trava remota exige confirmação de contas descartáveis', () => {
  const { TEST_USERS_DISPOSABLE: _omitted, ...withoutDisposable } = valid;
  assert.throws(() => validateQaEnvironment(withoutDisposable, { productionUrl }), /TEST_USERS_DISPOSABLE/u);
});

test('trava remota recusa configuração incompleta', () => {
  const { TEST_SUPABASE_URL: _omitted, ...missingUrl } = valid;
  assert.throws(() => validateQaEnvironment(missingUrl, { productionUrl }), /TEST_SUPABASE_URL/u);
});

test('trava remota exige correspondência entre URL e project ref de QA', () => {
  assert.throws(() => validateQaEnvironment({ ...valid, TEST_SUPABASE_PROJECT_REF: 'other-project' }, { productionUrl }), /URL não corresponde/u);
});

test('trava remota aceita somente publishable key', () => {
  assert.throws(() => validateQaEnvironment({ ...valid, TEST_SUPABASE_PUBLISHABLE_KEY: 'synthetic-anon-jwt' }, { productionUrl }), /publishable key/u);
});

test('trava remota recusa o endpoint conhecido de produção', () => {
  const production = { ...valid, TEST_SUPABASE_URL: productionUrl, TEST_SUPABASE_PROJECT_REF: 'production-project' };
  assert.throws(() => validateQaEnvironment(production, { productionUrl }), /proibido no modo qa/u);
});

test('trava remota recusa o project ref conhecido de produção', () => {
  const production = { ...valid, TEST_SUPABASE_URL: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`, TEST_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF };
  assert.throws(() => validateQaEnvironment(production, { productionUrl }), /proibido no modo qa/u);
});

test('trava remota recusa credencial administrativa no ambiente', () => {
  assert.throws(() => validateQaEnvironment({ ...valid, SUPABASE_SERVICE_ROLE_KEY: '[synthetic]' }, { productionUrl }), /Credencial administrativa proibida/u);
});

test('trava remota recusa chave administrativa declarada como publishable', () => {
  assert.throws(() => validateQaEnvironment({ ...valid, TEST_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic' }, { productionUrl }), /administrativa ou JWT/u);
});

test('trava remota libera configuração sintética coerente de QA', () => {
  assert.deepEqual(validateQaEnvironment(valid, { productionUrl }), {
    url: 'https://qa-project.supabase.co',
    key: 'sb_publishable_synthetic_test_value',
    mode: 'qa'
  });
});

const productionQa = Object.freeze({
  ...valid,
  TEST_TARGET: 'production-qa',
  TEST_SUPABASE_URL: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`,
  TEST_SUPABASE_PROJECT_REF: KNOWN_PRODUCTION_PROJECT_REF,
  TEST_ALLOW_PRODUCTION_QA_WRITE: 'true'
});

test('production-qa sem opt-in de escrita em produção é bloqueado', () => {
  const { TEST_ALLOW_PRODUCTION_QA_WRITE: _omitted, ...withoutOptIn } = productionQa;
  assert.throws(() => validateQaEnvironment(withoutOptIn, { productionUrl: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co` }), /TEST_ALLOW_PRODUCTION_QA_WRITE/u);
});

test('production-qa exige contas descartáveis', () => {
  assert.throws(() => validateQaEnvironment({ ...productionQa, TEST_USERS_DISPOSABLE: 'false' }, { productionUrl: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co` }), /TEST_USERS_DISPOSABLE/u);
});

test('production-qa com ref incorreta é bloqueado', () => {
  assert.throws(() => validateQaEnvironment({ ...productionQa, TEST_SUPABASE_URL: 'https://other-project.supabase.co', TEST_SUPABASE_PROJECT_REF: 'other-project' }, { productionUrl: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co` }), /exige exatamente/u);
});

test('production-qa corretamente configurado permite avançar até a rede', () => {
  assert.deepEqual(validateQaEnvironment(productionQa, { productionUrl: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co` }), {
    url: `https://${KNOWN_PRODUCTION_PROJECT_REF}.supabase.co`,
    key: 'sb_publishable_synthetic_test_value',
    mode: 'production-qa'
  });
});
